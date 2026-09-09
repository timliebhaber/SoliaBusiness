use crate::state::AppState;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const TRAY_ID: &str = "soliabusiness-tray";

fn hhmm(seconds: i64) -> String {
    let minutes = seconds / 60;
    format!("{}:{:02}", minutes / 60, minutes % 60)
}

struct TrayModel {
    title: Option<String>,
    status: String,
    running: bool,
    customers: Vec<(i64, String)>,
}

fn read_model<R: Runtime>(app: &AppHandle<R>) -> TrayModel {
    let state = app.state::<AppState>();
    let Ok(conn) = state.db.lock() else {
        return TrayModel {
            title: None,
            status: "Datenbank nicht erreichbar".into(),
            running: false,
            customers: Vec::new(),
        };
    };

    let running = crate::commands::time::running(&conn).ok().flatten();

    let customers = conn
        .prepare(
            "SELECT c.id, c.name FROM customers c
              WHERE c.archived = 0
              ORDER BY (SELECT MAX(e.start_time) FROM time_entries e
                         WHERE e.customer_id = c.id) DESC NULLS LAST,
                       c.name COLLATE NOCASE
              LIMIT 8",
        )
        .and_then(|mut stmt| {
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_default();

    match running {
        Some(timer) => {
            let task = timer
                .task_title
                .as_deref()
                .map(|t| format!(" · {t}"))
                .unwrap_or_default();
            TrayModel {
                title: Some(hhmm(timer.elapsed_seconds)),
                status: format!("Läuft: {}{}", timer.customer_name, task),
                running: true,
                customers,
            }
        }
        None => TrayModel {
            title: None,
            status: "Kein Timer aktiv".into(),
            running: false,
            customers,
        },
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, model: &TrayModel) -> tauri::Result<Menu<R>> {
    let status = MenuItemBuilder::with_id("status", &model.status)
        .enabled(false)
        .build(app)?;

    let mut builder = MenuBuilder::new(app).item(&status).separator();

    if model.running {
        builder = builder.item(
            &MenuItemBuilder::with_id("timer:stop", "Timer stoppen …").build(app)?,
        );
    } else if model.customers.is_empty() {
        builder = builder.item(
            &MenuItemBuilder::with_id("noop", "Noch keine Kunden angelegt")
                .enabled(false)
                .build(app)?,
        );
    } else {
        let mut sub = SubmenuBuilder::new(app, "Timer starten");
        for (id, name) in &model.customers {
            sub = sub.item(&MenuItemBuilder::with_id(format!("start:{id}"), name).build(app)?);
        }
        builder = builder.item(&sub.build()?);
    }

    builder
        .separator()
        .item(&MenuItemBuilder::with_id("open", "SoliaBusiness öffnen").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "SoliaBusiness beenden").build(app)?)
        .build()
}

fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "open" => show_window(app),
        "quit" => app.exit(0),
        "timer:stop" => {
            // Die Notiz ist Pflicht, also übernimmt das Fenster den Stopp.
            show_window(app);
            let _ = app.emit("request-stop-timer", ());
        }
        other => {
            let Some(raw) = other.strip_prefix("start:") else {
                return;
            };
            let Ok(customer_id) = raw.parse::<i64>() else {
                return;
            };
            let state = app.state::<AppState>();
            let result = (|| -> crate::error::AppResult<()> {
                let conn = state.db.lock()?;
                if crate::commands::time::running(&conn)?.is_some() {
                    return Err(crate::error::AppError::Conflict(
                        "Es läuft bereits ein Timer".into(),
                    ));
                }
                let now = crate::commands::now_utc();
                conn.execute(
                    "INSERT INTO time_entries (customer_id, start_time, created_at)
                     VALUES (?1, ?2, ?2)",
                    rusqlite::params![customer_id, now],
                )?;
                Ok(())
            })();

            match result {
                Ok(()) => {
                    let _ = app.emit("timer-changed", ());
                }
                Err(e) => {
                    log::error!("Timer-Start aus der Menüleiste fehlgeschlagen: {e}");
                    let _ = app.emit("tray-error", e.to_string());
                }
            }
            refresh(app);
        }
    }
}

pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let model = read_model(app);
    let menu = build_menu(app, &model)?;

    // Eigene Silhouette statt des App-Icons: im Template-Modus zählt nur der
    // Alphakanal, ein farbiges Icon würde in der Menüleiste als Klotz erscheinen.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .icon(icon)
        // Template-Modus lässt macOS das Symbol an Hell/Dunkel anpassen.
        .icon_as_template(true)
        .on_menu_event(|app, event| handle_event(app, event.id.as_ref()))
        .build(app)?;
    tray.set_title(model.title.as_deref())?;
    Ok(tray)
}

/// Nach jeder Timer-Änderung und im Minutentakt aufgerufen.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let model = read_model(app);
    match build_menu(app, &model) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                log::error!("Menüleiste konnte nicht aktualisiert werden: {e}");
            }
        }
        Err(e) => log::error!("Menü konnte nicht gebaut werden: {e}"),
    }
    if let Err(e) = tray.set_title(model.title.as_deref()) {
        log::error!("Titel der Menüleiste konnte nicht gesetzt werden: {e}");
    }
}
