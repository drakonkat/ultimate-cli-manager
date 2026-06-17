import { invoke } from '@tauri-apps/api/core';
import { mapMCPsToCLI } from './configMapper';
import {
  AGENTS_PATHS,
  SKILLS_PATHS,
  MCP_CONFIG_PATHS,
  CHARACTER_PATHS,
  CHARACTER_JSON_PATHS,
  UCM_INSTRUCTIONS_FILE,
  getAgentFilePath,
  getSkillFilePath,
  supportsAgents,
  supportsSkills,
  supportsCharacter,
} from './cliPaths';

/**
 * Reads the existing config of a CLI. Returns null if it doesn't exist.
 */
export async function readCLIConfig(cliId) {
  const path = MCP_CONFIG_PATHS[cliId];
  if (!path) return null;
  try {
    const content = await invoke('read_file', { path });
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

/**
 * Writes the config for a CLI.
 */
async function writeCLIConfig(cliId, config) {
  const path = MCP_CONFIG_PATHS[cliId];
  if (!path) {
    return { ok: false, reason: 'CLI does not support MCP configuration' };
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
 * Result of a single CLI propagation.
 */
async function propagateToSingleCLI(cliId, mcpServers, overwrite) {
  if (!MCP_CONFIG_PATHS[cliId]) {
    return { cliId, status: 'skipped', reason: 'CLI does not support MCP' };
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
      overwrite = true; // no conflicts if it doesn't exist
    }

    const result = await propagateToSingleCLI(cliId, mcpServers, overwrite);
    results.push(result);
  }

  return results;
}

/**
 * Detects conflicts (CLI with existing config) before propagating.
 * Returns array of cliId that already have a config.
 */
export async function detectConflicts(selectedCLIs) {
  const conflicts = [];
  for (const cliId of selectedCLIs) {
    if (!MCP_CONFIG_PATHS[cliId]) continue;
    const existing = await readCLIConfig(cliId);
    if (existing !== null) {
      conflicts.push(cliId);
    }
  }
  return conflicts;
}

/* ============================================================
   AGENTS
   ============================================================ */

/**
 * Scrive un singolo file agent per una CLI.
 */
async function writeAgentFile(cliId, agentName, content) {
  if (!supportsAgents(cliId)) {
    return { ok: false, reason: 'CLI does not support agents' };
  }
  const filePath = getAgentFilePath(cliId, agentName);
  try {
    await invoke('ensure_dir', { path: AGENTS_PATHS[cliId] });
    await invoke('write_file', { path: filePath, content });
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Checks if at least one agent file exists to propagate for a CLI.
 * Returns true if agentName is already present in the path.
 */
async function agentExists(cliId, agentName) {
  if (!supportsAgents(cliId)) return false;
  const filePath = getAgentFilePath(cliId, agentName);
  try {
    return await invoke('path_exists', { path: filePath });
  } catch {
    return false;
  }
}

/**
 * Detects agent conflicts: returns map { cliId: [existing agentNames] }.
 */
export async function detectAgentConflicts(selectedCLIs, agents) {
  const conflicts = {};
  for (const cliId of selectedCLIs) {
    if (!supportsAgents(cliId)) continue;
    const existing = [];
    for (const name of Object.keys(agents)) {
      if (await agentExists(cliId, name)) {
        existing.push(name);
      }
    }
    if (existing.length > 0) {
      conflicts[cliId] = existing;
    }
  }
  return conflicts;
}

/**
 * Propaga agents dal template alle CLI selezionate.
 * @param {string[]} selectedCLIs
 * @param {object} agents - { name: { description, content } }
 * @param {object} conflictResolutions - { cliId: true } = sovrascrivi tutto
 * @returns {Promise<Array<{cliId, status, path?, reason?}>>}
 */
export async function propagateAgentsToCLIs(selectedCLIs, agents, conflictResolutions = {}) {
  const results = [];
  for (const cliId of selectedCLIs) {
    if (!supportsAgents(cliId)) {
      results.push({ cliId, status: 'skipped', reason: 'CLI does not support agents' });
      continue;
    }

    const overwrite = conflictResolutions[cliId] === true;
    const cliResults = [];

    for (const [name, agent] of Object.entries(agents)) {
      const exists = await agentExists(cliId, name);
      if (exists && !overwrite) {
        cliResults.push({ agent: name, status: 'kept' });
        continue;
      }
      const res = await writeAgentFile(cliId, name, agent.content || '');
      if (res.ok) {
        cliResults.push({ agent: name, status: 'propagated', path: res.path });
      } else {
        cliResults.push({ agent: name, status: 'error', reason: res.reason });
      }
    }

    const hasError = cliResults.some((r) => r.status === 'error');
    const allKept = cliResults.every((r) => r.status === 'kept');
    let status;
    if (cliResults.length === 0) status = 'skipped';
    else if (hasError) status = 'error';
    else if (allKept) status = 'kept';
    else status = 'propagated';

    results.push({
      cliId,
      status,
      details: cliResults,
      reason: hasError ? 'Some agents were not written' : undefined,
    });
  }
  return results;
}

/* ============================================================
   SKILLS
   ============================================================ */

async function writeSkillFile(cliId, skillName, content) {
  if (!supportsSkills(cliId)) {
    return { ok: false, reason: 'CLI does not support skills' };
  }
  const filePath = getSkillFilePath(cliId, skillName);
  const dirPath = `${SKILLS_PATHS[cliId]}\\${skillName}`;
  try {
    await invoke('ensure_dir', { path: dirPath });
    await invoke('write_file', { path: filePath, content });
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

async function skillExists(cliId, skillName) {
  if (!supportsSkills(cliId)) return false;
  const filePath = getSkillFilePath(cliId, skillName);
  try {
    return await invoke('path_exists', { path: filePath });
  } catch {
    return false;
  }
}

export async function detectSkillConflicts(selectedCLIs, skills) {
  const conflicts = {};
  for (const cliId of selectedCLIs) {
    if (!supportsSkills(cliId)) continue;
    const existing = [];
    for (const name of Object.keys(skills)) {
      if (await skillExists(cliId, name)) {
        existing.push(name);
      }
    }
    if (existing.length > 0) {
      conflicts[cliId] = existing;
    }
  }
  return conflicts;
}

export async function propagateSkillsToCLIs(selectedCLIs, skills, conflictResolutions = {}) {
  const results = [];
  for (const cliId of selectedCLIs) {
    if (!supportsSkills(cliId)) {
      results.push({ cliId, status: 'skipped', reason: 'CLI does not support skills' });
      continue;
    }

    const overwrite = conflictResolutions[cliId] === true;
    const cliResults = [];

    for (const [name, skill] of Object.entries(skills)) {
      const exists = await skillExists(cliId, name);
      if (exists && !overwrite) {
        cliResults.push({ skill: name, status: 'kept' });
        continue;
      }
      const res = await writeSkillFile(cliId, name, skill.content || '');
      if (res.ok) {
        cliResults.push({ skill: name, status: 'propagated', path: res.path });
      } else {
        cliResults.push({ skill: name, status: 'error', reason: res.reason });
      }
    }

    const hasError = cliResults.some((r) => r.status === 'error');
    const allKept = cliResults.every((r) => r.status === 'kept');
    let status;
    if (cliResults.length === 0) status = 'skipped';
    else if (hasError) status = 'error';
    else if (allKept) status = 'kept';
    else status = 'propagated';

    results.push({
      cliId,
      status,
      details: cliResults,
      reason: hasError ? 'Some skills were not written' : undefined,
    });
  }
  return results;
}

/* ============================================================
   CHARACTER
   ============================================================ */

async function writeCharacterFile(filePath, content) {
  try {
    await invoke('ensure_dir', { path: filePath.replace(/[^\\]+$/, '') });
    await invoke('write_file', { path: filePath, content });
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Aggiorna il campo `instructions` in un file JSON aggiungendo/rimuovendo un path.
 * Ritorna { ok, path } o { ok: false, reason }.
 */
async function updateInstructionsField(jsonPath, targetPath, shouldInclude) {
  try {
    let json;
    try {
      const content = await invoke('read_file', { path: jsonPath });
      json = JSON.parse(content);
    } catch {
      json = {};
    }

    const arr = Array.isArray(json.instructions) ? json.instructions : [];
    const filtered = arr.filter((p) => p !== targetPath);
    if (shouldInclude) filtered.push(targetPath);
    json.instructions = filtered;

    await invoke('ensure_dir', { path: jsonPath.replace(/[^\\]+$/, '') });
    await invoke('write_file', { path: jsonPath, content: JSON.stringify(json, null, 2) });
    return { ok: true, path: jsonPath };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

async function characterFileExists(cliId) {
  if (CHARACTER_PATHS[cliId]) {
    try {
      return await invoke('path_exists', { path: CHARACTER_PATHS[cliId] });
    } catch {
      return false;
    }
  }
  if (CHARACTER_JSON_PATHS[cliId]) {
    try {
      return await invoke('path_exists', { path: CHARACTER_JSON_PATHS[cliId] });
    } catch {
      return false;
    }
  }
  return false;
}

export async function detectCharacterConflicts(selectedCLIs) {
  const conflicts = [];
  for (const cliId of selectedCLIs) {
    if (!supportsCharacter(cliId)) continue;
    if (await characterFileExists(cliId)) {
      conflicts.push(cliId);
    }
  }
  return conflicts;
}

export async function propagateCharacterToCLIs(selectedCLIs, instructions, conflictResolutions = {}) {
  const results = [];
  const content = instructions || '';

  for (const cliId of selectedCLIs) {
    if (!supportsCharacter(cliId)) {
      results.push({ cliId, status: 'skipped', reason: 'CLI does not support character' });
      continue;
    }

    const overwrite = conflictResolutions[cliId] === true;
    const exists = await characterFileExists(cliId);

    if (exists && !overwrite) {
      results.push({ cliId, status: 'kept' });
      continue;
    }

    // Caso 1: file libero (Claude, Junie, Cline)
    if (CHARACTER_PATHS[cliId]) {
      const res = await writeCharacterFile(CHARACTER_PATHS[cliId], content);
      if (res.ok) {
        results.push({ cliId, status: 'propagated', path: res.path });
      } else {
        results.push({ cliId, status: 'error', reason: res.reason });
      }
      continue;
    }

    // Caso 2: JSON con campo instructions (OpenCode, Kilo)
    if (CHARACTER_JSON_PATHS[cliId]) {
      // Write the central UCM instructions file
      try {
        await invoke('ensure_dir', { path: UCM_INSTRUCTIONS_FILE.replace(/[^\\]+$/, '') });
        await invoke('write_file', { path: UCM_INSTRUCTIONS_FILE, content });
      } catch (e) {
        results.push({ cliId, status: 'error', reason: `Failed to write instructions file: ${e}` });
        continue;
      }
      // Aggiorna il campo instructions del JSON
      const hasContent = content.trim().length > 0;
      const res = await updateInstructionsField(
        CHARACTER_JSON_PATHS[cliId],
        UCM_INSTRUCTIONS_FILE,
        hasContent
      );
      if (res.ok) {
        results.push({
          cliId,
          status: 'propagated',
          path: `${CHARACTER_JSON_PATHS[cliId]} + ${UCM_INSTRUCTIONS_FILE}`,
        });
      } else {
        results.push({ cliId, status: 'error', reason: res.reason });
      }
      continue;
    }

    results.push({ cliId, status: 'skipped', reason: 'No character path configured' });
  }
  return results;
}
