import { invoke } from '@tauri-apps/api/core';

/**
 * Lista degli editor/IDE supportati dalla tab "Project".
 * Coincide con `EDITOR_WHITELIST` in `src-tauri/src/lib.rs`.
 *
 * `cmd` is the CLI command the editor exposes in PATH (e.g. `code`,
 * `cursor`, `idea`, `webstorm`). Verified by `get_all_editors_status`
 * on the Rust side (detection in background at app start) and used by
 * `open_in_editor` to launch the editor.
 */
export const EDITOR_LIST = [
  { id: 'vscode',   name: 'VSCode',   icon: '💙', cmd: 'code' },
  { id: 'cursor',   name: 'Cursor',   icon: '⚡', cmd: 'cursor' },
  { id: 'intellij', name: 'IntelliJ', icon: '🧠', cmd: 'idea' },
  { id: 'webstorm', name: 'WebStorm', icon: '🌐', cmd: 'webstorm' },
];

/**
 * Local in-memory cache for `detectAllEditors()`.
 * Real detection is already in background on Rust at app startup;
 * here we just act as a passthrough to avoid repeating IPC on tab switch.
 */
let _editorCache = { result: null, timestamp: 0 };
const EDITOR_CACHE_TTL_MS = 60_000; // 60 secondi (la cache Rust vive per tutta la sessione)

/**
 * Ritorna lo stato degli editor. La prima volta blocca ~50ms mentre
 * Rust finisce la detection in background; le chiamate successive
 * sono istantanee (cache locale).
 * Returns a map `{ [editorId]: boolean }` — `true` = available.
 */
export async function detectAllEditors() {
  const now = Date.now();
  if (_editorCache.result && now - _editorCache.timestamp < EDITOR_CACHE_TTL_MS) {
    return _editorCache.result;
  }
  // Single IPC: Rust returns all editors at once,
  // already pre-computed in background at startup.
  const result = await invoke('get_all_editors_status');
  _editorCache = { result, timestamp: now };
  return result;
}
