import { invoke } from '@tauri-apps/api/core';

/**
 * Lista degli editor/IDE supportati dalla tab "Project".
 * Coincide con `EDITOR_WHITELIST` in `src-tauri/src/lib.rs`.
 *
 * `cmd` è il comando CLI che l'editor espone nel PATH (es. `code`,
 * `cursor`, `idea`, `webstorm`). Verificato da `check_editor` lato
 * Rust e usato da `open_in_editor` per lanciare l'editor.
 */
export const EDITOR_LIST = [
  { id: 'vscode',   name: 'VSCode',   icon: '💙', cmd: 'code' },
  { id: 'cursor',   name: 'Cursor',   icon: '⚡', cmd: 'cursor' },
  { id: 'intellij', name: 'IntelliJ', icon: '🧠', cmd: 'idea' },
  { id: 'webstorm', name: 'WebStorm', icon: '🌐', cmd: 'webstorm' },
];

/**
 * Rileva quali editor sono installati sulla macchina, chiamando il
 * comando Rust `check_editor` per ciascuno. Ritorna una mappa
 * `{ [editorId]: boolean }` — `true` = disponibile nel PATH.
 *
 * In caso di errore di un singolo editor, viene considerato non
 * disponibile (l'errore non blocca gli altri).
 */
export async function detectAllEditors() {
  const result = {};
  for (const ed of EDITOR_LIST) {
    try {
      result[ed.id] = await invoke('check_editor', { editorId: ed.id });
    } catch (e) {
      console.warn(`detectAllEditors: errore per ${ed.id}:`, e);
      result[ed.id] = false;
    }
  }
  return result;
}
