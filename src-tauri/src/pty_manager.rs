//! pty_manager — gestione delle sessioni PTY per il terminale integrato.
//!
//! Espone un singleton `PtyState` (due HashMap dentro un `Mutex`) che tiene
//! traccia di:
//!   - `sessions`: mappa `SessionId → PtySession` (handle master/writer/child)
//!   - `window_sessions`: mappa `WindowLabel → Vec<SessionId>` per il cleanup
//!     di massa quando l'utente chiude la finestra "terminal".
//!
//! I 4 command `pty_spawn` / `pty_write` / `pty_resize` / `pty_kill` in
//! `lib.rs` delegano a queste funzioni. Gli eventi Tauri `pty:data`,
//! `pty:exit`, `pty:error` vengono emessi dal thread reader che viene
//! spawnato in `spawn_pty` e vive quanto la sessione PTY.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Whitelist delle CLI accettate dal terminale integrato. Coincide con
/// `RUN_CLI_WHITELIST` in `lib.rs` (il spawn esterno "fire-and-forget").
const PTY_CLI_WHITELIST: &[&str] = &["claude", "junie", "cline", "kilo", "opencode"];

pub type SessionId = String;
pub type WindowLabel = String;

/// Handle di una singola sessione PTY. Contiene i pezzi "caldi" che il
/// thread reader e i command `pty_write` / `pty_resize` / `pty_kill`
/// devono poter raggiungere. Tutti i campi sono `Send` perché
/// `portable-pty` li garantisce (o li wrappiamo in `Box<... + Send>`).
///
/// I campi `id` / `window_label` / `cli_id` sono conservati per debug
/// e per future feature (logging, status query, ispezione). Per ora
/// non vengono letti: silenziamo il warning di dead_code.
#[allow(dead_code)]
pub struct PtySession {
    pub id: SessionId,
    pub window_label: WindowLabel,
    pub cli_id: String,
    /// Master end del PTY. Serve per `resize` e `try_clone_reader`.
    /// Wrappato in `Box<dyn MasterPty + Send>` perché `MasterPty` non
    /// è `Sync` ma a noi serve solo spostarlo tra thread.
    pub master: Box<dyn MasterPty + Send>,
    /// Writer end del PTY. Qui ci scrive `pty_write` con l'input utente.
    pub writer: Box<dyn Write + Send>,
    /// Handle al child process. Serve per `kill` e per leggere l'exit code.
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Stato globale del PTY manager, inserito in `app.manage(...)` durante
/// lo `setup` di Tauri. Wrappato in `Arc<Mutex<...>>` per poterlo
/// clonare nei thread reader senza dover passare l'`AppHandle` intero.
#[derive(Default)]
pub struct PtyState {
    pub sessions: HashMap<SessionId, PtySession>,
    pub window_sessions: HashMap<WindowLabel, Vec<SessionId>>,
}

/// Wrapper convenienza per il `tauri::State`.
pub type PtyStateHandle = Arc<Mutex<PtyState>>;

// ======================================================================
// Event payload types — serializzati in JSON e consumati dal frontend.
// Tutti hanno `#[serde(rename_all = "camelCase")]` per coerenza con
// il resto del codebase (es. `get_cli_paths`).
// ======================================================================

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyDataEvent {
    pub session_id: String,
    /// Stringa (NON bytes) per semplicità: il PTY su Windows con
    /// PowerShell produce testo UTF-8 valido, e xterm.js lo renderizza
    /// nativamente. Se in futuro servono bytes binari, cambiare in `Vec<u8>`.
    pub data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub session_id: String,
    pub code: Option<i32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyErrorEvent {
    pub session_id: String,
    pub message: String,
}

// ======================================================================
// spawn_pty — core della feature.
// ======================================================================

/// Apre un PTY, spawna PowerShell con `cd <path> ; <cli_id>`, salva gli
/// handle in `state`, lancia il thread reader che emette `pty:data` ad
/// ogni chunk e `pty:exit` quando il child termina.
pub fn spawn_pty(
    state: &PtyStateHandle,
    app: &AppHandle,
    cli_id: &str,
    project_path: &str,
    cols: u16,
    rows: u16,
    window_label: &str,
    session_id: &str,
) -> Result<(), String> {
    // 1. Whitelist del cli_id.
    if !PTY_CLI_WHITELIST.contains(&cli_id) {
        return Err(format!("CLI sconosciuta: {}", cli_id));
    }

    // 2. Validazione del path: deve esistere ed essere una directory.
    let path = std::path::Path::new(project_path);
    if !path.exists() {
        return Err(format!("Il path non esiste: {}", project_path));
    }
    if !path.is_dir() {
        return Err(format!("Il path non è una directory: {}", project_path));
    }

    // 3. Costruisci il comando PowerShell. Coerente con `run_cli`:
    //    singole attorno al path per gestire spazi, `-NoExit` non serve
    //    qui perché il child muore quando PowerShell esce dalla pipe.
    let ps_command = format!("cd '{}'; {}", project_path, cli_id);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Impossibile aprire PTY: {}", e))?;

    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.args(["-NoProfile", "-Command", &ps_command]);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Impossibile avviare PowerShell: {}", e))?;

    // 4. Prendi i pezzi che ci servono. `master` lo conserviamo per
    //    `resize`; `writer` per `pty_write`; `reader` lo usiamo nel
    //    thread reader e poi lo droppiamo.
    let master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|e| format!("Impossibile ottenere writer PTY: {}", e))?;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("Impossibile clonare reader PTY: {}", e))?;

