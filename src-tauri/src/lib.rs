use tauri_plugin_opener::open_url;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::fs;
use std::time::Duration;

// ======================================================================
// UserPaths: SINGLE SOURCE OF TRUTH per i path utente delle CLI.
// Usato sia da `check_cli` (verifica installazione) sia da `get_cli_paths`
// (path completi esposti al frontend per agents/skills/character).
// ======================================================================
struct UserPaths {
    /// %USERPROFILE% su Windows, $HOME su Unix
    home: PathBuf,
    /// %APPDATA% su Windows (Roaming), $XDG_CONFIG_HOME su Linux
    roaming: PathBuf,
    /// %LOCALAPPDATA% su Windows, $XDG_DATA_HOME su Linux
    local: PathBuf,
}

impl UserPaths {
    fn resolve() -> Option<Self> {
        let home = dirs::home_dir()?;
        let roaming = dirs::config_dir()
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        let local = dirs::data_local_dir()
            .unwrap_or_else(|| home.join("AppData").join("Local"));
        Some(Self { home, roaming, local })
    }
}

/// Converte un PathBuf in String per la serializzazione JSON.
fn pb(p: PathBuf) -> String {
    p.to_string_lossy().into_owned()
}

/// Struttura serializzata restituita da `get_cli_paths` e consumata dal
/// frontend JS (`src/utils/cliPaths.js`) per popolare le costanti
/// `AGENTS_PATHS`, `SKILLS_PATHS`, ecc.
///
/// Le chiavi interne sono i CLI id (`claude`, `junie`, `cline`, `kilo`,
/// `opencode`); il valore è `Some(path)` o `None` se la CLI non supporta
/// quella categoria.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CliPaths {
    agents: HashMap<String, Option<String>>,
    skills: HashMap<String, Option<String>>,
    character: HashMap<String, Option<String>>,
    character_json: HashMap<String, Option<String>>,
    mcp_config: HashMap<String, Option<String>>,
    ucm_instructions: String,
    ucm_template_dir: String,
}

/// Espone al frontend JS tutti i path delle CLI risolti a runtime.
/// È il SINGLE SOURCE OF TRUTH lato Rust — il JS non duplica nessuna
/// stringa di path, fa solo `Object.assign` sulla cache locale.
#[tauri::command]
fn get_cli_paths() -> CliPaths {
    let Some(p) = UserPaths::resolve() else {
        return CliPaths {
            agents: HashMap::new(),
            skills: HashMap::new(),
            character: HashMap::new(),
            character_json: HashMap::new(),
            mcp_config: HashMap::new(),
            ucm_instructions: String::new(),
            ucm_template_dir: String::new(),
        };
    };

    // agents/
    let mut agents = HashMap::new();
    agents.insert("claude".into(), Some(pb(p.home.join(".claude").join("agents"))));
    agents.insert("opencode".into(), Some(pb(p.home.join(".config").join("opencode").join("agents"))));
    agents.insert("kilo".into(), Some(pb(p.home.join(".config").join("kilo").join("agents"))));
    agents.insert("junie".into(), Some(pb(p.home.join(".junie").join("agents"))));
    agents.insert("cline".into(), None);

    // skills/
    let mut skills = HashMap::new();
    skills.insert("claude".into(), Some(pb(p.home.join(".claude").join("skills"))));
    skills.insert("opencode".into(), Some(pb(p.home.join(".config").join("opencode").join("skills"))));
    skills.insert("kilo".into(), Some(pb(p.home.join(".config").join("kilo").join("skills"))));
    skills.insert("junie".into(), Some(pb(p.home.join(".junie").join("skills"))));
    skills.insert("cline".into(), None);

    // character file (path diretto al file libero)
    let mut character = HashMap::new();
    character.insert("claude".into(), Some(pb(p.home.join(".claude").join("CLAUDE.md"))));
    character.insert("junie".into(), Some(pb(p.home.join(".junie").join("guidelines.md"))));
    character.insert("cline".into(), Some(pb(p.home.join(".cline").join("character.md"))));
    character.insert("opencode".into(), None); // usa opencode.json campo instructions
    character.insert("kilo".into(), None);     // usa kilo.jsonc campo instructions

    // character json (file di config con campo `instructions`)
    let mut character_json = HashMap::new();
    character_json.insert("opencode".into(), Some(pb(p.home.join(".config").join("opencode").join("opencode.json"))));
    character_json.insert("kilo".into(), Some(pb(p.home.join(".config").join("kilo").join("kilo.jsonc"))));

    // mcp config (path ai file JSON di config MCP per ogni CLI)
    let mut mcp_config = HashMap::new();
    mcp_config.insert("claude".into(), Some(pb(p.home.join(".claude.json"))));
    mcp_config.insert("junie".into(), Some(pb(p.home.join(".junie").join("mcp").join("mcp.json"))));
    mcp_config.insert("cline".into(), Some(pb(p.home.join(".cline").join("mcp.json"))));
    mcp_config.insert("kilo".into(), Some(pb(p.home.join(".config").join("kilo").join("kilo.jsonc"))));
    mcp_config.insert("opencode".into(), Some(pb(p.home.join(".config").join("opencode").join("opencode.json"))));

    CliPaths {
        agents,
        skills,
        character,
        character_json,
        mcp_config,
        ucm_instructions: pb(p.home.join(".ucm").join("instructions.md")),
        ucm_template_dir: pb(p.home.join(".ucm")),
    }
}

