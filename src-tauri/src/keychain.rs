use crate::error::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "de.solia.kontor";
const ACCOUNT: &str = "sevdesk-api-token";

fn entry() -> AppResult<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(AppError::from)
}

/// Der API-Key liegt ausschließlich im macOS-Schlüsselbund — nie in der
/// SQLite-Datei, nie in einer Konfigurationsdatei, nie im Frontend-State.
pub fn store_token(token: &str) -> AppResult<()> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::Validation("Der API-Key ist leer".into()));
    }
    entry()?.set_password(token).map_err(AppError::from)
}

pub fn read_token() -> AppResult<String> {
    entry()?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => AppError::Keychain(
            "Es ist kein SevDesk-API-Key hinterlegt. Bitte in den Einstellungen eintragen.".into(),
        ),
        other => AppError::from(other),
    })
}

pub fn delete_token() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}

/// Nur die letzten vier Zeichen verlassen den Rust-Prozess.
pub fn token_hint() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(token) => {
            let tail: String = token.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            Ok(Some(format!("••••••••{tail}")))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}