    // 5. Salva la sessione nello state PRIMA di lanciare il thread
    //    reader, così se arriva un `pty:write` imminente trova già
    //    l'handle.
    {
        let mut state_guard = state.lock().map_err(|e| format!("State lock poisoned: {}", e))?;
        let session = PtySession {
            id: session_id.to_string(),
            window_label: window_label.to_string(),
            cli_id: cli_id.to_string(),
            master,
            writer,
            child,
        };
        state_guard
            .sessions
            .insert(session_id.to_string(), session);
        state_guard
            .window_sessions
            .entry(window_label.to_string())
            .or_insert_with(Vec::new)
            .push(session_id.to_string());
    }

    // 6. Thread reader: legge dal PTY e emette eventi Tauri. Usa
    //    `try_clone_writer` non serve qui — usiamo direttamente l'event
    //    channel di Tauri via `app.emit(...)`.
    let app_handle = app.clone();
    let session_id_owned = session_id.to_string();
    let state_for_reader = state.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF: il child ha chiuso lo slave. Leggiamo l'exit
                    // code e usciamo.
                    let exit_code = {
                        let mut state_guard = match state_for_reader.lock() {
                            Ok(g) => g,
                            Err(_) => break,
                        };
                        if let Some(session) = state_guard.sessions.get_mut(&session_id_owned) {
                            match session.child.wait() {
                                Ok(status) => status.exit_code() as i32,
                                Err(_) => -1,
                            }
                        } else {
                            -1
                        }
                    };
                    let _ = app_handle.emit(
                        "pty:exit",
                        PtyExitEvent {
                            session_id: session_id_owned.clone(),
                            code: Some(exit_code),
                        },
                    );
                    // Rimuovi la sessione dallo state (il cleanup di
                    // window_sessions lo fa on_window_event).
                    if let Ok(mut state_guard) = state_for_reader.lock() {
                        state_guard.sessions.remove(&session_id_owned);
                    }
                    break;
                }
                Ok(n) => {
                    // Converti in UTF-8 (perdita su binari, OK per CLI text).
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_handle.emit(
                        "pty:data",
                        PtyDataEvent {
                            session_id: session_id_owned.clone(),
                            data: chunk,
                        },
                    );
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "pty:error",
                        PtyErrorEvent {
                            session_id: session_id_owned.clone(),
                            message: format!("Read error: {}", e),
                        },
                    );
                    if let Ok(mut state_guard) = state_for_reader.lock() {
                        state_guard.sessions.remove(&session_id_owned);
                    }
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Scrive `data` (input utente da tastiera) nel PTY della sessione.
pub fn write_pty(
    state: &PtyStateHandle,
    session_id: &str,
    data: &str,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| format!("State lock poisoned: {}", e))?;
    let session = state_guard
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("Sessione PTY non trovata: {}", session_id))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Errore scrittura PTY: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Errore flush PTY: {}", e))?;
    Ok(())
}

/// Ridimensiona il PTY (chiamato da ResizeObserver su xterm container).
pub fn resize_pty(
    state: &PtyStateHandle,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| format!("State lock poisoned: {}", e))?;
    let session = state_guard
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| format!("Sessione PTY non trovata: {}", session_id))?;
    session
        .master
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Errore resize PTY: {}", e))?;
    Ok(())
}

/// Termina il child della sessione. NON rimuove da `window_sessions`:
/// quello lo fa `kill_all_for_window` quando la finestra si chiude.
pub fn kill_pty(state: &PtyStateHandle, session_id: &str) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| format!("State lock poisoned: {}", e))?;
    if let Some(mut session) = state_guard.sessions.remove(session_id) {
        let _ = session.child.kill();
        // Lascia che il thread reader si accorga dell'EOF e si chiuda
        // da solo. Non lo aspettiamo qui per non bloccare la UI.
    }
    Ok(())
}

/// Killa tutti i PTY di una data finestra. Chiamato da `on_window_event`
/// quando `WindowEvent::CloseRequested` arriva con `window.label() ==
/// "terminal"`. Svuota anche `window_sessions[label]`.
pub fn kill_all_for_window(state: &PtyStateHandle, window_label: &str) {
    if let Ok(mut state_guard) = state.lock() {
        let session_ids = state_guard
            .window_sessions
            .remove(window_label)
            .unwrap_or_default();
        for sid in session_ids {
            if let Some(mut session) = state_guard.sessions.remove(&sid) {
                let _ = session.child.kill();
            }
        }
    }
}