#[tauri::command]
fn open_url_cmd(url: &str) -> Result<(), String> {
    open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

#[tauri::command]
fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Errore lettura {}: {}", path, e))
}

#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| format!("Errore scrittura {}: {}", path, e))
}

#[tauri::command]
fn ensure_dir(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(path: &str) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(path).map_err(|e| format!("Errore lettura directory {}: {}", path, e))?;
    let mut names: Vec<String> = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
fn test_mcp(server_type: &str, command: Option<Vec<String>>, url: Option<String>) -> Result<String, String> {
    if server_type == "remote" {
        let url = url.ok_or("URL mancante per server remote")?;
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                &format!("try {{ (Invoke-WebRequest -Uri '{}' -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop).StatusCode }} catch {{ $_.Exception.Message }}", url),
            ])
            .output()
            .map_err(|e| format!("Errore esecuzione: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if output.status.success() {
            Ok(format!("✓ Server raggiungibile (status: {})", stdout.trim()))
        } else {
            Err(format!("✗ Server non raggiungibile:\n{}\n{}", stdout, stderr))
        }
    } else {
        let cmd = command.ok_or("Comando mancante per server local")?;
        if cmd.is_empty() {
            return Err("Comando vuoto".to_string());
        }
        let program = &cmd[0];
        let args: Vec<&str> = cmd[1..].iter().map(|s| s.as_str()).collect();

        let mut child = Command::new(program)
            .args(&args)
            .env("NODE_NO_WARNINGS", "1")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Impossibile avviare '{}': {}", program, e))?;

        std::thread::sleep(Duration::from_secs(3));

        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    Ok(format!("✓ Comando eseguito ed uscito con successo"))
                } else {
                    Err(format!("✗ Comando terminato con errore (exit {:?})", status.code()))
                }
            }
            Ok(None) => {
                let _ = child.kill();
                Ok(format!("✓ Comando avviato correttamente (processo ancora running dopo 3s — segno buono per server MCP)"))
            }
            Err(e) => Err(format!("Errore check processo: {}", e)),
        }
    }
}

