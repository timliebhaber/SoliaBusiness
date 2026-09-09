use super::now_utc;
use crate::commands::settings::{load as load_settings, put_raw, AppSettings};
use crate::error::{AppError, AppResult};
use crate::keychain;
use crate::models::{InvoicePosition, InvoicePreview, InvoiceRecord, InvoiceResult};
use crate::sevdesk::{SevDesk, WEB_BASE};
use crate::state::AppState;
use chrono::{DateTime, Local};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

// ------------------------------------------------------------ Vorschau (lokal)

struct RawEntry {
    id: i64,
    task_id: Option<i64>,
    task_title: Option<String>,
    start_time: String,
    minutes: i64,
    note: Option<String>,
}

fn round_up(minutes: i64, increment: i64) -> i64 {
    if increment <= 1 {
        return minutes;
    }
    ((minutes + increment - 1) / increment) * increment
}

fn hours_of(minutes: i64) -> f64 {
    // Zwei Nachkommastellen, damit unsere Summe exakt der entspricht,
    // die SevDesk aus Menge × Preis errechnet.
    ((minutes as f64 / 60.0) * 100.0).round() / 100.0
}

fn build_preview(conn: &Connection, customer_id: i64) -> AppResult<InvoicePreview> {
    let customer = crate::commands::customers::fetch(conn, customer_id)?;
    let settings = load_settings(conn)?;

    let mut stmt = conn.prepare(
        "SELECT e.id, e.task_id, t.title, e.start_time, e.duration_minutes, e.note
           FROM time_entries e
           LEFT JOIN tasks t ON t.id = e.task_id
          WHERE e.customer_id = ?1 AND e.invoiced = 0 AND e.end_time IS NOT NULL
          ORDER BY e.start_time ASC",
    )?;
    let rows = stmt.query_map(params![customer_id], |r| {
        Ok(RawEntry {
            id: r.get(0)?,
            task_id: r.get(1)?,
            task_title: r.get(2)?,
            start_time: r.get(3)?,
            minutes: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            note: r.get(5)?,
        })
    })?;

    // Gruppierung nach Aufgabe, Reihenfolge des ersten Auftretens.
    let mut order: Vec<Option<i64>> = Vec::new();
    let mut groups: std::collections::HashMap<Option<i64>, (String, Vec<RawEntry>)> =
        std::collections::HashMap::new();
    for row in rows {
        let entry = row?;
        let key = entry.task_id;
        let label = entry
            .task_title
            .clone()
            .unwrap_or_else(|| "Sonstige Leistungen".to_string());
        let bucket = groups.entry(key).or_insert_with(|| {
            order.push(key);
            (label, Vec::new())
        });
        bucket.1.push(entry);
    }
    drop(stmt);

    let increment = settings.billing_increment_minutes;
    let rate = customer.hourly_rate_cents;

    let mut positions = Vec::new();
    let mut net_total_cents = 0i64;
    let mut total_minutes = 0i64;

    for key in order {
        let Some((label, entries)) = groups.remove(&key) else {
            continue;
        };
        let minutes: i64 = entries.iter().map(|e| e.minutes).sum();
        if minutes == 0 {
            continue;
        }
        let billed = round_up(minutes, increment);
        let hours = hours_of(billed);
        let unit = rate.unwrap_or(0);
        let net = (hours * unit as f64).round() as i64;

        let text = entries
            .iter()
            .map(|e| {
                let day = DateTime::parse_from_rfc3339(&e.start_time)
                    .map(|d| d.with_timezone(&Local).format("%d.%m.%Y").to_string())
                    .unwrap_or_else(|_| e.start_time.clone());
                let dur = format!("{}:{:02} h", e.minutes / 60, e.minutes % 60);
                match e.note.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
                    Some(note) => format!("{day} · {dur} · {note}"),
                    None => format!("{day} · {dur}"),
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        let name = settings
            .position_name_template
            .replace("{task}", &label)
            .replace("{customer}", &customer.name);

        net_total_cents += net;
        total_minutes += billed;
        positions.push(InvoicePosition {
            task_id: key,
            name: if name.trim().is_empty() { label } else { name },
            text,
            minutes,
            billed_minutes: billed,
            hours,
            unit_price_cents: unit,
            net_cents: net,
            time_entry_ids: entries.iter().map(|e| e.id).collect(),
        });
    }

    // Aufgaben ohne offene Zeit erzeugen keine Position — sie werden deshalb
    // auch nicht automatisch als abgerechnet markiert.
    let mut stmt = conn.prepare(
        "SELECT t.title FROM tasks t
          WHERE t.customer_id = ?1 AND t.invoiced = 0 AND t.status = 'done'
            AND NOT EXISTS (SELECT 1 FROM time_entries e
                             WHERE e.task_id = t.id AND e.invoiced = 0 AND e.end_time IS NOT NULL)
          ORDER BY t.completed_at DESC LIMIT 50",
    )?;
    let tasks_without_time: Vec<String> = stmt
        .query_map(params![customer_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let mut blockers = Vec::new();
    if customer.archived {
        blockers.push("Der Kunde ist archiviert.".to_string());
    }
    if rate.is_none() {
        blockers.push("Für diesen Kunden ist kein Stundensatz hinterlegt.".to_string());
    } else if rate == Some(0) {
        blockers.push("Der Stundensatz ist 0 €.".to_string());
    }
    if positions.is_empty() {
        blockers.push("Es liegt keine unabgerechnete Zeit vor.".to_string());
    }
    if customer.sevdesk_contact_id.is_none() {
        blockers.push("Der Kunde ist noch keinem SevDesk-Kontakt zugeordnet.".to_string());
    }

    let tax_total_cents = (net_total_cents as f64 * settings.tax_rate / 100.0).round() as i64;

    Ok(InvoicePreview {
        customer_id,
        customer_name: customer.name,
        hourly_rate_cents: rate,
        sevdesk_contact_id: customer.sevdesk_contact_id,
        positions,
        net_total_cents,
        total_minutes,
        tax_rate: settings.tax_rate,
        tax_total_cents,
        gross_total_cents: net_total_cents + tax_total_cents,
        tasks_without_time,
        blockers,
    })
}

#[tauri::command]
pub fn invoice_preview(state: State<'_, AppState>, customer_id: i64) -> AppResult<InvoicePreview> {
    let conn = state.db.lock()?;
    build_preview(&conn, customer_id)
}

#[tauri::command]
pub fn list_invoices(state: State<'_, AppState>) -> AppResult<Vec<InvoiceRecord>> {
    let conn = state.db.lock()?;
    let mut stmt = conn.prepare(
        "SELECT i.id, i.customer_id, c.name, i.sevdesk_invoice_id, i.invoice_number,
                i.net_total_cents, i.minutes, i.status, i.created_at
           FROM invoices i JOIN customers c ON c.id = i.customer_id
          ORDER BY i.created_at DESC LIMIT 100",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(InvoiceRecord {
            id: r.get(0)?,
            customer_id: r.get(1)?,
            customer_name: r.get(2)?,
            sevdesk_invoice_id: r.get(3)?,
            invoice_number: r.get(4)?,
            net_total_cents: r.get(5)?,
            minutes: r.get(6)?,
            status: r.get(7)?,
            created_at: r.get(8)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ----------------------------------------------------- SevDesk (Netzwerk)

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SevdeskStatus {
    pub connected: bool,
    pub user_name: Option<String>,
    pub bookkeeping_version: Option<String>,
    pub tax_mode: String,
    pub contact_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SevdeskContact {
    pub id: String,
    pub label: String,
    pub customer_number: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactLink {
    pub customer_id: i64,
    pub contact_id: String,
}

struct Meta {
    contact_person_id: String,
    unity_id: String,
    use_tax_rule: bool,
}

/// Liest ein Feld als String, egal ob SevDesk es als Zahl oder String liefert.
fn sv(value: &Value, key: &str) -> Option<String> {
    match value.get(key)? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn client_from_keychain() -> AppResult<SevDesk> {
    SevDesk::new(keychain::read_token()?)
}

fn contact_label(c: &Value) -> String {
    let org = sv(c, "name");
    let person = match (sv(c, "surename"), sv(c, "familyname")) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        _ => None,
    };
    match (org, person) {
        (Some(o), Some(p)) => format!("{o} ({p})"),
        (Some(o), None) => o,
        (None, Some(p)) => p,
        (None, None) => format!("Kontakt #{}", sv(c, "id").unwrap_or_default()),
    }
}

async fn resolve_meta(
    state: &State<'_, AppState>,
    client: &SevDesk,
    settings: &AppSettings,
) -> AppResult<Meta> {
    let mut contact_person_id = settings.contact_person_id.clone();
    let mut unity_id = settings.unity_id.clone();
    let mut version = settings.bookkeeping_version.clone();

    if contact_person_id.is_none() {
        let users: Vec<Value> = client.get("/SevUser", &[("limit", "1")]).await?;
        contact_person_id = users.first().and_then(|u| sv(u, "id"));
    }

    if unity_id.is_none() {
        let unities: Vec<Value> = client.get("/Unity", &[("limit", "200")]).await?;
        // Stunden-Einheit über den Übersetzungscode finden, Sprache egal.
        unity_id = unities
            .iter()
            .find(|u| {
                sv(u, "translationCode")
                    .map(|c| c.to_uppercase().contains("HOUR"))
                    .unwrap_or(false)
            })
            .or_else(|| {
                unities.iter().find(|u| {
                    matches!(
                        sv(u, "name").as_deref(),
                        Some("Std.") | Some("Stunde") | Some("h") | Some("Stunden")
                    )
                })
            })
            .and_then(|u| sv(u, "id"));
    }

    let use_tax_rule = match settings.tax_mode.as_str() {
        "tax_rule" => true,
        "tax_type" => false,
        _ => {
            if version.is_none() {
                let info: Value = client.get("/Tools/bookkeepingSystemVersion", &[]).await?;
                version = info
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
            version.as_deref().map(|v| v.starts_with('2')).unwrap_or(false)
        }
    };

    let contact_person_id = contact_person_id.ok_or_else(|| {
        AppError::SevDesk(
            "SevDesk hat keinen Benutzer zurückgegeben, der als Ansprechpartner dienen kann."
                .into(),
        )
    })?;
    // Ohne passende Einheit lieber „Stück“ als gar keine Rechnung.
    let unity_id = unity_id.unwrap_or_else(|| "1".to_string());

    {
        let conn = state.db.lock()?;
        put_raw(&conn, "sevdesk.contact_person_id", &contact_person_id)?;
        put_raw(&conn, "sevdesk.unity_id", &unity_id)?;
        if let Some(v) = &version {
            put_raw(&conn, "sevdesk.bookkeeping_version", v)?;
        }
    }

    Ok(Meta {
        contact_person_id,
        unity_id,
        use_tax_rule,
    })
}

#[tauri::command]
pub async fn sevdesk_status(state: State<'_, AppState>) -> AppResult<SevdeskStatus> {
    let settings = {
        let conn = state.db.lock()?;
        load_settings(&conn)?
    };
    let client = client_from_keychain()?;

    let users: Vec<Value> = client.get("/SevUser", &[("limit", "1")]).await?;
    let user_name = users
        .first()
        .and_then(|u| sv(u, "fullname").or_else(|| sv(u, "username")));

    let version = match settings.bookkeeping_version.clone() {
        Some(v) => Some(v),
        None => {
            let info: Value = client.get("/Tools/bookkeepingSystemVersion", &[]).await?;
            info.get("version")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        }
    };

    let contacts: Vec<Value> = client.get("/Contact", &[("limit", "1000")]).await?;

    {
        let conn = state.db.lock()?;
        if let Some(v) = &version {
            put_raw(&conn, "sevdesk.bookkeeping_version", v)?;
        }
    }

    let tax_mode = match settings.tax_mode.as_str() {
        "tax_rule" => "tax_rule",
        "tax_type" => "tax_type",
        _ if version.as_deref().map(|v| v.starts_with('2')).unwrap_or(false) => "tax_rule",
        _ => "tax_type",
    };

    Ok(SevdeskStatus {
        connected: true,
        user_name,
        bookkeeping_version: version,
        tax_mode: tax_mode.to_string(),
        contact_count: contacts.len(),
    })
}

#[tauri::command]
pub async fn sevdesk_list_contacts(search: Option<String>) -> AppResult<Vec<SevdeskContact>> {
    let client = client_from_keychain()?;
    let contacts: Vec<Value> = client
        .get("/Contact", &[("limit", "1000"), ("depth", "1")])
        .await?;

    let needle = search
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    let mut out: Vec<SevdeskContact> = contacts
        .iter()
        .filter_map(|c| {
            let id = sv(c, "id")?;
            let label = contact_label(c);
            Some(SevdeskContact {
                id,
                customer_number: sv(c, "customerNumber"),
                label,
            })
        })
        .filter(|c| match &needle {
            Some(n) => c.label.to_lowercase().contains(n),
            None => true,
        })
        .collect();
    out.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn sevdesk_link_customer(state: State<'_, AppState>, link: ContactLink) -> AppResult<()> {
    let id = link.contact_id.trim();
    if id.is_empty() {
        return Err(AppError::Validation("Es wurde kein Kontakt gewählt".into()));
    }
    let conn = state.db.lock()?;
    let changed = conn.execute(
        "UPDATE customers SET sevdesk_contact_id = ?2 WHERE id = ?1",
        params![link.customer_id, id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Dieser Kunde existiert nicht".into()));
    }
    Ok(())
}

#[tauri::command]
pub fn sevdesk_unlink_customer(state: State<'_, AppState>, customer_id: i64) -> AppResult<()> {
    let conn = state.db.lock()?;
    conn.execute(
        "UPDATE customers SET sevdesk_contact_id = NULL WHERE id = ?1",
        params![customer_id],
    )?;
    Ok(())
}

/// Legt den Kunden als neuen Kontakt in SevDesk an und verknüpft ihn.
#[tauri::command]
pub async fn sevdesk_create_contact(
    state: State<'_, AppState>,
    customer_id: i64,
) -> AppResult<SevdeskContact> {
    let customer = {
        let conn = state.db.lock()?;
        crate::commands::customers::fetch(&conn, customer_id)?
    };
    if customer.sevdesk_contact_id.is_some() {
        return Err(AppError::Conflict(
            "Dieser Kunde ist bereits mit einem SevDesk-Kontakt verknüpft".into(),
        ));
    }

    // Kategorie 3 = Kunde.
    let mut payload = json!({
        "objectName": "Contact",
        "mapAll": true,
        "category": { "id": 3, "objectName": "Category" }
    });

    match customer.company.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(company) => {
            payload["name"] = json!(company);
        }
        None => {
            // SevDesk verlangt bei Privatpersonen Vor- und Nachname.
            let mut parts = customer.name.trim().splitn(2, ' ');
            let first = parts.next().unwrap_or("").to_string();
            let last = parts.next().unwrap_or("").trim().to_string();
            if last.is_empty() {
                payload["name"] = json!(customer.name);
            } else {
                payload["surename"] = json!(first);
                payload["familyname"] = json!(last);
            }
        }
    }

    let client = client_from_keychain()?;
    let created: Value = client.post("/Contact", &payload).await?;
    let id = sv(&created, "id").ok_or_else(|| {
        AppError::SevDesk("SevDesk hat den neuen Kontakt ohne ID zurückgegeben".into())
    })?;

    {
        let conn = state.db.lock()?;
        conn.execute(
            "UPDATE customers SET sevdesk_contact_id = ?2 WHERE id = ?1",
            params![customer_id, id],
        )?;
    }

    Ok(SevdeskContact {
        label: contact_label(&created),
        customer_number: sv(&created, "customerNumber"),
        id,
    })
}

fn build_payload(
    preview: &InvoicePreview,
    settings: &AppSettings,
    meta: &Meta,
    contact_id: &str,
) -> Value {
    let today = Local::now().format("%d.%m.%Y").to_string();

    let mut invoice = json!({
        "objectName": "Invoice",
        "mapAll": true,
        "invoiceType": "RE",
        // 100 = Entwurf. Es wird bewusst nichts automatisch versendet.
        "status": "100",
        "currency": "EUR",
        "invoiceDate": today,
        "deliveryDate": today,
        "header": "Rechnung",
        "headText": settings.invoice_head_text,
        "footText": settings.invoice_foot_text,
        "timeToPay": settings.time_to_pay_days,
        "discount": 0,
        "smallSettlement": 0,
        "showNet": "1",
        "taxRate": settings.tax_rate,
        "taxText": settings.tax_text,
        "contact": { "id": contact_id, "objectName": "Contact" },
        "contactPerson": { "id": meta.contact_person_id, "objectName": "SevUser" }
    });

    // Buchhaltungsversion 2.x kennt taxType nicht mehr, sondern taxRule.
    if meta.use_tax_rule {
        invoice["taxRule"] = json!({ "id": settings.tax_rule_id, "objectName": "TaxRule" });
    } else {
        invoice["taxType"] = json!(settings.tax_type);
    }

    let positions: Vec<Value> = preview
        .positions
        .iter()
        .map(|p| {
            json!({
                "objectName": "InvoicePos",
                "mapAll": true,
                "quantity": p.hours,
                "price": p.unit_price_cents as f64 / 100.0,
                "name": p.name,
                "text": p.text,
                "unity": { "id": meta.unity_id, "objectName": "Unity" },
                "taxRate": settings.tax_rate
            })
        })
        .collect();

    json!({
        "invoice": invoice,
        "invoicePosSave": positions,
        "invoicePosDelete": null,
        "discountSave": null,
        "discountDelete": null
    })
}

/// Markiert alles in genau einer Transaktion: entweder sind Rechnungssatz,
/// Zeiteinträge und Aufgaben gemeinsam markiert — oder nichts davon.
fn mark_invoiced(
    conn: &mut Connection,
    preview: &InvoicePreview,
    sevdesk_invoice_id: &str,
    invoice_number: Option<&str>,
) -> AppResult<(usize, usize)> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO invoices (customer_id, sevdesk_invoice_id, invoice_number,
                               net_total_cents, minutes, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'draft_created', ?6)",
        params![
            preview.customer_id,
            sevdesk_invoice_id,
            invoice_number,
            preview.net_total_cents,
            preview.total_minutes,
            now_utc()
        ],
    )?;
    let invoice_row_id = tx.last_insert_rowid();

    let mut entries = 0usize;
    let mut tasks = 0usize;

    for position in &preview.positions {
        for entry_id in &position.time_entry_ids {
            tx.execute(
                "UPDATE time_entries SET invoiced = 1 WHERE id = ?1 AND invoiced = 0",
                params![entry_id],
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO invoice_items (invoice_id, kind, ref_id)
                 VALUES (?1, 'time_entry', ?2)",
                params![invoice_row_id, entry_id],
            )?;
            entries += 1;
        }
        if let Some(task_id) = position.task_id {
            tx.execute(
                "UPDATE tasks SET invoiced = 1 WHERE id = ?1",
                params![task_id],
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO invoice_items (invoice_id, kind, ref_id)
                 VALUES (?1, 'task', ?2)",
                params![invoice_row_id, task_id],
            )?;
            tasks += 1;
        }
    }

    tx.commit()?;
    Ok((entries, tasks))
}

#[tauri::command]
pub async fn create_sevdesk_invoice(
    state: State<'_, AppState>,
    customer_id: i64,
) -> AppResult<InvoiceResult> {
    let (preview, settings) = {
        let conn = state.db.lock()?;
        (build_preview(&conn, customer_id)?, load_settings(&conn)?)
    };

    if !preview.blockers.is_empty() {
        return Err(AppError::Validation(format!(
            "Rechnung nicht möglich: {}",
            preview.blockers.join(" ")
        )));
    }
    let contact_id = preview
        .sevdesk_contact_id
        .clone()
        .ok_or_else(|| AppError::Validation("Kein SevDesk-Kontakt verknüpft".into()))?;

    let client = client_from_keychain()?;
    let meta = resolve_meta(&state, &client, &settings).await?;
    let payload = build_payload(&preview, &settings, &meta, &contact_id);

    let created: Value = client.post("/Invoice/Factory/saveInvoice", &payload).await?;
    let invoice = created.get("invoice").unwrap_or(&created);

    let sevdesk_invoice_id = sv(invoice, "id").ok_or_else(|| {
        AppError::SevDesk(
            "SevDesk hat die Rechnung ohne ID bestätigt. Bitte im SevDesk-Konto nachsehen, \
             ob ein Entwurf angelegt wurde."
                .into(),
        )
    })?;
    let invoice_number = sv(invoice, "invoiceNumber");

    // Ab hier existiert die Rechnung bereits bei SevDesk. Scheitert das lokale
    // Markieren, darf das nicht als „nichts passiert“ durchgehen.
    let (marked_time_entries, marked_tasks) = {
        let mut conn = state.db.lock()?;
        mark_invoiced(
            &mut conn,
            &preview,
            &sevdesk_invoice_id,
            invoice_number.as_deref(),
        )
        .map_err(|e| {
            AppError::Conflict(format!(
                "Der Rechnungsentwurf {} wurde in SevDesk angelegt, konnte aber lokal nicht als \
                 abgerechnet markiert werden ({e}). Bitte den Entwurf in SevDesk prüfen und die \
                 Einträge von Hand als abgerechnet setzen, sonst tauchen sie erneut auf.",
                invoice_number
                    .clone()
                    .unwrap_or_else(|| format!("#{sevdesk_invoice_id}"))
            ))
        })?
    };

    Ok(InvoiceResult {
        sevdesk_url: format!("{WEB_BASE}/fi/edit/type/RE/id/{sevdesk_invoice_id}"),
        invoice_number,
        sevdesk_invoice_id,
        net_total_cents: preview.net_total_cents,
        positions: preview.positions.len(),
        marked_time_entries,
        marked_tasks,
    })
}

#[cfg(test)]
mod tests {
    use super::{hours_of, round_up};

    #[test]
    fn taktung_rundet_immer_auf() {
        assert_eq!(round_up(1, 15), 15);
        assert_eq!(round_up(15, 15), 15);
        assert_eq!(round_up(16, 15), 30);
        assert_eq!(round_up(90, 30), 90);
        // 0 und 1 bedeuten „minutengenau“ und dürfen nichts verändern.
        assert_eq!(round_up(37, 0), 37);
        assert_eq!(round_up(37, 1), 37);
    }

    #[test]
    fn stunden_werden_auf_zwei_stellen_gerundet() {
        assert_eq!(hours_of(60), 1.0);
        assert_eq!(hours_of(90), 1.5);
        assert_eq!(hours_of(20), 0.33);
        assert_eq!(hours_of(100), 1.67);
    }

    /// Der lokal ausgewiesene Betrag muss dem entsprechen, was SevDesk aus
    /// Menge × Preis errechnet — sonst weicht die Rechnung von der Vorschau ab.
    #[test]
    fn betrag_entspricht_menge_mal_preis() {
        for (minutes, rate_cents) in [(100i64, 9500i64), (37, 8000), (455, 12550), (7, 6000)] {
            let hours = hours_of(minutes);
            let ours = (hours * rate_cents as f64).round() as i64;
            let sevdesk = (hours * (rate_cents as f64 / 100.0) * 100.0).round() as i64;
            assert_eq!(ours, sevdesk, "bei {minutes} min zu {rate_cents} ct");
        }
    }
}
