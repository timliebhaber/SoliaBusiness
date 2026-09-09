use crate::error::{AppError, AppResult};
use crate::keychain;
use crate::state::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Wie die Steuer an SevDesk übergeben wird. "auto" ermittelt es einmalig
    /// über die Buchhaltungsversion des Accounts.
    pub tax_mode: String,
    pub tax_rate: f64,
    pub tax_text: String,
    pub tax_rule_id: String,
    pub tax_type: String,
    pub time_to_pay_days: i64,
    pub invoice_head_text: String,
    pub invoice_foot_text: String,
    /// Abrechnungstaktung in Minuten (0 = minutengenau, sonst z. B. 15).
    pub billing_increment_minutes: i64,
    pub position_name_template: String,
    pub weekly_report_enabled: bool,
    pub bookkeeping_version: Option<String>,
    pub unity_id: Option<String>,
    pub contact_person_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            tax_mode: "auto".into(),
            tax_rate: 19.0,
            tax_text: "Umsatzsteuer 19 %".into(),
            tax_rule_id: "1".into(),
            tax_type: "default".into(),
            time_to_pay_days: 14,
            invoice_head_text: String::new(),
            invoice_foot_text: String::new(),
            billing_increment_minutes: 0,
            position_name_template: "{task}".into(),
            weekly_report_enabled: false,
            bookkeeping_version: None,
            unity_id: None,
            contact_person_id: None,
        }
    }
}

fn get_raw(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
            r.get::<_, String>(0)
        })
        .optional()?)
}

pub fn put_raw(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn load(conn: &Connection) -> AppResult<AppSettings> {
    let mut s = AppSettings::default();
    let text = |k: &str| get_raw(conn, k);

    if let Some(v) = text("sevdesk.tax_mode")? {
        s.tax_mode = v;
    }
    if let Some(v) = text("sevdesk.tax_rate")? {
        s.tax_rate = v.parse().unwrap_or(s.tax_rate);
    }
    if let Some(v) = text("sevdesk.tax_text")? {
        s.tax_text = v;
    }
    if let Some(v) = text("sevdesk.tax_rule_id")? {
        s.tax_rule_id = v;
    }
    if let Some(v) = text("sevdesk.tax_type")? {
        s.tax_type = v;
    }
    if let Some(v) = text("sevdesk.time_to_pay_days")? {
        s.time_to_pay_days = v.parse().unwrap_or(s.time_to_pay_days);
    }
    if let Some(v) = text("sevdesk.head_text")? {
        s.invoice_head_text = v;
    }
    if let Some(v) = text("sevdesk.foot_text")? {
        s.invoice_foot_text = v;
    }
    if let Some(v) = text("billing.increment_minutes")? {
        s.billing_increment_minutes = v.parse().unwrap_or(0);
    }
    if let Some(v) = text("billing.position_name_template")? {
        s.position_name_template = v;
    }
    if let Some(v) = text("ui.weekly_report_enabled")? {
        s.weekly_report_enabled = v == "1";
    }
    s.bookkeeping_version = text("sevdesk.bookkeeping_version")?;
    s.unity_id = text("sevdesk.unity_id")?;
    s.contact_person_id = text("sevdesk.contact_person_id")?;
    Ok(s)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    let conn = state.db.lock()?;
    load(&conn)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> AppResult<AppSettings> {
    if !(0.0..=100.0).contains(&settings.tax_rate) {
        return Err(AppError::Validation(
            "Der Steuersatz muss zwischen 0 und 100 liegen".into(),
        ));
    }
    if !(0..=180).contains(&settings.time_to_pay_days) {
        return Err(AppError::Validation(
            "Das Zahlungsziel muss zwischen 0 und 180 Tagen liegen".into(),
        ));
    }
    if ![0, 5, 6, 10, 15, 30, 60].contains(&settings.billing_increment_minutes) {
        return Err(AppError::Validation(
            "Erlaubte Taktungen: 0, 5, 6, 10, 15, 30 oder 60 Minuten".into(),
        ));
    }
    if !["auto", "tax_type", "tax_rule"].contains(&settings.tax_mode.as_str()) {
        return Err(AppError::Validation("Unbekannter Steuermodus".into()));
    }

    let conn = state.db.lock()?;
    put_raw(&conn, "sevdesk.tax_mode", &settings.tax_mode)?;
    put_raw(&conn, "sevdesk.tax_rate", &settings.tax_rate.to_string())?;
    put_raw(&conn, "sevdesk.tax_text", &settings.tax_text)?;
    put_raw(&conn, "sevdesk.tax_rule_id", &settings.tax_rule_id)?;
    put_raw(&conn, "sevdesk.tax_type", &settings.tax_type)?;
    put_raw(
        &conn,
        "sevdesk.time_to_pay_days",
        &settings.time_to_pay_days.to_string(),
    )?;
    put_raw(&conn, "sevdesk.head_text", &settings.invoice_head_text)?;
    put_raw(&conn, "sevdesk.foot_text", &settings.invoice_foot_text)?;
    put_raw(
        &conn,
        "billing.increment_minutes",
        &settings.billing_increment_minutes.to_string(),
    )?;
    put_raw(
        &conn,
        "billing.position_name_template",
        &settings.position_name_template,
    )?;
    put_raw(
        &conn,
        "ui.weekly_report_enabled",
        if settings.weekly_report_enabled { "1" } else { "0" },
    )?;
    load(&conn)
}

// ------------------------------------------------------------- Schlüsselbund

#[tauri::command]
pub fn set_sevdesk_token(token: String) -> AppResult<Option<String>> {
    keychain::store_token(&token)?;
    keychain::token_hint()
}

#[tauri::command]
pub fn clear_sevdesk_token() -> AppResult<()> {
    keychain::delete_token()
}

#[tauri::command]
pub fn sevdesk_token_hint() -> AppResult<Option<String>> {
    keychain::token_hint()
}
