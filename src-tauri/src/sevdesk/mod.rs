use crate::error::{AppError, AppResult};
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

pub const API_BASE: &str = "https://my.sevdesk.de/api/v1";
pub const WEB_BASE: &str = "https://my.sevdesk.de";

const MAX_ATTEMPTS: u32 = 4;

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    objects: T,
}

/// Dünner Client um die SevDesk-REST-API. Kennt nur HTTP und Fehlerbehandlung —
/// fachliche Entscheidungen liegen bewusst in `commands::invoicing`.
pub struct SevDesk {
    client: reqwest::Client,
    token: String,
    base: String,
}

impl SevDesk {
    pub fn new(token: String) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .user_agent("Kontor/1.0 (macOS)")
            .build()
            .map_err(|e| AppError::Network(format!("HTTP-Client nicht initialisierbar: {e}")))?;
        Ok(Self {
            client,
            token,
            base: API_BASE.to_string(),
        })
    }

    #[cfg(test)]
    fn with_base(base: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(5))
                .build()
                .expect("Test-Client"),
            token: "test-token".into(),
            base: base.into(),
        }
    }

    fn build(&self, method: Method, path: &str) -> RequestBuilder {
        // SevDesk erwartet den reinen Token im Authorization-Header, ohne "Bearer".
        self.client
            .request(method, format!("{}{path}", self.base))
            .header("Authorization", &self.token)
            .header("Accept", "application/json")
    }

    /// `idempotent` steuert, ob nach einer bereits abgesendeten Anfrage erneut
    /// versucht werden darf. Für POSTs ist das nur bei 429/503 zulässig — sonst
    /// riskieren wir eine doppelte Rechnung.
    async fn send(&self, factory: impl Fn() -> RequestBuilder, idempotent: bool) -> AppResult<Response> {
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let result = factory().send().await;

            match result {
                Ok(response) => {
                    let status = response.status();
                    let server_did_not_process =
                        status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE;

                    let may_retry = server_did_not_process || (idempotent && status.is_server_error());

                    if may_retry && attempt < MAX_ATTEMPTS {
                        let wait = retry_after(&response).unwrap_or_else(|| backoff(attempt));
                        log::warn!(
                            "SevDesk antwortete mit {status}, Versuch {attempt}/{MAX_ATTEMPTS}, \
                             warte {:?}",
                            wait
                        );
                        tokio::time::sleep(wait).await;
                        continue;
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        return Err(AppError::RateLimited(
                            "SevDesk drosselt die Anfragen. Bitte in einigen Minuten erneut versuchen."
                                .into(),
                        ));
                    }
                    return Ok(response);
                }
                Err(err) => {
                    // Ein Verbindungsfehler bedeutet: die Anfrage kam nie an.
                    // Ein Timeout nach dem Senden könnte serverseitig gewirkt haben.
                    let never_sent = err.is_connect();
                    let retryable = never_sent || (idempotent && err.is_timeout());

                    if retryable && attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(backoff(attempt)).await;
                        continue;
                    }
                    if err.is_timeout() {
                        return Err(AppError::Network(
                            "SevDesk hat nicht rechtzeitig geantwortet. Bitte in SevDesk prüfen, \
                             ob die Rechnung trotzdem angelegt wurde, bevor du es erneut versuchst."
                                .into(),
                        ));
                    }
                    return Err(AppError::Network(format!(
                        "Verbindung zu SevDesk fehlgeschlagen: {err}"
                    )));
                }
            }
        }
    }

    async fn decode<T: DeserializeOwned>(&self, response: Response) -> AppResult<T> {
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| AppError::Network(format!("Antwort nicht lesbar: {e}")))?;

        if !status.is_success() {
            return Err(AppError::SevDesk(format!(
                "{} — {}",
                status.as_u16(),
                extract_error(&body, status)
            )));
        }

        serde_json::from_str::<Envelope<T>>(&body)
            .map(|e| e.objects)
            .map_err(|e| {
                AppError::SevDesk(format!(
                    "Antwort von SevDesk war unerwartet aufgebaut ({e}). \
                     Anfang der Antwort: {}",
                    body.chars().take(200).collect::<String>()
                ))
            })
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, &str)]) -> AppResult<T> {
        let owned: Vec<(String, String)> = query
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        let response = self
            .send(
                || self.build(Method::GET, path).query(&owned),
                /* idempotent */ true,
            )
            .await?;
        self.decode(response).await
    }

    pub async fn post<T: DeserializeOwned>(&self, path: &str, body: &Value) -> AppResult<T> {
        let response = self
            .send(
                || self.build(Method::POST, path).json(body),
                /* idempotent */ false,
            )
            .await?;
        self.decode(response).await
    }
}

fn backoff(attempt: u32) -> Duration {
    // 1s, 2s, 4s … plus etwas Streuung, damit parallele Läufe nicht im Takt laufen.
    let base = 1u64 << (attempt.saturating_sub(1)).min(4);
    let jitter = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_millis() as u64 % 400)
        .unwrap_or(0);
    Duration::from_millis(base * 1000 + jitter)
}

fn retry_after(response: &Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(|secs| Duration::from_secs(secs.min(60)))
}

