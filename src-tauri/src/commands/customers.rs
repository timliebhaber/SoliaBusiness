use super::*;
use crate::error::{AppError, AppResult};
use crate::models::{Customer, CustomerInput, CustomerSummary};
use crate::state::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use tauri::State;

const COLS: &str = "id, name, company, email, hourly_rate_cents, sevdesk_contact_id, \
                    notes, archived, created_at";

fn map(row: &Row) -> rusqlite::Result<Customer> {
    Ok(Customer {
        id: row.get(0)?,
        name: row.get(1)?,
        company: row.get(2)?,
        email: row.get(3)?,
        hourly_rate_cents: row.get(4)?,
        sevdesk_contact_id: row.get(5)?,
        notes: row.get(6)?,
        archived: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
    })
}

pub fn fetch(conn: &Connection, id: i64) -> AppResult<Customer> {
    conn.query_row(
        &format!("SELECT {COLS} FROM customers WHERE id = ?1"),
        params![id],
        map,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound("Dieser Kunde existiert nicht (mehr)".into()))
}

#[tauri::command]
pub fn list_customers(
    state: State<'_, AppState>,
    include_archived: bool,
    search: Option<String>,
) -> AppResult<Vec<CustomerSummary>> {
    let conn = state.db.lock()?;
    let needle = search
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    // Kennzahlen kommen aus korrelierten Unterabfragen statt aus mehreren
    // Roundtrips — die Liste bleibt so auch bei vielen Kunden ein Query.
    let sql = format!(
        "SELECT {COLS},
            (SELECT COUNT(*) FROM tasks t
              WHERE t.customer_id = c.id AND t.status <> 'done') AS open_tasks,
            (SELECT COUNT(*) FROM tasks t
              WHERE t.customer_id = c.id AND t.status <> 'done'
                AND t.deadline IS NOT NULL AND t.deadline < date('now','localtime')) AS overdue,
            (SELECT COALESCE(SUM(duration_minutes),0) FROM time_entries e
              WHERE e.customer_id = c.id AND e.end_time IS NOT NULL AND e.invoiced = 0) AS unbilled,
            (SELECT COALESCE(SUM(duration_minutes),0) FROM time_entries e
              WHERE e.customer_id = c.id AND e.end_time IS NOT NULL) AS tracked
         FROM customers c
         WHERE (?1 = 1 OR c.archived = 0)
           AND (?2 IS NULL
                OR lower(c.name) LIKE '%' || ?2 || '%'
                OR lower(COALESCE(c.company,'')) LIKE '%' || ?2 || '%'
                OR lower(COALESCE(c.email,'')) LIKE '%' || ?2 || '%')
         ORDER BY c.archived ASC, c.name COLLATE NOCASE ASC"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![include_archived as i64, needle], |row| {
        let customer = map(row)?;
        let unbilled_minutes: i64 = row.get(11)?;
        let cents = customer
            .hourly_rate_cents
            .map(|rate| (unbilled_minutes as f64 / 60.0 * rate as f64).round() as i64)
            .unwrap_or(0);
        Ok(CustomerSummary {
            open_tasks: row.get(9)?,
            overdue_tasks: row.get(10)?,
            unbilled_minutes,
            unbilled_cents: cents,
            tracked_minutes_total: row.get(12)?,
            customer,
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_customer(state: State<'_, AppState>, input: CustomerInput) -> AppResult<Customer> {
    let name = require_text("Der Name", &input.name)?;
    let company = opt_trim(input.company);
    let email = opt_trim(input.email);
    let notes = opt_trim(input.notes);
    validate_email(&email)?;
    validate_rate(input.hourly_rate_cents)?;

    let conn = state.db.lock()?;
    conn.execute(
        "INSERT INTO customers (name, company, email, hourly_rate_cents, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![name, company, email, input.hourly_rate_cents, notes, now_utc()],
    )?;
    fetch(&conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn update_customer(
    state: State<'_, AppState>,
    id: i64,
    input: CustomerInput,
) -> AppResult<Customer> {
    let name = require_text("Der Name", &input.name)?;
    let company = opt_trim(input.company);
    let email = opt_trim(input.email);
    let notes = opt_trim(input.notes);
    validate_email(&email)?;
    validate_rate(input.hourly_rate_cents)?;

    let conn = state.db.lock()?;
    let changed = conn.execute(
        "UPDATE customers
            SET name = ?2, company = ?3, email = ?4, hourly_rate_cents = ?5, notes = ?6
          WHERE id = ?1",
        params![id, name, company, email, input.hourly_rate_cents, notes],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(
            "Dieser Kunde existiert nicht (mehr)".into(),
        ));
    }
    fetch(&conn, id)
}

#[tauri::command]
pub fn set_customer_archived(
    state: State<'_, AppState>,
    id: i64,
    archived: bool,
) -> AppResult<Customer> {
    let conn = state.db.lock()?;

    if archived {
        // Ein laufender Timer auf diesem Kunden würde sonst unsichtbar werden.
        let running: i64 = conn.query_row(
            "SELECT COUNT(*) FROM time_entries WHERE customer_id = ?1 AND end_time IS NULL",
            params![id],
            |r| r.get(0),
        )?;
        if running > 0 {
            return Err(AppError::Conflict(
                "Für diesen Kunden läuft gerade ein Timer. Bitte erst stoppen.".into(),
            ));
        }
    }

    let changed = conn.execute(
        "UPDATE customers SET archived = ?2 WHERE id = ?1",
        params![id, archived as i64],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(
            "Dieser Kunde existiert nicht (mehr)".into(),
        ));
    }
    fetch(&conn, id)
}

/// Endgültiges Löschen ist nur erlaubt, solange keine Aufgaben oder Zeiten
/// daran hängen — sonst bleibt Archivieren der richtige Weg.
#[tauri::command]
pub fn delete_customer(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock()?;
    let tasks: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE customer_id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    let entries: i64 = conn.query_row(
        "SELECT COUNT(*) FROM time_entries WHERE customer_id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    if tasks > 0 || entries > 0 {
        return Err(AppError::Conflict(format!(
            "An diesem Kunden hängen {tasks} Aufgaben und {entries} Zeiteinträge. \
             Archivieren statt löschen, damit die Historie erhalten bleibt."
        )));
    }
    let changed = conn.execute("DELETE FROM customers WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(
            "Dieser Kunde existiert nicht (mehr)".into(),
        ));
    }
    Ok(())
}
