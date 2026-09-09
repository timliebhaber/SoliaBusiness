pub mod customers;
pub mod dashboard;
pub mod export;
pub mod invoicing;
pub mod settings;
pub mod tasks;
pub mod time;

use crate::error::{AppError, AppResult};
use chrono::{DateTime, SecondsFormat, Utc};

/// Zeitstempel-Normalform der App: RFC3339 in UTC, sekundengenau.
pub fn now_utc() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub fn parse_ts(field: &str, value: &str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| AppError::Validation(format!("{field} ist kein gültiger Zeitstempel")))
}

pub fn normalize_ts(field: &str, value: &str) -> AppResult<String> {
    Ok(parse_ts(field, value)?.to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// Leere und reine Whitespace-Eingaben werden zu NULL statt zu "".
pub fn opt_trim(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn require_text(field: &str, value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{field} darf nicht leer sein")));
    }
    if trimmed.chars().count() > 500 {
        return Err(AppError::Validation(format!(
            "{field} ist zu lang (max. 500 Zeichen)"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_email(value: &Option<String>) -> AppResult<()> {
    if let Some(mail) = value {
        let ok = mail.contains('@') && !mail.starts_with('@') && !mail.ends_with('@');
        if !ok {
            return Err(AppError::Validation(
                "Die E-Mail-Adresse sieht nicht gültig aus".into(),
            ));
        }
    }
    Ok(())
}

/// Erwartet ein Datum in der Form YYYY-MM-DD.
pub fn validate_date(value: &Option<String>) -> AppResult<()> {
    if let Some(d) = value {
        if chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_err() {
            return Err(AppError::Validation(
                "Die Deadline muss im Format JJJJ-MM-TT vorliegen".into(),
            ));
        }
    }
    Ok(())
}

pub fn validate_rate(cents: Option<i64>) -> AppResult<()> {
    match cents {
        Some(c) if c < 0 => Err(AppError::Validation(
            "Der Stundensatz darf nicht negativ sein".into(),
        )),
        Some(c) if c > 100_000_00 => Err(AppError::Validation(
            "Der Stundensatz wirkt unrealistisch hoch".into(),
        )),
        _ => Ok(()),
    }
}

pub fn validate_minutes(field: &str, minutes: Option<i64>) -> AppResult<()> {
    match minutes {
        Some(m) if m < 0 => Err(AppError::Validation(format!(
            "{field} darf nicht negativ sein"
        ))),
        Some(m) if m > 60 * 24 * 365 => Err(AppError::Validation(format!("{field} ist zu groß"))),
        _ => Ok(()),
    }
}