/// SevDesk verpackt Fehler in `{"error":{"message":"…"}}`; fällt das aus,
/// zeigen wir den Rohtext statt einer generischen Meldung.
fn extract_error(body: &str, status: StatusCode) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        for path in [["error", "message"], ["error", "text"]] {
            if let Some(msg) = value.get(path[0]).and_then(|e| e.get(path[1])).and_then(|m| m.as_str()) {
                return msg.to_string();
            }
        }
        if let Some(msg) = value.get("message").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "Der API-Key wurde abgelehnt. Bitte in den Einstellungen prüfen.".to_string()
        }
        _ if body.trim().is_empty() => "SevDesk hat ohne Erläuterung abgelehnt.".to_string(),
        _ => body.chars().take(300).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Winziger HTTP-Server, der eine feste Antwortfolge ausliefert und
    /// mitzählt, wie oft er tatsächlich angesprochen wurde.
    fn mock_server(responses: Vec<(u16, &'static str)>) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("Port");
        let addr = listener.local_addr().expect("Adresse");
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();

        std::thread::spawn(move || {
            for (index, stream) in listener.incoming().enumerate() {
                let Ok(mut stream) = stream else { break };
                counter.fetch_add(1, Ordering::SeqCst);

                // Anfrage bis zur Leerzeile lesen, damit der Client nicht blockiert.
                let peek = stream.try_clone().expect("clone");
                let mut reader = BufReader::new(peek);
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                }
                if content_length > 0 {
                    let mut body = vec![0u8; content_length];
                    use std::io::Read;
                    let _ = reader.read_exact(&mut body);
                }

                let (status, body) = responses
                    .get(index)
                    .copied()
                    .unwrap_or((200, r#"{"objects":[]}"#));
                let response = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        (format!("http://{addr}"), hits)
    }

    #[tokio::test]
    async fn get_wird_nach_429_wiederholt() {
        let (base, hits) = mock_server(vec![
            (429, r#"{"error":{"message":"slow down"}}"#),
            (200, r#"{"objects":[{"id":"7"}]}"#),
        ]);
        let client = SevDesk::with_base(base);

        let result: Vec<Value> = client.get("/SevUser", &[]).await.expect("Erfolg");
        assert_eq!(result.len(), 1);
        assert_eq!(hits.load(Ordering::SeqCst), 2, "genau ein Wiederholungsversuch");
    }

    #[tokio::test]
    async fn post_wird_bei_serverfehler_nicht_wiederholt() {
        // Ein 500 nach einem POST könnte serverseitig bereits gewirkt haben —
        // eine zweite Rechnung wäre schlimmer als der Abbruch.
        let (base, hits) = mock_server(vec![(500, r#"{"error":{"message":"kaputt"}}"#)]);
        let client = SevDesk::with_base(base);

        let result: AppResult<Value> = client.post("/Invoice", &json!({})).await;
        let error = result.expect_err("muss scheitern");
        assert!(matches!(error, AppError::SevDesk(_)), "war: {error:?}");
        assert!(error.to_string().contains("kaputt"));
        assert_eq!(hits.load(Ordering::SeqCst), 1, "kein zweiter Versuch");
    }

    #[tokio::test]
    async fn post_wird_bei_drosselung_wiederholt() {
        let (base, hits) = mock_server(vec![
            (429, "{}"),
            (200, r#"{"objects":{"id":"42","invoiceNumber":"RE-1001"}}"#),
        ]);
        let client = SevDesk::with_base(base);

        let created: Value = client.post("/Invoice", &json!({})).await.expect("Erfolg");
        assert_eq!(created.get("id").and_then(|v| v.as_str()), Some("42"));
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn unerreichbarer_host_meldet_netzwerkfehler() {
        // Port 1 ist reserviert und nimmt keine Verbindungen an.
        let client = SevDesk::with_base("http://127.0.0.1:1");
        let result: AppResult<Value> = client.get("/SevUser", &[]).await;
        let error = result.expect_err("muss scheitern");
        assert!(matches!(error, AppError::Network(_)), "war: {error:?}");
        assert!(error.retryable());
    }

    #[test]
    fn fehlertext_wird_aus_der_antwort_gezogen() {
        assert_eq!(
            extract_error(r#"{"error":{"message":"Contact fehlt"}}"#, StatusCode::BAD_REQUEST),
            "Contact fehlt"
        );
        assert_eq!(
            extract_error("", StatusCode::UNAUTHORIZED),
            "Der API-Key wurde abgelehnt. Bitte in den Einstellungen prüfen."
        );
        // Unbekannte Struktur: lieber der Rohtext als eine nichtssagende Meldung.
        assert!(extract_error("<html>kaputt</html>", StatusCode::BAD_GATEWAY).contains("kaputt"));
    }

    #[test]
    fn backoff_waechst_und_bleibt_begrenzt() {
        assert!(backoff(1) >= Duration::from_secs(1));
        assert!(backoff(1) < Duration::from_millis(1500));
        assert!(backoff(2) >= Duration::from_secs(2));
        assert!(backoff(9) <= Duration::from_millis(16_400));
    }
}
