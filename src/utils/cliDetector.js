import { invoke } from '@tauri-apps/api/core';

/**
 * Cache in-memory per i risultati di detectAllCLIs().
 * Si invalida automaticamente dopo CACHE_TTL_MS millisecondi.
 */
const CLI_CACHE_TTL_MS = 30_000; // 30 secondi
let _cliCache = { result: null, timestamp: 0 };

/**
 * Rileva se una CLI è installata controllando i path standard Windows.
 * @param {string} cliId - ID della CLI (claude, junie, cline, kilo, opencode)
 * @returns {Promise<boolean>} true se installata
 */
export async function detectCLI(cliId) {
  try {
    return await invoke('check_cli', { cliId });
  } catch (e) {
    console.error(`Errore rilevamento ${cliId}:`, e);
    return false;
  }
}

/**
 * Rileva tutte le CLI supportate in parallelo.
 * Risultati cached per CACHE_TTL_MS per evitare ri-detections
 * innecesarie su tab switch (la UI non si blocca più).
 * @returns {Promise<{claude: boolean, junie: boolean, cline: boolean, kilo: boolean, opencode: boolean}>}
 */
export async function detectAllCLIs() {
  const now = Date.now();
  if (_cliCache.result && now - _cliCache.timestamp < CLI_CACHE_TTL_MS) {
    return _cliCache.result;
  }
  const ids = ['claude', 'junie', 'cline', 'kilo', 'opencode'];
  const results = await Promise.all(
    ids.map(async (id) => [id, await detectCLI(id)])
  );
  _cliCache = { result: Object.fromEntries(results), timestamp: now };
  return _cliCache.result;
}

export const CLI_LIST = [
  { id: 'claude', name: 'Claude Code', icon: '🧠', docs: 'https://docs.anthropic.com/' },
  { id: 'junie', name: 'Junie', icon: '🔵', docs: 'https://junie.jetbrains.com/docs/' },
  { id: 'cline', name: 'Cline', icon: '⚡', docs: 'https://docs.cline.bot/' },
  { id: 'kilo', name: 'Kilo', icon: '⚡', docs: 'https://kilo.ai/docs/' },
  { id: 'opencode', name: 'OpenCode', icon: '🚀', docs: 'https://opencode.ai/docs/' },
];
