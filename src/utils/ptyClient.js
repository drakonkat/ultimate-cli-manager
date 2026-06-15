import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Wrapper JS per i command PTY del backend Rust (`pty_manager.rs`) e per
 * gli eventi `pty:data` / `pty:exit` / `pty:error` emessi dal thread reader.
 *
 * API:
 *   - `ptySpawn({ cliId, projectPath, cols, rows, windowLabel, sessionId })`
 *       → spawna il PTY lato Rust. Ritorna il sessionId.
 *   - `ptyWrite(sessionId, data)` → input utente al PTY.
 *   - `ptyResize(sessionId, cols, rows)` → resize del PTY.
 *   - `ptyKill(sessionId)` → termina il child del PTY.
 *   - `subscribePty(sessionId, callback)` → ascolta eventi per quella sessione.
 *
 * Pattern listener: una sola `listen()` per tipo di evento (setup lazy),
 * poi fan-out in JS via `Map<sessionId, Set<callback>>`. Questo evita
 * di aprire 3 canali IPC per ogni tab del terminale.
 */

// Map<sessionId, Set<callback>>
const listeners = new Map();

// Flag per il setup lazy dei listener globali (una sola volta per app).
let _wired = false;

/**
 * Setup lazy dei listener Rust→JS. Idempotente. Chiamato internamente
 * da `subscribePty` prima della prima subscribe.
 */
async function ensureWired() {
  if (_wired) return;
  _wired = true;

  await listen('pty:data', (e) => {
    const { sessionId, data } = e.payload;
    const subs = listeners.get(sessionId);
    if (subs) {
      for (const cb of subs) cb({ kind: 'data', data });
    }
  });

  await listen('pty:exit', (e) => {
    const { sessionId, code } = e.payload;
    const subs = listeners.get(sessionId);
    if (subs) {
      for (const cb of subs) cb({ kind: 'exit', code });
    }
  });

  await listen('pty:error', (e) => {
    const { sessionId, message } = e.payload;
    const subs = listeners.get(sessionId);
    if (subs) {
      for (const cb of subs) cb({ kind: 'error', message });
    }
  });
}

/**
 * Apre un PTY lato backend. Genera lato Rust un thread reader che
 * emette `pty:data` ad ogni chunk di output.
 *
 * @param {Object} args
 * @param {string} args.cliId         - es. "claude", "junie"
 * @param {string} args.projectPath   - path assoluto del progetto (cwd)
 * @param {number} args.cols          - colonne iniziali del PTY
 * @param {number} args.rows          - righe iniziali del PTY
 * @param {string} args.windowLabel   - label della finestra Tauri (es. "terminal")
 * @param {string} args.sessionId     - UUID generato in JS
 * @returns {Promise<string>} il sessionId (eco dell'input)
 */
export async function ptySpawn({
  cliId,
  projectPath,
  cols,
  rows,
  windowLabel,
  sessionId,
}) {
  return invoke('pty_spawn', {
    cliId,
    projectPath,
    cols,
    rows,
    windowLabel,
    sessionId,
  });
}

/**
 * Scrive `data` nel PTY della sessione (input utente da tastiera).
 * @param {string} sessionId
 * @param {string} data    - stringa (NON bytes) da scrivere
 */
export async function ptyWrite(sessionId, data) {
  return invoke('pty_write', { sessionId, data });
}

/**
 * Ridimensiona il PTY. Chiamato da ResizeObserver su xterm container.
 * @param {string} sessionId
 * @param {number} cols
 * @param {number} rows
 */
export async function ptyResize(sessionId, cols, rows) {
  return invoke('pty_resize', { sessionId, cols, rows });
}

/**
 * Killa il child della sessione e rimuove dallo state.
 * @param {string} sessionId
 */
export async function ptyKill(sessionId) {
  return invoke('pty_kill', { sessionId });
}

/**
 * Sottoscrivi agli eventi PTY per una data sessione.
 * Ricevi callback con shape `{ kind, ...payload }` dove `kind` è
 * `'data' | 'exit' | 'error'`.
 *
 * @param {string} sessionId
 * @param {(ev: {kind: string, data?: string, code?: number, message?: string}) => void} callback
 * @returns {Promise<() => void>} funzione di unsubscribe
 */
export async function subscribePty(sessionId, callback) {
  await ensureWired();
  if (!listeners.has(sessionId)) {
    listeners.set(sessionId, new Set());
  }
  listeners.get(sessionId).add(callback);
  return () => {
    const subs = listeners.get(sessionId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) listeners.delete(sessionId);
    }
  };
}
