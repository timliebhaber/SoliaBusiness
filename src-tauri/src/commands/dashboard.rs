use crate::error::AppResult;
use crate::models::{CustomerBucket, Dashboard, DayBucket, OverdueTask};
use crate::state::AppState;
use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use tauri::State;

fn minutes_since(conn: &Connection, from: NaiveDate) -> AppResult<i64> {
    let value: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_minutes),0) FROM time_entries
          WHERE end_time IS NOT NULL AND date(start_time,'localtime') >= ?1",
        params![from.to_string()],
        |r| r.get(0),
    )?;
    Ok(value)
}

#[tauri::command]
pub fn get_dashboard(state: State<'_, AppState>) -> AppResult<Dashboard> {
    let conn = state.db.lock()?;
    let today = Local::now().date_naive();
    let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    let month_start = today.with_day(1).unwrap_or(today);

    let today_minutes = minutes_since(&conn, today)?;
    let week_minutes = minutes_since(&conn, week_start)?;
    let month_minutes = minutes_since(&conn, month_start)?;

    // Unabgerechnete Zeit, getrennt nach „Satz hinterlegt“ und „ohne Satz“:
    // eine Summe, die stillschweigend Kunden ohne Stundensatz unterschlägt,
    // wäre schlicht falsch.
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.hourly_rate_cents,
                COALESCE(SUM(e.duration_minutes),0) AS minutes
           FROM time_entries e
           JOIN customers c ON c.id = e.customer_id
          WHERE e.end_time IS NOT NULL AND e.invoiced = 0
          GROUP BY c.id
         HAVING minutes > 0
          ORDER BY minutes DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<i64>>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;

    let mut unbilled_minutes = 0i64;
    let mut unbilled_cents = 0i64;
    let mut unbilled_minutes_without_rate = 0i64;
    let mut by_customer_unbilled = Vec::new();
    for row in rows {
        let (id, name, rate, minutes) = row?;
        unbilled_minutes += minutes;
        let cents = match rate {
            Some(rate) => {
                let c = (minutes as f64 / 60.0 * rate as f64).round() as i64;
                unbilled_cents += c;
                c
            }
            None => {
                unbilled_minutes_without_rate += minutes;
                0
            }
        };
        by_customer_unbilled.push(CustomerBucket {
            customer_id: id,
            customer_name: name,
            minutes,
            cents,
        });
    }
    drop(stmt);

    let open_tasks: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks t JOIN customers c ON c.id = t.customer_id
          WHERE t.status <> 'done' AND c.archived = 0",
        [],
        |r| r.get(0),
    )?;
    let active_customers: i64 =
        conn.query_row("SELECT COUNT(*) FROM customers WHERE archived = 0", [], |r| {
            r.get(0)
        })?;

    let mut stmt = conn.prepare(
        "SELECT t.id, t.customer_id, c.name, t.title, t.deadline
           FROM tasks t JOIN customers c ON c.id = t.customer_id
          WHERE t.status <> 'done' AND c.archived = 0
            AND t.deadline IS NOT NULL AND t.deadline < ?1
          ORDER BY t.deadline ASC LIMIT 50",
    )?;
    let overdue_rows = stmt.query_map(params![today.to_string()], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    let mut overdue = Vec::new();
    for row in overdue_rows {
        let (id, customer_id, customer_name, title, deadline) = row?;
        let days = NaiveDate::parse_from_str(&deadline, "%Y-%m-%d")
            .map(|d| (today - d).num_days())
            .unwrap_or(0);
        overdue.push(OverdueTask {
            id,
            customer_id,
            customer_name,
            title,
            deadline,
            days_overdue: days,
        });
    }
    drop(stmt);

    // Letzte 14 Tage lückenlos, damit das Diagramm keine Tage überspringt.
    let from = today - Duration::days(13);
    let mut stmt = conn.prepare(
        "SELECT date(start_time,'localtime') AS d, COALESCE(SUM(duration_minutes),0)
           FROM time_entries
          WHERE end_time IS NOT NULL AND date(start_time,'localtime') >= ?1
          GROUP BY d",
    )?;
    let mut found: HashMap<String, i64> = HashMap::new();
    let bucket_rows = stmt.query_map(params![from.to_string()], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    for row in bucket_rows {
        let (d, m) = row?;
        found.insert(d, m);
    }
    drop(stmt);

    let last_14_days = (0..14)
        .map(|offset| {
            let date = (from + Duration::days(offset)).to_string();
            let minutes = found.get(&date).copied().unwrap_or(0);
            DayBucket { date, minutes }
        })
        .collect();

    Ok(Dashboard {
        today_minutes,
        week_minutes,
        month_minutes,
        unbilled_minutes,
        unbilled_cents,
        unbilled_minutes_without_rate,
        open_tasks,
        overdue,
        last_14_days,
        by_customer_unbilled,
        active_customers,
    })
}
