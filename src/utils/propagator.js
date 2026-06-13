import { invoke } from '@tauri-apps/api/core';
import { CLI_CONFIG_PATHS, mapMCPsToCLI } from './configMapper';

/**
 * Legge la config esistente di una CLI. Ritorna null se non esiste.
 */
export async function readCLIConfig(cliId) {
  const path = CLI_CONFIG_PATHS[cliId];
  if (!path) return null;
  try {
    const content = await invoke('read_file', { path });
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

/**
 * Scrive la config per una CLI.
 */
async function writeCLIConfig(cliId, config) {
  const path = CLI_CONFIG_PATHS[cliId];
  if (!path) {
    return { ok: false, reason: 'CLI non supporta configurazione MCP' };
  }
  try {
    await invoke('ensure_dir', { path: path.replace(/[^\\]+$/, '') });
    await invoke('write_file', { path, content: JSON.stringify(config, null, 2) });
    return { ok: true, path };
  } catch (e) {
    return { ok: false, reason: e };
  }
}

/**
 * Risultato di una propagazione singola.
 */
async function propagateToSingleCLI(cliId, mcpServers, overwrite) {
  if (!CLI_CONFIG_PATHS[cliId]) {
    return { cliId, status: 'skipped', reason: 'CLI non supporta MCP' };
  }

  const existing = await readCLIConfig(cliId);
  const hasExisting = existing !== null;

  if (hasExisting && !overwrite) {
    return { cliId, status: 'kept', existing };
  }

  const newConfig = mapMCPsToCLI(cliId, mcpServers);
  const result = await writeCLIConfig(cliId, newConfig);

  if (result.ok) {
    return { cliId, status: 'propagated', path: result.path };
  } else {
    return { cliId, status: 'error', reason: result.reason };
  }
}

/**
 * Propaga gli MCP dal template a tutte le CLI selezionate.
 * Se esiste una config esistente, l'utente deve aver acconsentito l'overwrite.
 *
 * @param {string[]} selectedCLIs - ID delle CLI target
 * @param {object} mcpServers - { name: serverConfig } dal template
 * @param {object} conflictResolutions - { [cliId]: true } = sovrascrivi
 */
export async function propagateToCLIs(selectedCLIs, mcpServers, conflictResolutions = {}) {
  const results = [];

  for (const cliId of selectedCLIs) {
    const existing = await readCLIConfig(cliId);
    const hasExisting = existing !== null;

    let overwrite = false;
    if (hasExisting) {
      overwrite = conflictResolutions[cliId] === true;
    } else {
      overwrite = true; // niente conflitti se non esiste
    }

    const result = await propagateToSingleCLI(cliId, mcpServers, overwrite);
    results.push(result);
  }

  return results;
}

/**
 * Rileva i conflitti (CLI con config esistente) prima di propagare.
 * Ritorna array di cliId che hanno già una config.
 */
export async function detectConflicts(selectedCLIs) {
  const conflicts = [];
  for (const cliId of selectedCLIs) {
    if (!CLI_CONFIG_PATHS[cliId]) continue;
    const existing = await readCLIConfig(cliId);
    if (existing !== null) {
      conflicts.push(cliId);
    }
  }
  return conflicts;
}
