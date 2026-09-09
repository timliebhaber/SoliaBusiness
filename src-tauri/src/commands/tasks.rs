use super::*;
use crate::error::{AppError, AppResult};
use crate::models::{Task, TaskInput, TaskStatus};
use crate::state::AppState;
use rusqlite::{params, Connection, OptionalExtension, Row};
use tauri::State;

const SELECT: &str = "SELECT t.id, t.customer_id, t.title, t.description, t.estimated_minutes,
        t.deadline, t.status, t.invoiced, t.created_at, t.completed_at,
        (SELECT COALESCE(SUM(e.duration_minutes),0) FROM time_entries e
          WHERE e.task_id = t.id AND e.end_time IS NOT NULL) AS tracked,
        (SELECT COALESCE(SUM(e.duration_minutes),0) FROM time_entries e
          WHERE e.task_id = t.id AND e.end_time IS NOT NULL AND e.invoiced = 0) AS unbilled
   FROM tasks t";

fn map(row: &Row) -> rusqlite::Result<Task> {
    let raw: String = row.get(6)?;
    Ok(Task {
        id: row.get(0)?,
        customer_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        estimated_minutes: row.get(4)?,
        deadline: row.get(5)?,
        status: TaskStatus::parse(&raw).unwrap_or(TaskStatus::Open),
        invoiced: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        completed_at: row.get(9)?,
        tracked_minutes: row.get(10)?,
        unbilled_minutes: row.get(11)?,
    })
}

fn fetch(conn: &Connection, id: i64) -> AppResult<Task> {
    conn.query_row(&format!("{SELECT} WHERE t.id = ?1"), params![id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound("Diese Aufgabe existiert nicht (mehr)".into()))
}

fn customer_exists(conn: &Connection, customer_id: i64) -> AppResult<()> {
    let found: i64 = conn.query_row(
        "SELECT COUNT(*) FROM customers WHERE id = ?1",
        params![customer_id],
        |r| r.get(0),
    )?;
    if found == 0 {
        return Err(AppError::NotFound(
            "Der zugeordnete Kunde existiert nicht".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>, customer_id: i64) -> AppResult<Vec<Task>> {
    let conn = state.db.lock()?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE t.customer_id = ?1
         ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
                  t.deadline IS NULL, t.deadline ASC, t.created_at DESC"
    ))?;
    let rows = stmt.query_map(params![customer_id], map)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_task(state: State<'_, AppState>, input: TaskInput) -> AppResult<Task> {
    let title = require_text("Der Titel", &input.title)?;
    let description = opt_trim(input.description);
    let deadline = opt_trim(input.deadline);
    validate_date(&deadline)?;
    validate_minutes("Die Schätzung", input.estimated_minutes)?;

    let conn = state.db.lock()?;
    customer_exists(&conn, input.customer_id)?;

    let completed_at = (input.status == TaskStatus::Done).then(now_utc);
    conn.execute(
        "INSERT INTO tasks (customer_id, title, description, estimated_minutes, deadline,
                            status, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.customer_id,
            title,
            description,
            input.estimated_minutes,
            deadline,
            input.status.as_str(),
            now_utc(),
            completed_at
        ],
    )?;
    fetch(&conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn update_task(state: State<'_, AppState>, id: i64, input: TaskInput) -> AppResult<Task> {
    let title = require_text("Der Titel", &input.title)?;
    let description = opt_trim(input.description);
    let deadline = opt_trim(input.deadline);
    validate_date(&deadline)?;
    validate_minutes("Die Schätzung", input.estimated_minutes)?;

    let conn = state.db.lock()?;
    customer_exists(&conn, input.customer_id)?;
    let previous = fetch(&conn, id)?;

    // completed_at nur beim tatsächlichen Statuswechsel setzen bzw. löschen.
    let completed_at = match (previous.status, input.status) {
        (TaskStatus::Done, TaskStatus::Done) => previous.completed_at,
        (_, TaskStatus::Done) => Some(now_utc()),
        _ => None,
    };

    conn.execute(
        "UPDATE tasks SET customer_id = ?2, title = ?3, description = ?4, estimated_minutes = ?5,
                          deadline = ?6, status = ?7, completed_at = ?8
          WHERE id = ?1",
        params![
            id,
            input.customer_id,
            title,
            description,
            input.estimated_minutes,
            deadline,
            input.status.as_str(),
            completed_at
        ],
    )?;
    fetch(&conn, id)
}

#[tauri::command]
pub fn set_task_status(
    state: State<'_, AppState>,
    id: i64,
    status: TaskStatus,
) -> AppResult<Task> {
    let conn = state.db.lock()?;
    let previous = fetch(&conn, id)?;
    let completed_at = match (previous.status, status) {
        (TaskStatus::Done, TaskStatus::Done) => previous.completed_at,
        (_, TaskStatus::Done) => Some(now_utc()),
        _ => None,
    };
    conn.execute(
        "UPDATE tasks SET status = ?2, completed_at = ?3 WHERE id = ?1",
        params![id, status.as_str(), completed_at],
    )?;
    fetch(&conn, id)
}

/// Bewusst unabhängig vom Status — eine offene Aufgabe kann bereits
/// abgerechnet sein und umgekehrt.
#[tauri::command]
pub fn set_task_invoiced(
    state: State<'_, AppState>,
    id: i64,
    invoiced: bool,
) -> AppResult<Task> {
    let conn = state.db.lock()?;
    let changed = conn.execute(
        "UPDATE tasks SET invoiced = ?2 WHERE id = ?1",
        params![id, invoiced as i64],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(
            "Diese Aufgabe existiert nicht (mehr)".into(),
        ));
    }
    fetch(&conn, id)
}

#[tauri::command]
pub fn delete_task(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let conn = state.db.lock()?;
    let running: i64 = conn.query_row(
        "SELECT COUNT(*) FROM time_entries WHERE task_id = ?1 AND end_time IS NULL",
        params![id],
        |r| r.get(0),
    )?;
    if running > 0 {
        return Err(AppError::Conflict(
            "Auf diese Aufgabe läuft gerade ein Timer. Bitte erst stoppen.".into(),
        ));
    }
    // Erfasste Zeiten bleiben erhalten und rutschen auf „ohne Aufgabe“
    // (ON DELETE SET NULL) — Zeit darf durch eine Aufräumaktion nie verschwinden.
    let changed = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(
            "Diese Aufgabe existiert nicht (mehr)".into(),
        ));
    }
    Ok(())
}
