use crate::error::AppResult;
use crate::models::TimeEntryFilter;
use crate::state::AppState;
use chrono::{DateTime, Local};
use rusqlite::params_from_iter;
use std::path::PathBuf;
use tauri::State;

/// Semikolon-getrennt mit BOM — so öffnet Excel/Numbers die Datei unter
/// deutscher Lokalisierung ohne Import-Dialog korrekt.
const SEPARATOR: char = ';';

fn escape(field: &str) -> String {
    if field.contains(SEPARATOR) || field.contains('"') || field.contains('\n') || field.contains('\r')
    {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn row(fields: &[String]) -> String {
    fields
        .iter()
        .map(|f| escape(f))
        .collect::<Vec<_>>()
        .join(&SEPARATOR.to_string())
}

fn local_parts(rfc3339: &str) -> (String, String) {
    match DateTime::parse_from_rfc3339(rfc3339) {
        Ok(dt) => {
            let local = dt.with_timezone(&Local);
            (
                local.format("%d.%m.%Y").to_string(),
                local.format("%H:%M").to_string(),
            )
        }
        Err(_) => (rfc3339.to_string(), String::new()),
    }
}

/// Deutsche Dezimalschreibweise, damit Tabellenkalkulationen rechnen können.
fn de_decimal(value: f64) -> String {
    format!("{value:.2}").replace('.', ",")
}

#[tauri::command]
pub fn export_time_entries_csv(
    state: State<'_, AppState>,
    path: String,
    filter: TimeEntryFilter,
) -> AppResult<usize> {
    let conn = state.db.lock()?;
    let (sql, args) = crate::commands::time::build_query(&filter);

    // Für den Export interessiert zusätzlich der Stundensatz zum Kunden.
    let sql = sql.replace(
        "SELECT e.id,",
        "SELECT c.hourly_rate_cents AS rate, e.id,",
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(args.iter()))?;

    let mut out = String::from("\u{feff}");
    out.push_str(&row(&[
        "Datum".into(),
        "Start".into(),
        "Ende".into(),
        "Minuten".into(),
        "Stunden".into(),
        "Kunde".into(),
        "Aufgabe".into(),
        "Notiz".into(),
        "Abgerechnet".into(),
        "Stundensatz".into(),
        "Betrag netto".into(),
    ]));
    out.push('\n');

    let mut count = 0usize;
    while let Some(r) = rows.next()? {
        let rate: Option<i64> = r.get(0)?;
        let customer: String = r.get(3)?;
        let task: Option<String> = r.get(5)?;
        let start: String = r.get(6)?;
        let end: Option<String> = r.get(7)?;
        let minutes: Option<i64> = r.get(8)?;
        let note: Option<String> = r.get(9)?;
        let invoiced: i64 = r.get(10)?;

        let (date, start_time) = local_parts(&start);
        let end_time = end.map(|e| local_parts(&e).1).unwrap_or_default();
        let minutes = minutes.unwrap_or(0);
        let hours = minutes as f64 / 60.0;
        let amount = rate.map(|c| hours * c as f64 / 100.0);

        out.push_str(&row(&[
            date,
            start_time,
            end_time,
            minutes.to_string(),
            de_decimal(hours),
            customer,
            task.unwrap_or_default(),
            note.unwrap_or_default(),
            if invoiced == 1 { "ja".into() } else { "nein".into() },
            rate.map(|c| de_decimal(c as f64 / 100.0)).unwrap_or_default(),
            amount.map(de_decimal).unwrap_or_default(),
        ]));
        out.push('\n');
        count += 1;
    }

    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, out)?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::{de_decimal, escape, row};

    #[test]
    fn felder_mit_sonderzeichen_werden_gequotet() {
        assert_eq!(escape("einfach"), "einfach");
        assert_eq!(escape("mit;Semikolon"), "\"mit;Semikolon\"");
        assert_eq!(escape("mit\"Anfuehrung"), "\"mit\"\"Anfuehrung\"");
        assert_eq!(escape("zwei\nZeilen"), "\"zwei\nZeilen\"");
    }

    #[test]
    fn zeile_trennt_mit_semikolon() {
        assert_eq!(
            row(&["a".into(), "b;c".into(), "d".into()]),
            "a;\"b;c\";d"
        );
    }

    #[test]
    fn dezimaltrennzeichen_ist_das_komma() {
        assert_eq!(de_decimal(1.5), "1,50");
        assert_eq!(de_decimal(0.0), "0,00");
        assert_eq!(de_decimal(95.0), "95,00");
    }
}
