use crate::error::AppResult;
use rusqlite::Connection;

/// Jede Migration wird genau einmal ausgeführt; der Fortschritt steht in
/// `PRAGMA user_version`. Neue Migrationen werden hinten angehängt, nie
/// bestehende verändert.
const MIGRATIONS: &[&str] = &[
    // 1 — Grundschema
    r#"
    CREATE TABLE customers (
        id                 INTEGER PRIMARY KEY,
        name               TEXT    NOT NULL,
        company            TEXT,
        email              TEXT,
        hourly_rate_cents  INTEGER,
        sevdesk_contact_id TEXT,
        notes              TEXT,
        archived           INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        created_at         TEXT    NOT NULL
    );
    CREATE INDEX idx_customers_archived ON customers(archived, name);

    CREATE TABLE tasks (
        id                INTEGER PRIMARY KEY,
        customer_id       INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        title             TEXT    NOT NULL,
        description       TEXT,
        estimated_minutes INTEGER,
        deadline          TEXT,
        status            TEXT    NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open','in_progress','done')),
        invoiced          INTEGER NOT NULL DEFAULT 0 CHECK (invoiced IN (0,1)),
        created_at        TEXT    NOT NULL,
        completed_at      TEXT
    );
    CREATE INDEX idx_tasks_customer ON tasks(customer_id, status);
    CREATE INDEX idx_tasks_deadline ON tasks(deadline) WHERE deadline IS NOT NULL;

    CREATE TABLE time_entries (
        id               INTEGER PRIMARY KEY,
        customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        start_time       TEXT    NOT NULL,
        end_time         TEXT,
        duration_minutes INTEGER,
        note             TEXT,
        invoiced         INTEGER NOT NULL DEFAULT 0 CHECK (invoiced IN (0,1)),
        created_at       TEXT    NOT NULL,
        CHECK (end_time IS NULL OR end_time > start_time),
        CHECK ((end_time IS NULL) = (duration_minutes IS NULL))
    );
    CREATE INDEX idx_time_customer ON time_entries(customer_id, start_time);
    CREATE INDEX idx_time_task ON time_entries(task_id) WHERE task_id IS NOT NULL;

    -- Höchstens ein laufender Timer gleichzeitig. Der konstante Ausdruck sorgt
    -- dafür, dass alle laufenden Zeilen denselben Indexwert belegen.
    CREATE UNIQUE INDEX idx_single_running_timer
        ON time_entries((end_time IS NULL)) WHERE end_time IS NULL;

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE invoices (
        id                 INTEGER PRIMARY KEY,
        customer_id        INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        sevdesk_invoice_id TEXT,
        invoice_number     TEXT,
        net_total_cents    INTEGER NOT NULL,
        minutes            INTEGER NOT NULL,
        status             TEXT    NOT NULL,
        created_at         TEXT    NOT NULL
    );
    CREATE INDEX idx_invoices_customer ON invoices(customer_id, created_at);

    CREATE TABLE invoice_items (
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        kind       TEXT    NOT NULL CHECK (kind IN ('task','time_entry')),
        ref_id     INTEGER NOT NULL,
        PRIMARY KEY (invoice_id, kind, ref_id)
    );
    "#,
];

pub fn run(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let target = MIGRATIONS.len() as i64;

    if current > target {
        return Err(crate::error::AppError::Db(format!(
            "Die Datenbank stammt aus einer neueren Version von Kontor \
             (Schema {current}, unterstützt wird {target}). Bitte die App aktualisieren."
        )));
    }

    for (idx, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        // user_version akzeptiert keine Parameter-Bindung.
        tx.pragma_update(None, "user_version", (idx + 1) as i64)?;
        tx.commit()?;
        log::info!("Migration {} angewendet", idx + 1);
    }
    Ok(())
}
