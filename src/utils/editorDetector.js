import { invoke } from '@tauri-apps/api/core';

/**
 * Lista degli editor/IDE supportati dalla tab "Project".
 * Coincide con `EDITOR_WHITELIST` in `src-tauri/src/lib.rs`.
 *
 * `cmd` è il comando CLI che l'editor espone nel PATH (es. `code`,
 * `cursor`, `idea`, `webstorm`). Verificato da `get_all_editors_status`
 * lato Rust (detection in background all'avvio) e usato da
 * `open_in_editor` per lanciare l'editor.
 */
export const EDITOR_LIST = [
  { id: 'vscode',   name: 'VSCode',   icon: '💙', cmd: 'code' },
  { id: 'cursor',   name: 'Cursor',   icon: '⚡', cmd: 'cursor' },
  { id: 'intellij', name: 'IntelliJ', icon: '🧠', cmd: 'idea' },
  { id: 'webstorm', name: 'WebStorm', icon: '🌐', cmd: 'webstorm' },
];

/**
 * Cache in-memory locale per `detectAllEditors()`.
 * La detection reale è già in background su Rust all'avvio dell'app;
 * qui facciamo solo da passepartout per non ripetere l'IPC tra tab switch.
 */
let _editorCache = { result: null, timestamp: 0 };
const EDITOR_CACHE_TTL_MS = 60_000; // 60 secondi (la cache Rust vive per tutta la sessione)

/**
 * Ritorna lo stato degli editor. La prima volta blocca ~50ms mentre
 * Rust finisce la detection in background; le chiamate successive
 * sono istantanee (cache locale).
 * Ritorna una mappa `{ [editorId]: boolean }` — `true` = disponibile.
 */
export async function detectAllEditors() {
  const now = Date.now();
  if (_editorCache.result && now - _editorCache.timestamp < EDITOR_CACHE_TTL_MS) {
    return _editorCache.result;
  }
  // Un solo IPC: Rust ritorna tutti gli editor in un colpo solo,
  // già pre-computati in background all'avvio.
  const result = await invoke('get_all_editors_status');
  _editorCache = { result, timestamp: now };
  return result;
}
