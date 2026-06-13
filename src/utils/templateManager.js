import { invoke } from '@tauri-apps/api/core';

const TEMPLATE_DIR = 'C:\\Users\\mauro\\.ucm';
const TEMPLATE_PATH = `${TEMPLATE_DIR}\\template.json`;

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
    const content = await invoke('read_file', { path: TEMPLATE_PATH });
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
  await invoke('ensure_dir', { path: TEMPLATE_DIR });
  const toSave = {
    ...template,
    _meta: {
      ...template._meta,
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  };
  await invoke('write_file', {
    path: TEMPLATE_PATH,
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

export { TEMPLATE_PATH };
