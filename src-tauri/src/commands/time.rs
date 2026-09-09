use super::*;
use crate::error::{AppError, AppResult};
use crate::models::{
    ManualTimeEntryInput, RunningTimer, TimeEntry, TimeEntryFilter, TimeEntryPatch,
};
use crate::state::AppState;
use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use tauri::{AppHandle, Emitter, State};

const SELECT: &str = "SELECT e.id, e.customer_id, c.name, e.task_id, t.title, e.start_time,
        e.end_time, e.duration_minutes, e.note, e.invoiced, e.created_at
   FROM time_entries e
   JOIN customers c ON c.id = e.customer_id
   LEFT JOIN tasks t ON t.id = e.task_id";

fn map(row: &Row) -> rusqlite::Result<TimeEntry> {
    Ok(TimeEntry {
        id: row.get(0)?,
        customer_id: row.get(1)?,
        customer_name: row.get(2)?,
        task_id: row.get(3)?,
        task_title: row.get(4)?,
        start_time: row.get(5)?,
        end_time: row.get(6)?,
        duration_minutes: row.get(7)?,
        note: row.get(8)?,
        invoiced: row.get::<_, i64>(9)? != 0,
        created_at: row.get(10)?,
    })
}

fn fetch(conn: &Connection, id: i64) -> AppResult<TimeEntry> {
    conn.query_row(&format!("{SELECT} WHERE e.id = ?1"), params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound("Dieser Zeiteintrag existiert nicht (mehr)".into()))
}

/// Der laufende Timer lebt ausschließlich in SQLite. Nach einem Absturz oder
/// Neustart wird er von hier gelesen, nicht aus einem Frontend-State.
pub fn running(conn: &Connection) -> AppResult<Option<RunningTimer>> {
    let row = conn
        .query_row(
            "SELECT e.id, e.customer_id, c.name, e.task_id, t.title, e.start_time
               FROM time_entries e
               JOIN customers c ON c.id = e.customer_id
               LEFT JOIN tasks t ON t.id = e.task_id
              WHERE e.end_time IS NULL",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;

    let Some((id, customer_id, customer_name, task_id, task_title, start_time)) = row else {
        return Ok(None);
    };
    let started = parse_ts("Startzeit", &start_time)?;
    Ok(Some(RunningTimer {
        id,
        customer_id,
        customer_name,
        task_id,
        task_title,
        elapsed_seconds: (Utc::now() - started).num_seconds().max(0),
        start_time,
    }))
}

fn duration_minutes(start: &str, end: &str) -> AppResult<i64> {
    let s = parse_ts("Startzeit", start)?;
    let e = parse_ts("Endzeit", end)?;
    let seconds = (e - s).num_seconds();
    if seconds <= 0 {
        return Err(AppError::Validation(
            "Die Endzeit muss nach der Startzeit liegen".into(),
        ));
    }
    if seconds > 24 * 3600 {
        return Err(AppError::Validation(
            "Ein Eintrag über mehr als 24 Stunden ist vermutlich ein Vertipper".into(),
        ));
    }
    // Angefangene Minuten zählen als eine Minute — ein Eintrag verschwindet nie auf 0.
    Ok(((seconds as f64) / 60.0).round().max(1.0) as i64)
}

fn task_belongs_to(conn: &Connection, task_id: Option<i64>, customer_id: i64) -> AppResult<()> {
    let Some(task_id) = task_id else {
        return Ok(());
    };
    let owner: Option<i64> = conn
        .query_row("SELECT customer_id FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0))
        .optional()?;
    match owner {
        None => Err(AppError::NotFound("Diese Aufgabe existiert nicht".into())),
        Some(o) if o != customer_id => Err(AppError::Validation(
            "Die Aufgabe gehört zu einem anderen Kunden".into(),
        )),
        _ => Ok(()),
    }
}

fn notify_timer_change(app: &AppHandle) {
    // Tray und alle Fenster hängen an demselben Ereignis.
    let _ = app.emit("timer-changed", ());
    crate::tray::refresh(app);
}

#[tauri::command]
pub fn get_running_timer(state: State<'_, AppState>) -> AppResult<Option<RunningTimer>> {
    let conn = state.db.lock()?;
    running(&conn)
}

#[tauri::command]
pub fn start_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    customer_id: i64,
    task_id: Option<i64>,
) -> AppResult<RunningTimer> {
    {
        let conn = state.db.lock()?;

        if let Some(current) = running(&conn)? {
            return Err(AppError::Conflict(format!(
                "Es läuft bereits ein Timer für {}. Bitte zuerst stoppen.",
                current.customer_name
            )));
        }

        let archived: Option<i64> = conn
            .query_row(
                "SELECT archived FROM customers WHERE id = ?1",
                params![customer_id],
                |r| r.get(0),
            )
            .optional()?;
        match archived {
            None => return Err(AppError::NotFound("Dieser Kunde existiert nicht".into())),
            Some(1) => {
                return Err(AppError::Validation(
                    "Für archivierte Kunden lässt sich keine Zeit erfassen".into(),
                ))
            }
            _ => {}
        }
        task_belongs_to(&conn, task_id, customer_id)?;

        let now = now_utc();
        conn.execute(
            "INSERT INTO time_entries (customer_id, task_id, start_time, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![customer_id, task_id, now, now],
        )?;
    }

    notify_timer_change(&app);
    let conn = state.db.lock()?;
    running(&conn)?.ok_or_else(|| AppError::Internal("Timer konnte nicht gelesen werden".into()))
}

/// Notiz ist Pflicht — sie wird bewusst erst beim Stoppen erfasst.
#[tauri::command]
pub fn stop_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    note: String,
) -> AppResult<TimeEntry> {
    let note = require_text("Die Notiz", &note)?;
    let id = {
        let conn = state.db.lock()?;
        let current =
            running(&conn)?.ok_or_else(|| AppError::Conflict("Es läuft gerade kein Timer".into()))?;

        let end = now_utc();
        let minutes = duration_minutes(&current.start_time, &end)?;
        conn.execute(
            "UPDATE time_entries SET end_time = ?2, duration_minutes = ?3, note = ?4
              WHERE id = ?1 AND end_time IS NULL",
            params![current.id, end, minutes, note],
        )?;
        current.id
    };

    notify_timer_change(&app);
    let conn = state.db.lock()?;
    fetch(&conn, id)
}

