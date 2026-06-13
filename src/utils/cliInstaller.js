import { invoke } from '@tauri-apps/api/core';

/**
 * Comandi di installazione per ogni CLI su Windows.
 * Documentati in docs/superpowers/specs/.
 */
export const INSTALL_COMMANDS = {
  claude: 'powershell -NoProfile -Command "irm https://claude.ai/install.ps1 | iex"',
  junie: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm \'https://junie.jetbrains.com/install.ps1\')"',
  cline: 'npm install -g @anthropic-ai/cline',
  kilo: 'npm install -g @kilocode/cli',
  opencode: 'npm install -g opencode-ai',
};

/**
 * Installa una CLI eseguendo il comando di installazione.
 * @param {string} cliId - ID della CLI
 * @returns {Promise<string>} Output del comando
 */
export async function installCLI(cliId) {
  if (!INSTALL_COMMANDS[cliId]) {
    throw new Error(`Comando installazione non trovato per: ${cliId}`);
  }
  return await invoke('install_cli', { cliId });
}
