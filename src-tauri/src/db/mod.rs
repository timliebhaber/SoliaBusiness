pub mod migrations;

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

/// Besitzt die einzige SQLite-Verbindung der App.
/// Bewusst synchron gehalten: alle Sperren werden innerhalb einer Funktion
/// wieder freigegeben, nie über einen `await`-Punkt hinweg.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;

        // WAL überlebt einen harten Absturz sauber; synchronous=NORMAL ist
        // in Kombination mit WAL der übliche Kompromiss aus Sicherheit/Tempo.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        let db = Db {
            conn: Mutex::new(conn),
        };
        {
            let mut guard = db.lock()?;
            migrations::run(&mut guard)?;
        }
        Ok(db)
    }

    pub fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(AppError::from)
    }
}
