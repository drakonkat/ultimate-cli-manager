//! tray — system tray management for Ultimate CLI Manager.
//!
//! Creates a system tray icon with a right-click menu:
//!   - "Apri UCM"              → show/focus main window
//!   - Separator
//!   - "Spawn <CLI>" (x5)      → directory picker → run_cli
//!   - Separator
//!   - "Esci"                  → quit app
//!
//! Left-click on the tray icon shows/focuses the main window.
//! Closing the main window hides it to tray (app keeps running).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_dialog::DialogExt;

// ======================================================================
// Constants
// ======================================================================

pub const CLI_LIST: &[&str] = &["claude", "junie", "cline", "kilo", "opencode"];

const SETTINGS_FILE: &str = ".ucm/settings.json";

// ======================================================================
// Settings (path memory)
// ======================================================================

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Settings {
    last_spawn_paths: HashMap<String, String>,
}

impl Settings {
    fn load() -> Self {
        let Some(path) = settings_path() else {
            return Self::default();
        };
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Self::default()
        }
    }

    fn save(&self) -> Result<(), String> {
        let Some(path) = settings_path() else {
            return Err("Impossibile determinare il path delle settings".into());
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn set_last_path(&mut self, cli_id: &str, path: &str) {
        self.last_spawn_paths.insert(cli_id.to_string(), path.to_string());
    }
}

fn settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(SETTINGS_FILE))
}

// ======================================================================
// Tray setup
// ======================================================================

/// Sets up the system tray. Called once from `lib.rs::setup()`.
pub fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // ---- Build menu items ----

    // "Apri UCM"
    let open_ucm = MenuItem::with_id(app, "open_ucm", "Apri UCM", true, None::<&str>)?;

    // Separator 1
    let sep1 = PredefinedMenuItem::separator(app)?;

    // "Spawn <CLI>" items (5)
    let spawn_items: Vec<MenuItem<tauri::Wry>> = CLI_LIST
        .iter()
        .map(|cli_id| {
            let label = format!("Spawn {}", capitalize(cli_id));
            MenuItem::with_id(app, format!("spawn_{}", cli_id), &label, true, None::<&str>)
        })
        .collect::<Result<Vec<_>, _>>()?;

    // Separator 2
    let sep2 = PredefinedMenuItem::separator(app)?;

    // "Esci"
    let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;

    // ---- Assemble menu ----
    let menu = Menu::with_items(
        app,
        &[
            &open_ucm,
            &sep1,
            &spawn_items[0],
            &spawn_items[1],
            &spawn_items[2],
            &spawn_items[3],
            &spawn_items[4],
            &sep2,
            &quit,
        ],
    )?;

    // ---- Load tray icon ----
    // Use the default window icon (icon.ico from tauri.conf.json)
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("No default window icon set in tauri.conf.json")?;

    // ---- Build tray icon ----
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Ultimate CLI Manager")
        .menu(&menu)
        .show_menu_on_left_click(false) // right-click only for menu; left-click → show window
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "open_ucm" => {
                    show_main_window(app);
                }
                id if id.starts_with("spawn_") => {
                    let cli_id = id.strip_prefix("spawn_").unwrap().to_string();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = ask_path_and_spawn(&app, &cli_id).await {
                            eprintln!("[tray] spawn error: {}", e);
                        }
                    });
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on tray icon → show main window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ======================================================================
// Helpers
// ======================================================================

/// Capitalize first letter.
fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

/// Shows (or restores) the main window and brings it to focus.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Shows a directory picker dialog, then calls `run_cli` if a path is selected.
/// Runs asynchronously (does not block the tray thread).
async fn ask_path_and_spawn(app: &AppHandle, cli_id: &str) -> Result<(), String> {
    // Load settings for path memory
    let mut settings = Settings::load();

    // Use a channel to get the result from the blocking dialog
    let (tx, rx) = std::sync::mpsc::channel();

    let title = format!("Select project folder for {}", capitalize(cli_id));

    // pick_folder takes a callback - we use a channel to get the result
    app.dialog()
        .file()
        .set_title(&title)
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });

    // Wait for the dialog result
    let picked = rx.recv();

    if let Ok(Some(path)) = picked {
        let path_str = path.to_string();

        // Save as last used path
        settings.set_last_path(cli_id, &path_str);
        if let Err(e) = settings.save() {
            eprintln!("[tray] warning: failed to save settings: {}", e);
        }

        // Spawn PowerShell with the CLI directly (same logic as run_cli command)
        if let Err(e) = spawn_cli(cli_id, &path_str) {
            eprintln!("[tray] spawn error: {}", e);
        }
    }
    // If user cancelled, do nothing
    Ok(())
}

/// Spawns a PowerShell window with the given CLI at the specified path.
/// Same logic as the `run_cli` Tauri command.
fn spawn_cli(cli_id: &str, project_path: &str) -> Result<(), String> {
    use std::process::Command;
    use std::path::Path;

    const WHITELIST: &[&str] = &["claude", "junie", "cline", "kilo", "opencode"];
    if !WHITELIST.contains(&cli_id) {
        return Err(format!("CLI sconosciuta: {}", cli_id));
    }

    let path = Path::new(project_path);
    if !path.exists() {
        return Err(format!("Il path non esiste: {}", project_path));
    }
    if !path.is_dir() {
        return Err(format!("Il path non è una directory: {}", project_path));
    }

    let ps_command = format!("cd '{}'; {}", project_path, cli_id);
    Command::new("powershell.exe")
        .args(["-NoExit", "-Command", &ps_command])
        .spawn()
        .map_err(|e| format!("Impossibile avviare PowerShell: {}", e))?;

    Ok(())
}