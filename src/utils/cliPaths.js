/**
 * Path centralizzati per agents, skills, character per ogni CLI.
 *
 * SINGLE SOURCE OF TRUTH: tutti i path sono generati lato Rust
 * (vedi `get_cli_paths` in src-tauri/src/lib.rs). Questo modulo:
 *   1. espone `initCliPaths()` da chiamare al boot dell'app
 *   2. mantiene API invariata (AGENTS_PATHS, SKILLS_PATHS, ...) per non
 *      rompere i consumer (TabAgents, TabSkills, TabCharacter, propagator)
 *
 * Convenzioni:
 * - Claude Code: agents .md con frontmatter, skills/<name>/SKILL.md, CLAUDE.md
 * - OpenCode:    agents .md con frontmatter, skills/<name>/SKILL.md, opencode.json:instructions
 * - Kilo:        identico a OpenCode ma in ~/.config/kilo/
 * - Junie:       agents .md, skills/<name>/SKILL.md, guidelines.md
 * - Cline:       SOLO character (no agents, no skills standard esportabili)
 */

import { invoke } from '@tauri-apps/api/core';

// Costanti popolate da initCliPaths() al boot dell'app.
// API INVARIATA: i consumer esistenti continuano a leggere `AGENTS_PATHS[cliId]`,
// `Object.entries(AGENTS_PATHS)`, ecc.
export const AGENTS_PATHS = {};
export const SKILLS_PATHS = {};
export const CHARACTER_PATHS = {};
export const CHARACTER_JSON_PATHS = {};
export const MCP_CONFIG_PATHS = {};

// UCM_INSTRUCTIONS_FILE è un singolo path (non una mappa), ma cambia dopo init.
// Usiamo `let` + export: ES modules hanno live bindings, quindi chi importa
// vedrà il valore aggiornato quando viene riassegnato.
export let UCM_INSTRUCTIONS_FILE = '';
export let UCM_TEMPLATE_DIR = '';

let _initialized = false;
let _initPromise = null;

/**
 * Inizializza i path chiamando il backend Rust. Da chiamare UNA volta al boot
 * dell'app (in App.jsx, dentro useEffect) PRIMA di qualsiasi accesso alle
 * costanti.
 *
 * Idempotente: chiamate multiple ritornano la stessa promise.
 * Risolta con i dati grezzi ricevuti da Rust (per ispezione/debug).
 */
export function initCliPaths() {
  if (!_initPromise) {
    _initPromise = invoke('get_cli_paths').then((data) => {
      Object.assign(AGENTS_PATHS, data.agents || {});
      Object.assign(SKILLS_PATHS, data.skills || {});
      Object.assign(CHARACTER_PATHS, data.character || {});
      Object.assign(CHARACTER_JSON_PATHS, data.characterJson || {});
      Object.assign(MCP_CONFIG_PATHS, data.mcpConfig || {});
      UCM_INSTRUCTIONS_FILE = data.ucmInstructions || '';
      UCM_TEMPLATE_DIR = data.ucmTemplateDir || '';
      _initialized = true;
      return data;
    });
  }
  return _initPromise;
}

/** True dopo che initCliPaths() ha completato con successo. */
export function isCliPathsReady() {
  return _initialized;
}

/**
 * Ritorna il path per un singolo agent della CLI: <root>\<name>.md
 */
export function getAgentFilePath(cliId, agentName) {
  const root = AGENTS_PATHS[cliId];
  if (!root) return null;
  return `${root}\\${agentName}.md`;
}

/**
 * Ritorna il path per il SKILL.md di una skill: <root>\<name>\SKILL.md
 */
export function getSkillFilePath(cliId, skillName) {
  const root = SKILLS_PATHS[cliId];
  if (!root) return null;
  return `${root}\\${skillName}\\SKILL.md`;
}

/**
 * Verifica se la CLI supporta agents.
 */
export function supportsAgents(cliId) {
  return AGENTS_PATHS[cliId] !== null && AGENTS_PATHS[cliId] !== undefined;
}

/**
 * Verifica se la CLI supporta skills.
 */
export function supportsSkills(cliId) {
  return SKILLS_PATHS[cliId] !== null && SKILLS_PATHS[cliId] !== undefined;
}

/**
 * Verifica se la CLI supporta character.
 * Tutte e 5 supportano character in qualche forma.
 */
export function supportsCharacter(cliId) {
  return (
    (CHARACTER_PATHS[cliId] !== null && CHARACTER_PATHS[cliId] !== undefined)
    || CHARACTER_JSON_PATHS[cliId] !== undefined
  );
}