#[tauri::command]
fn check_cli(cli_id: &str) -> bool {
    // Risolve i path utente in modo portabile (no hardcoded username).
    // - home: %USERPROFILE% su Windows, $HOME su Unix
    // - roaming: %APPDATA% su Windows, $XDG_CONFIG_HOME su Linux
    // - local:   %LOCALAPPDATA% su Windows, $XDG_DATA_HOME su Linux
    let Some(p) = UserPaths::resolve() else {
        return false;
    };

    let paths: Vec<PathBuf> = match cli_id {
        "claude" => vec![
            p.home.join(".claude"),
            p.roaming.join("Claude"),
        ],
        "junie" => vec![
            p.home.join(".junie"),
            p.roaming.join("Junie"),
            p.local.join("Junie"),
        ],
        "cline" => vec![
            p.home.join(".cline"),
        ],
        "kilo" => vec![
            p.home.join(".config").join("kilo"),
        ],
        "opencode" => vec![
            p.home.join(".config").join("opencode"),
        ],
        _ => vec![],
    };

    paths.iter().any(|p| p.exists())
}

#[tauri::command]
fn install_cli(cli_id: &str) -> Result<String, String> {
    let (program, args) = match cli_id {
        "claude" => (
            "powershell.exe",
            vec!["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"],
        ),
        "junie" => (
            "powershell.exe",
            vec!["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "iex (irm 'https://junie.jetbrains.com/install.ps1')"],
        ),
        "cline" => (
            "npm.cmd",
            vec!["install", "-g", "@anthropic-ai/cline"],
        ),
        "kilo" => (
            "npm.cmd",
            vec!["install", "-g", "@kilocode/cli"],
        ),
        "opencode" => (
            "npm.cmd",
            vec!["install", "-g", "opencode-ai"],
        ),
        _ => return Err(format!("CLI sconosciuta: {}", cli_id)),
    };

    let output = Command::new(program)
        .args(&args)
        .output()
        .map_err(|e| format!("Errore esecuzione {}: {}", program, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("Installazione completata:\n{}", stdout))
    } else {
        Err(format!("Errore installazione (exit {:?}):\n{}\n{}", output.status.code(), stdout, stderr))
    }
}

/// Lista di CLI id accettati dal comando `run_cli`. Coincide con
/// `CLI_LIST` in `src/utils/cliDetector.js` e con i branch di
/// `check_cli` / `install_cli` nel backend.
const RUN_CLI_WHITELIST: &[&str] = &["claude", "junie", "cline", "kilo", "opencode"];

/// Apre una nuova finestra PowerShell persistente, fa `cd <project_path>`
/// e lancia il comando della CLI scelta. La finestra resta aperta
/// (parametro `-NoExit`), così l'utente può continuare a interagire
/// con la CLI dopo l'avvio.
///
/// Usato dalla tab "Project" (`src/components/TabProject.jsx`).
/// Usa `.spawn()` (non `.output()` come `install_cli`) perché NON
/// vogliamo bloccare il thread della UI Tauri.
#[tauri::command]
fn run_cli(cli_id: &str, project_path: &str) -> Result<(), String> {
    // 1. Whitelist del cli_id.
    if !RUN_CLI_WHITELIST.contains(&cli_id) {
        return Err(format!("CLI sconosciuta: {}", cli_id));
    }

    // 2. Validazione del path: deve esistere ed essere una directory.
    let path = Path::new(project_path);
    if !path.exists() {
        return Err(format!("Il path non esiste: {}", project_path));
    }
    if !path.is_dir() {
        return Err(format!("Il path non è una directory: {}", project_path));
    }

    // 3. Comando PowerShell: `cd '<path>'; <cli_id>`. Le singole attorno
    //    al path gestiscono path con spazi (es. `C:\My Projects\…`).
    //    `-NoExit` mantiene la finestra aperta dopo `claude`/`kilo`/ecc.
    let ps_command = format!("cd '{}'; {}", project_path, cli_id);

    Command::new("powershell.exe")
        .args(["-NoExit", "-Command", &ps_command])
        .spawn()
        .map_err(|e| format!("Impossibile avviare PowerShell: {}", e))?;

    Ok(())
}

/// Mappa editor_id → comando binario. Coincide con `EDITOR_LIST`
/// in `src/utils/editorDetector.js` (frontend).
const EDITOR_WHITELIST: &[(&str, &str)] = &[
    ("vscode",   "code"),
    ("cursor",   "cursor"),
    ("intellij", "idea"),
    ("webstorm", "webstorm"),
];

/// Controlla se il comando CLI di un editor è disponibile nel PATH.
/// Su Windows usa `where`, su Unix `which`. Veloce e non blocca la UI.
#[tauri::command]
fn check_editor(editor_id: &str) -> bool {
    let cmd = match EDITOR_WHITELIST.iter().find(|(id, _)| *id == editor_id) {
        Some((_, c)) => *c,
        None => return false,
    };

    #[cfg(target_os = "windows")]
    let output = Command::new("where").arg(cmd).output();
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("which").arg(cmd).output();

    output.map(|o| o.status.success()).unwrap_or(false)
}

/// Apre il progetto nell'editor/IDE specificato, passando il path come
/// argomento. L'editor resta in foreground e l'utente può interagire
/// con la cartella aperta.
///
/// Usato dalla tab "Project" (`src/components/TabProject.jsx`) come
/// alternativa al flusso CLI (che apre una PowerShell). Qui non serve
/// PowerShell: il comando binario si lancia direttamente.
#[tauri::command]
fn open_in_editor(editor_id: &str, project_path: &str) -> Result<(), String> {
    // 1. Whitelist del editor_id → comando binario.
    let cmd = match EDITOR_WHITELIST.iter().find(|(id, _)| *id == editor_id) {
        Some((_, c)) => *c,
        None => return Err(format!("Editor sconosciuto: {}", editor_id)),
    };

    // 2. Validazione del path: deve esistere ed essere una directory.
    let path = Path::new(project_path);
    if !path.exists() {
        return Err(format!("Il path non esiste: {}", project_path));
    }
    if !path.is_dir() {
        return Err(format!("Il path non è una directory: {}", project_path));
    }

    // 2b. Canonicalizza in full path assoluto. Necessario per
    //     IntelliJ/WebStorm (e altri editor JetBrains) che si aspettano
    //     un path assoluto tipo `idea "C:\Path\To\Your\Project"`.
    //     Risolve anche `..` / `.` / symlink, e garantisce quoting
    //     corretto anche con spazi nel path.
    let abs_path = fs::canonicalize(path)
        .map_err(|e| format!("Impossibile risolvere il full path: {}", e))?;

    // 3. Risolvi il comando tramite `where`/`which` per ottenere il path
    //    completo (es. `C:\Users\...\idea.cmd`). Su Windows `Command::new("idea")`
    //    non trova il comando se manca l'estensione .cmd; usare il path
    //    completo risolve il problema.
    #[cfg(target_os = "windows")]
    let full_cmd = {
        let output = Command::new("where").arg(cmd).output()
            .map_err(|e| format!("Errore probing editor: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "Comando '{}' non trovato nel PATH. Installa l'editor o aggiungilo al PATH.",
                cmd
            ));
        }
        // Prendi la prima riga (path completo al .cmd o .exe)
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.lines().next()
            .map(|s| s.trim().to_string())
            .ok_or_else(|| format!("Risposta 'where' vuota per '{}'", cmd))?
    };
    #[cfg(not(target_os = "windows"))]
    let full_cmd = {
        let output = Command::new("which").arg(cmd).output()
            .map_err(|e| format!("Errore probing editor: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "Comando '{}' non trovato nel PATH. Installa l'editor o aggiungilo al PATH.",
                cmd
            ));
        }
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    // 4. Spawn: su Windows usa `cmd.exe /c` per eseguire .cmd/.bat;
    //    su Unix usa il comando direttamente.
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd.exe")
            .args(["/c", &full_cmd, abs_path.to_str().unwrap_or_default()])
            .spawn()
            .map_err(|e| format!("Impossibile avviare '{}': {}", full_cmd, e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&full_cmd)
            .arg(&abs_path)
            .spawn()
            .map_err(|e| format!("Impossibile avviare '{}': {}", full_cmd, e))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_url_cmd, path_exists, check_cli, install_cli, read_file, write_file, ensure_dir, test_mcp, get_cli_paths, list_dir, run_cli, check_editor, open_in_editor])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
