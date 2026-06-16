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
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
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
// Settings (path memory + close_to_tray + tray_projects)
// ======================================================================

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    last_spawn_paths: HashMap<String, String>,
    #[serde(default = "default_close_to_tray")]
    close_to_tray: bool,
    #[serde(default)]
    tray_projects: Vec<String>,
}

fn default_close_to_tray() -> bool {
    true
}

impl Settings {
    pub fn load() -> Self {
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

    pub fn save(&self) -> Result<(), String> {
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

    pub fn set_last_path(&mut self, cli_id: &str, path: &str) {
        self.last_spawn_paths.insert(cli_id.to_string(), path.to_string());
    }

    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray
    }

    pub fn set_close_to_tray(&mut self, value: bool) {
        self.close_to_tray = value;
    }

    pub fn get_tray_projects(&self) -> &Vec<String> {
        &self.tray_projects
    }

    pub fn set_tray_projects(&mut self, uuids: Vec<String>) {
        self.tray_projects = uuids;
    }

    pub fn toggle_tray_project(&mut self, uuid: &str, enabled: bool) {
        if enabled {
            if !self.tray_projects.contains(&uuid.to_string()) {
                self.tray_projects.push(uuid.to_string());
            }
        } else {
            self.tray_projects.retain(|u| u != uuid);
        }
    }
}

fn settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(SETTINGS_FILE))
}

/// Returns the current close_to_tray setting.
pub fn settings_close_to_tray() -> bool {
    Settings::load().close_to_tray()
}

// ======================================================================
// Tray setup
// ======================================================================

/// Sets up the system tray. Called once from `lib.rs::setup()`.
pub fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Leggi progetti da template.json
    let projects = load_projects_from_template().unwrap_or_default();

    // Leggi tray_projects da settings
    let settings = Settings::load();
    let tray_projects = settings.get_tray_projects().clone();

    // Costruisci menu
    let menu = build_tray_menu(app, &projects, &tray_projects)?;

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
            let id_str: &str = &id;
            match id_str {
                "open_ucm" => {
                    show_main_window(app);
                }
                s if s.starts_with("spawn_") => {
                    let cli_id = s.strip_prefix("spawn_").unwrap().to_string();
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = ask_path_and_spawn(&app_clone, &cli_id).await {
                            eprintln!("[tray] spawn error: {}", e);
                        }
                    });
                }
                s if s.starts_with("project_") => {
                    let id_clone = s.to_string();
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = handle_project_spawn(&app_clone, &id_clone).await {
                            eprintln!("[tray] project spawn error: {}", e);
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

/// Costruisce il menu tray completo con sottomenu Projects dinamico.
fn build_tray_menu(
    app: &mut tauri::App,
    projects: &[serde_json::Value],
    tray_projects: &[String],
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    // "Apri UCM"
    let open_ucm = MenuItem::with_id(app, "open_ucm", "Apri UCM", true, None::<&str>)?;

    // Separator 1
    let sep1 = PredefinedMenuItem::separator(app)?;

    // Sottomenu Projects
    let projects_submenu = build_projects_submenu(app, projects, tray_projects)?;

    // Separator 2
    let sep2 = PredefinedMenuItem::separator(app)?;

    // "Esci"
    let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;

    // Submenu implements IsMenuItem, può essere usato direttamente in Menu::with_items
    let menu = Menu::with_items(
        app,
        &[
            &open_ucm,
            &sep1,
            &projects_submenu,
            &sep2,
            &quit,
        ],
    )?;

    Ok(menu)
}

/// Costruisce il sottomenu "Projects" con i progetti filtrati.
fn build_projects_submenu(
    app: &mut tauri::App,
    projects: &[serde_json::Value],
    tray_projects: &[String],
) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    let submenu = Submenu::with_id_and_items(
        app,
        "projects",
        "Projects",
        true,
        &[],
    )?;

    // Filtra: se tray_projects è vuoto, mostra tutti; altrimenti solo quelli con UUID in lista
    let visible: Vec<&serde_json::Value> = if tray_projects.is_empty() {
        projects.iter().collect()
    } else {
        projects
            .iter()
            .filter(|p| {
                p.get("id")
                    .and_then(|v| v.as_str())
                    .map(|id| tray_projects.contains(&id.to_string()))
                    .unwrap_or(false)
            })
            .collect()
    };

    if visible.is_empty() {
        let no_proj =
            MenuItem::with_id(app, "no_projects", "Nessun progetto", false, None::<&str>)?;
        submenu.append(&no_proj)?;
    } else {
        for project in visible {
            let name = project
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let id = project
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // Sottomenu per questo progetto
            let proj_submenu = Submenu::with_id_and_items(
                app,
                &format!("proj_{}", id),
                name,
                true,
                &[],
            )?;

            for cli_id in CLI_LIST {
                let label = format!("Spawn {}", capitalize(cli_id));
                let item_id = format!("project_{}_spawn_{}", id, cli_id);
                let item = MenuItem::with_id(app, &item_id, &label, true, None::<&str>)?;
                proj_submenu.append(&item)?;
            }

            submenu.append(&proj_submenu)?;
        }
    }

    Ok(submenu)
}

/// Refresh del menu tray con i progetti aggiornati.
/// Viene chiamato quando l'utente modifica i checkbox in Settings.
pub fn refresh_tray_menu(
    _app: &tauri::AppHandle,
    _projects: &[serde_json::Value],
    _tray_projects: &[String],
) -> Result<(), String> {
    // In Tauri 2, ricostruire il menu a runtime richiede di ricreare la tray icon
    // Per semplicità: questa funzione indica che serve riavvio
    // Il refresh completo richiederebbe di salvare lo state della tray icon
    // e ricrearla — feature che possiamo aggiungere in futuro
    eprintln!("[tray] refresh_tray_menu called — menu will be updated on next app restart");
    Ok(())
}

// ======================================================================
// Helpers
// ======================================================================

/// Legge i progetti da template.json.
pub fn load_projects_from_template() -> Result<Vec<serde_json::Value>, String> {
    let template_path = dirs::home_dir()
        .ok_or("Impossibile determinare la home")?
        .join(".ucm")
        .join("template.json");

    let content = fs::read_to_string(&template_path)
        .map_err(|e| format!("Errore lettura template.json: {}", e))?;

    let template: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Errore parsing template.json: {}", e))?;

    let projects = template
        .get("projects")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(projects)
}

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

/// Gestisce il click su un sottocomando "project_<uuid>_spawn_<cli_id>".
async fn handle_project_spawn(_app: &AppHandle, id: &str) -> Result<(), String> {
    // Estrai uuid e cli_id dal formato "project_<uuid>_spawn_<cli_id>"
    // Gli UUID contengono solo lettere, numeri e dash, quindi possiamo splittare su "_spawn_"
    let Some(spawn_pos) = id.find("_spawn_") else {
        return Err(format!("Formato id non valido: {}", id));
    };

    let uuid_part = &id["project_".len()..spawn_pos];
    let cli_id = &id[spawn_pos + "_spawn_".len()..];

    // Leggi template.json per trovare il path del progetto
    let projects = load_projects_from_template()?;
    let project = projects
        .iter()
        .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(uuid_part))
        .ok_or_else(|| format!("Progetto {} non trovato", uuid_part))?;

    let path = project
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("Path progetto mancante")?;

    // Spawn PowerShell con cd <path> ; <cli_id>
    spawn_cli(cli_id, path)
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
