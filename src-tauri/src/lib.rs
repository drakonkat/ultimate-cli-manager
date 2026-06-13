use tauri_plugin_opener::open_url;
use std::path::Path;
use std::process::Command;
use std::fs;
use std::time::Duration;

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
    let paths = match cli_id {
        "claude" => vec![
            r"C:\Users\mauro\.claude",
            r"C:\Users\mauro\AppData\Roaming\Claude",
        ],
        "junie" => vec![
            r"C:\Users\mauro\.junie",
            r"C:\Users\mauro\AppData\Roaming\Junie",
            r"C:\Users\mauro\AppData\Local\Junie",
        ],
        "cline" => vec![
            r"C:\Users\mauro\.cline",
        ],
        "kilo" => vec![
            r"C:\Users\mauro\.config\kilo",
        ],
        "opencode" => vec![
            r"C:\Users\mauro\.config\opencode",
        ],
        _ => vec![],
    };

    paths.iter().any(|p| Path::new(p).exists())
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
        .invoke_handler(tauri::generate_handler![open_url_cmd, path_exists, check_cli, install_cli, read_file, write_file, ensure_dir, test_mcp])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