/// Verwirft den laufenden Timer ersatzlos (z. B. versehentlich gestartet).
#[tauri::command]
pub fn discard_timer(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    {
        let conn = state.db.lock()?;
        conn.execute("DELETE FROM time_entries WHERE end_time IS NULL", [])?;
    }
    notify_timer_change(&app);
    Ok(())
}

/// Während der Timer läuft: Aufgabe zuordnen oder Startzeit korrigieren
/// (etwa wenn der Start vergessen wurde).
#[tauri::command]
pub fn update_running_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: Option<i64>,
    start_time: Option<String>,
) -> AppResult<RunningTimer> {
    {
        let conn = state.db.lock()?;
        let current =
            running(&conn)?.ok_or_else(|| AppError::Conflict("Es läuft gerade kein Timer".into()))?;
        task_belongs_to(&conn, task_id, current.customer_id)?;

        let start = match start_time {
            Some(raw) => {
                let normalized = normalize_ts("Startzeit", &raw)?;
                let parsed = parse_ts("Startzeit", &normalized)?;
                if parsed > Utc::now() {
                    return Err(AppError::Validation(
                        "Die Startzeit darf nicht in der Zukunft liegen".into(),
                    ));
                }
                if (Utc::now() - parsed).num_seconds() > 24 * 3600 {
                    return Err(AppError::Validation(
                        "Der Timer liefe damit über 24 Stunden".into(),
                    ));
                }
                normalized
            }
            None => current.start_time,
        };

        conn.execute(
            "UPDATE time_entries SET task_id = ?2, start_time = ?3 WHERE id = ?1",
            params![current.id, task_id, start],
        )?;
    }
    notify_timer_change(&app);
    let conn = state.db.lock()?;
    running(&conn)?.ok_or_else(|| AppError::Internal("Timer konnte nicht gelesen werden".into()))
}

