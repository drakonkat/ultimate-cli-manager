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
    ucm_instructions: String,
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
            ucm_instructions: String::new(),
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

    CliPaths {
        agents,
        skills,
        character,
        character_json,
        ucm_instructions: pb(p.home.join(".ucm").join("instructions.md")),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_url_cmd, path_exists, check_cli, install_cli, read_file, write_file, ensure_dir, test_mcp, get_cli_paths, list_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
