import { invoke } from '@tauri-apps/api/core';

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
 * @returns {Promise<{claude: boolean, junie: boolean, cline: boolean, kilo: boolean, opencode: boolean}>}
 */
export async function detectAllCLIs() {
  const ids = ['claude', 'junie', 'cline', 'kilo', 'opencode'];
  const results = await Promise.all(
    ids.map(async (id) => [id, await detectCLI(id)])
  );
  return Object.fromEntries(results);
}

export const CLI_LIST = [
  { id: 'claude', name: 'Claude Code', icon: '🧠', docs: 'https://docs.anthropic.com/' },
  { id: 'junie', name: 'Junie', icon: '🔵', docs: 'https://junie.jetbrains.com/docs/' },
  { id: 'cline', name: 'Cline', icon: '⚡', docs: 'https://docs.cline.bot/' },
  { id: 'kilo', name: 'Kilo', icon: '⚡', docs: 'https://kilo.ai/docs/' },
  { id: 'opencode', name: 'OpenCode', icon: '🚀', docs: 'https://opencode.ai/docs/' },
];
