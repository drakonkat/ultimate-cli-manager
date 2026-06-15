import { invoke } from '@tauri-apps/api/core';
import { UCM_TEMPLATE_DIR } from './cliPaths.js';

const TEMPLATE_DIR = () => UCM_TEMPLATE_DIR;
const TEMPLATE_PATH = () => `${UCM_TEMPLATE_DIR}\\template.json`;

const DEFAULT_TEMPLATE = {
  mcp: {},
  agents: {},
  skills: {},
  character: {
    instructions: '',
  },
  _meta: {
    version: 1,
    updatedAt: new Date().toISOString(),
  },
};

/**
 * Carica il template da disco. Se non esiste, ne crea uno vuoto.
 */
export async function loadTemplate() {
  try {
    const content = await invoke('read_file', { path: TEMPLATE_PATH() });
    return JSON.parse(content);
  } catch (e) {
    console.log('Template non trovato, creo default');
    await saveTemplate(DEFAULT_TEMPLATE);
    return { ...DEFAULT_TEMPLATE };
  }
}

/**
 * Salva il template su disco.
 */
export async function saveTemplate(template) {
  await invoke('ensure_dir', { path: TEMPLATE_DIR() });
  const toSave = {
    ...template,
    _meta: {
      ...template._meta,
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  };
  await invoke('write_file', {
    path: TEMPLATE_PATH(),
    content: JSON.stringify(toSave, null, 2),
  });
  return toSave;
}

/**
 * Aggiunge o aggiorna un MCP server nel template.
 */
export async function upsertMCP(template, name, serverConfig) {
  const next = { ...template, mcp: { ...template.mcp } };
  next.mcp[name] = serverConfig;
  return saveTemplate(next);
}

/**
 * Rimuove un MCP server dal template.
 */
export async function removeMCP(template, name) {
  const next = { ...template, mcp: { ...template.mcp } };
  delete next.mcp[name];
  return saveTemplate(next);
}

/**
 * Aggiunge o aggiorna un agent nel template.
 */
export async function upsertAgent(template, name, agent) {
  const next = { ...template, agents: { ...(template.agents || {}) } };
  next.agents[name] = {
    description: agent.description || '',
    content: agent.content || '',
  };
  return saveTemplate(next);
}

/**
 * Rimuove un agent dal template.
 */
export async function removeAgent(template, name) {
  const next = { ...template, agents: { ...(template.agents || {}) } };
  delete next.agents[name];
  return saveTemplate(next);
}

/**
 * Aggiunge o aggiorna una skill nel template.
 */
export async function upsertSkill(template, name, skill) {
  const next = { ...template, skills: { ...(template.skills || {}) } };
  next.skills[name] = {
    description: skill.description || '',
    content: skill.content || '',
  };
  return saveTemplate(next);
}

/**
 * Rimuove una skill dal template.
 */
export async function removeSkill(template, name) {
  const next = { ...template, skills: { ...(template.skills || {}) } };
  delete next.skills[name];
  return saveTemplate(next);
}

/**
 * Aggiorna le istruzioni del character (testo libero markdown).
 */
export async function setCharacter(template, instructions) {
  const next = {
    ...template,
    character: { ...(template.character || {}), instructions: instructions || '' },
  };
  return saveTemplate(next);
}

export { TEMPLATE_PATH, TEMPLATE_DIR };