#[tauri::command]
pub fn create_time_entry(
    state: State<'_, AppState>,
    input: ManualTimeEntryInput,
) -> AppResult<TimeEntry> {
    let note = require_text("Die Notiz", &input.note)?;
    let start = normalize_ts("Startzeit", &input.start_time)?;
    let end = normalize_ts("Endzeit", &input.end_time)?;
    let minutes = duration_minutes(&start, &end)?;

    let conn = state.db.lock()?;
    task_belongs_to(&conn, input.task_id, input.customer_id)?;
    conn.execute(
        "INSERT INTO time_entries
            (customer_id, task_id, start_time, end_time, duration_minutes, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.customer_id,
            input.task_id,
            start,
            end,
            minutes,
            note,
            now_utc()
        ],
    )?;
    fetch(&conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn update_time_entry(
    state: State<'_, AppState>,
    input: TimeEntryPatch,
) -> AppResult<TimeEntry> {
    let note = require_text("Die Notiz", &input.note)?;
    let start = normalize_ts("Startzeit", &input.start_time)?;
    let end = normalize_ts("Endzeit", &input.end_time)?;
    let minutes = duration_minutes(&start, &end)?;

    let conn = state.db.lock()?;
    let existing = fetch(&conn, input.id)?;
    if existing.end_time.is_none() {
        return Err(AppError::Conflict(
            "Ein laufender Timer wird über die Timer-Ansicht geändert".into(),
        ));
    }
    if existing.invoiced {
        return Err(AppError::Conflict(
            "Dieser Eintrag ist bereits abgerechnet und lässt sich nicht mehr ändern".into(),
        ));
    }
    task_belongs_to(&conn, input.task_id, input.customer_id)?;

    conn.execute(
        "UPDATE time_entries
            SET customer_id = ?2, task_id = ?3, start_time = ?4, end_time = ?5,
                duration_minutes = ?6, note = ?7
          WHERE id = ?1",
        params![
            input.id,
            input.customer_id,
            input.task_id,
            start,
            end,
            minutes,
            note
        ],
    )?;
    fetch(&conn, input.id)
}

#[tauri::command]
pub fn set_time_entry_invoiced(
    state: State<'_, AppState>,
    id: i64,
    invoiced: bool,
) -> AppResult<TimeEntry> {
    let conn = state.db.lock()?;
    let changed = conn.execute(
        "UPDATE time_entries SET invoiced = ?2 WHERE id = ?1 AND end_time IS NOT NULL",
        params![id, invoiced as i64],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(
            "Dieser Zeiteintrag existiert nicht (mehr)".into(),
        ));
    }
    fetch(&conn, id)
}

#[tauri::command]
pub fn delete_time_entry(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock()?;
    let existing = fetch(&conn, id)?;
    if existing.invoiced {
        return Err(AppError::Conflict(
            "Abgerechnete Einträge lassen sich nicht löschen".into(),
        ));
    }
    conn.execute("DELETE FROM time_entries WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn list_time_entries(
    state: State<'_, AppState>,
    filter: TimeEntryFilter,
) -> AppResult<Vec<TimeEntry>> {
    let conn = state.db.lock()?;
    let (sql, args) = build_query(&filter);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), map)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Baut die Filter-Abfrage mit positionsgebundenen Parametern —
/// keine Nutzereingabe landet je im SQL-Text.
pub fn build_query(filter: &TimeEntryFilter) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    let mut where_parts = vec!["e.end_time IS NOT NULL".to_string()];
    let mut args: Vec<Value> = Vec::new();

    if let Some(cid) = filter.customer_id {
        args.push(Value::Integer(cid));
        where_parts.push(format!("e.customer_id = ?{}", args.len()));
    }
    if let Some(tid) = filter.task_id {
        args.push(Value::Integer(tid));
        where_parts.push(format!("e.task_id = ?{}", args.len()));
    }
    if let Some(from) = &filter.from {
        args.push(Value::Text(from.clone()));
        where_parts.push(format!("date(e.start_time,'localtime') >= ?{}", args.len()));
    }
    if let Some(to) = &filter.to {
        args.push(Value::Text(to.clone()));
        where_parts.push(format!("date(e.start_time,'localtime') <= ?{}", args.len()));
    }
    if filter.only_unbilled.unwrap_or(false) {
        where_parts.push("e.invoiced = 0".to_string());
    }

    let limit = filter.limit.unwrap_or(500).clamp(1, 5000);
    let sql = format!(
        "{SELECT} WHERE {} ORDER BY e.start_time DESC LIMIT {limit}",
        where_parts.join(" AND ")
    );
    (sql, args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TimeEntryFilter;

    #[test]
    fn dauer_wird_auf_minuten_gerundet() {
        let d = |s: &str, e: &str| duration_minutes(s, e).unwrap();
        assert_eq!(d("2026-09-09T10:00:00Z", "2026-09-09T11:00:00Z"), 60);
        assert_eq!(d("2026-09-09T10:00:00Z", "2026-09-09T10:00:20Z"), 1);
        assert_eq!(d("2026-09-09T10:00:00Z", "2026-09-09T10:02:40Z"), 3);
        // Über Zeitzonengrenzen hinweg zählt der reale Abstand.
        assert_eq!(d("2026-09-09T10:00:00+02:00", "2026-09-09T09:30:00Z"), 90);
    }

    #[test]
    fn unplausible_zeitraeume_werden_abgelehnt() {
        assert!(duration_minutes("2026-09-09T11:00:00Z", "2026-09-09T10:00:00Z").is_err());
        assert!(duration_minutes("2026-09-09T10:00:00Z", "2026-09-09T10:00:00Z").is_err());
        assert!(duration_minutes("2026-09-09T10:00:00Z", "2026-09-11T10:00:00Z").is_err());
        assert!(duration_minutes("gestern", "2026-09-09T10:00:00Z").is_err());
    }

    /// Filterwerte gehören in Bindungen, nie in den SQL-Text.
    #[test]
    fn filter_bindet_parameter_positionsgenau() {
        let filter = TimeEntryFilter {
            customer_id: Some(3),
            from: Some("2026-01-01".into()),
            to: Some("2026-01-31".into()),
            only_unbilled: Some(true),
            ..Default::default()
        };
        let (sql, args) = build_query(&filter);
        assert_eq!(args.len(), 3);
        assert!(sql.contains("e.customer_id = ?1"));
        assert!(sql.contains("date(e.start_time,'localtime') >= ?2"));
        assert!(sql.contains("date(e.start_time,'localtime') <= ?3"));
        assert!(sql.contains("e.invoiced = 0"));
        assert!(sql.contains("LIMIT 500"));
    }

    #[test]
    fn limit_wird_begrenzt() {
        let (sql, _) = build_query(&TimeEntryFilter {
            limit: Some(999_999),
            ..Default::default()
        });
        assert!(sql.contains("LIMIT 5000"));
    }
}
