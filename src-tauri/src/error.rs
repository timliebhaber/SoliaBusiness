use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Zentraler Fehlertyp. Jede I/O-Grenze (SQLite, Keychain, SevDesk, Dateisystem)
/// mündet hier hinein; nichts wird stumm verschluckt.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Datenbankfehler: {0}")]
    Db(String),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Validation(String),

    #[error("{0}")]
    Conflict(String),

    #[error("Schlüsselbund: {0}")]
    Keychain(String),

    /// Fehler, den die SevDesk-API selbst gemeldet hat (inkl. Statuscode).
    #[error("SevDesk: {0}")]
    SevDesk(String),

    /// Transportebene: kein Netz, DNS, TLS, Timeout.
    #[error("Netzwerkfehler: {0}")]
    Network(String),

    #[error("Zu viele Anfragen an SevDesk: {0}")]
    RateLimited(String),

    #[error("Dateizugriff fehlgeschlagen: {0}")]
    Io(String),

    #[error("Interner Fehler: {0}")]
    Internal(String),
}

impl AppError {
    /// Maschinenlesbare Kategorie für die UI (Icon/Farbe/Retry-Angebot).
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::NotFound(_) => "not_found",
            AppError::Validation(_) => "validation",
            AppError::Conflict(_) => "conflict",
            AppError::Keychain(_) => "keychain",
            AppError::SevDesk(_) => "sevdesk",
            AppError::Network(_) => "network",
            AppError::RateLimited(_) => "rate_limited",
            AppError::Io(_) => "io",
            AppError::Internal(_) => "internal",
        }
    }

    /// Darf der Nutzer denselben Aufruf gefahrlos wiederholen?
    pub fn retryable(&self) -> bool {
        matches!(self, AppError::Network(_) | AppError::RateLimited(_))
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("AppError", 3)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.serialize_field("retryable", &self.retryable())?;
        st.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        // Constraint-Verletzungen sind Nutzerfehler, keine Systemfehler.
        if let rusqlite::Error::SqliteFailure(err, ref msg) = e {
            if err.code == rusqlite::ErrorCode::ConstraintViolation {
                return AppError::Conflict(
                    msg.clone()
                        .unwrap_or_else(|| "Datensatz verletzt eine Bedingung".into()),
                );
            }
        }
        AppError::Db(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        match e {
            keyring::Error::NoEntry => {
                AppError::Keychain("Kein API-Key im Schlüsselbund hinterlegt".into())
            }
            other => AppError::Keychain(other.to_string()),
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl<T> From<std::sync::PoisonError<T>> for AppError {
    fn from(_: std::sync::PoisonError<T>) -> Self {
        AppError::Internal("Datenbank-Sperre war nach einem früheren Absturz beschädigt".into())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
