mod commands;
mod db;
mod error;
mod keychain;
mod models;
mod sevdesk;
mod state;
mod tray;

use error::AppResult;
use serde::Serialize;
use state::AppState;
use tauri::{Manager, WindowEvent};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    database_path: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppResult<AppInfo> {
    let path = app
        .path()
        .app_data_dir()
        .map(|d| d.join("soliabusiness.sqlite3").to_string_lossy().to_string())
        .unwrap_or_else(|_| "unbekannt".into());
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        database_path: path,
    })
}

#[cfg(target_os = "macos")]
fn apply_window_chrome(window: &tauri::WebviewWindow) {
    use tauri::window::Color;
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    // Fensterhintergrund im System-Material; die Inhaltsfläche legt sich in CSS
    // deckend darüber, sodass nur die Seitenleiste durchscheint.
    if let Err(e) = apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::Active),
        None,
    ) {
        // Ohne Material bliebe das transparente Fenster ohne Untergrund —
        // die Seitenleiste wäre praktisch unsichtbar. Deshalb hier eine
        // deckende Fläche passend zum aktuellen Systemauftritt nachziehen.
        log::warn!("Vibrancy nicht verfügbar, weiche auf eine deckende Fläche aus: {e}");
        let fallback = match window.theme() {
            Ok(tauri::Theme::Dark) => Color(28, 28, 32, 255),
            _ => Color(242, 241, 239, 255),
        };
        if let Err(e) = window.set_background_color(Some(fallback)) {
            log::error!("Fensterhintergrund konnte nicht gesetzt werden: {e}");
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_window_chrome(_window: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let data_dir = handle.path().app_data_dir().map_err(|e| {
                format!("Der Datenordner der App ist nicht erreichbar: {e}")
            })?;
            let db = db::Db::open(&data_dir.join("soliabusiness.sqlite3")).map_err(|e| {
                // Ohne Datenbank ist die App nicht sinnvoll benutzbar — hier
                // wird bewusst laut abgebrochen statt still weiterzulaufen.
                format!("Die Datenbank konnte nicht geöffnet werden: {e}")
            })?;
            app.manage(AppState { db });

            if let Some(window) = app.get_webview_window("main") {
                apply_window_chrome(&window);
            }

            tray::create(&handle)?;

            // Hält die Laufzeit in der Menüleiste aktuell, ohne dass ein
            // Fenster geöffnet sein muss.
            let ticker = handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(30));
                loop {
                    interval.tick().await;
                    tray::refresh(&ticker);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Schließen beendet die App nicht — der Timer läuft in der
            // Menüleiste weiter.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::customers::list_customers,
            commands::customers::create_customer,
            commands::customers::update_customer,
            commands::customers::set_customer_archived,
            commands::customers::delete_customer,
            commands::tasks::list_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::set_task_status,
            commands::tasks::set_task_invoiced,
            commands::tasks::delete_task,
            commands::time::get_running_timer,
            commands::time::start_timer,
            commands::time::stop_timer,
            commands::time::discard_timer,
            commands::time::update_running_timer,
            commands::time::create_time_entry,
            commands::time::update_time_entry,
            commands::time::set_time_entry_invoiced,
            commands::time::delete_time_entry,
            commands::time::list_time_entries,
            commands::dashboard::get_dashboard,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_sevdesk_token,
            commands::settings::clear_sevdesk_token,
            commands::settings::sevdesk_token_hint,
            commands::invoicing::invoice_preview,
            commands::invoicing::list_invoices,
            commands::invoicing::sevdesk_status,
            commands::invoicing::sevdesk_list_contacts,
            commands::invoicing::sevdesk_link_customer,
            commands::invoicing::sevdesk_unlink_customer,
            commands::invoicing::sevdesk_create_contact,
            commands::invoicing::create_sevdesk_invoice,
            commands::export::export_time_entries_csv,
        ])
        .build(tauri::generate_context!())
        .expect("SoliaBusiness konnte nicht gestartet werden")
        .run(|app, event| {
            // Klick auf das Dock-Symbol holt das versteckte Fenster zurück.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            let _ = (app, event);
        });
}
