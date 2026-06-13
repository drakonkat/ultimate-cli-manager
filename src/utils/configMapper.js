/**
 * Mapping del template MCP al formato specifico di ogni CLI.
 *
 * Formato template (unificato):
 * {
 *   "my-server": {
 *     "type": "local" | "remote",
 *     "command": ["npx", "-y", "..."],   // per local
 *     "url": "https://...",                // per remote
 *     "args": [],                          // opzionale per local
 *     "env": { "KEY": "value" },
 *     "headers": { "Auth": "Bearer ..." }, // per remote
 *     "enabled": true
 *   }
 * }
 */

// Path dei file config su Windows (verificati per il tuo PC)
export const CLI_CONFIG_PATHS = {
  // Claude Code: MCP in ~/.claude.json (root home)
  claude: 'C:\\Users\\mauro\\.claude.json',
  // Junie CLI: ~/.junie/mcp/mcp.json (utente) oppure <project>/.junie/mcp/mcp.json
  junie: 'C:\\Users\\mauro\\.junie\\mcp\\mcp.json',
  // Cline CLI: ~/.cline/mcp.json (root, non in data/settings)
  cline: 'C:\\Users\\mauro\\.cline\\mcp.json',
  // Kilo CLI: ~/.config/kilo/kilo.jsonc
  kilo: 'C:\\Users\\mauro\\.config\\kilo\\kilo.jsonc',
  // OpenCode CLI: ~/.config/opencode/opencode.json
  opencode: 'C:\\Users\\mauro\\.config\\opencode\\opencode.json',
};

export const CLI_CONFIG_LABELS = {
  claude: '~/.claude.json',
  junie: '~/.junie/mcp/mcp.json',
  cline: '~/.cline/mcp.json',
  kilo: '~/.config/kilo/kilo.jsonc',
  opencode: '~/.config/opencode/opencode.json',
};

/**
 * Converte un MCP server dal formato template al formato Cline.
 * Cline usa: { mcpServers: { name: { command, args, env, disabled, autoApprove } } }
 */
function toCline(serverName, server) {
  const entry = { disabled: !server.enabled };
  if (server.type === 'remote') {
    entry.url = server.url;
    if (server.headers) entry.headers = server.headers;
  } else {
    entry.command = Array.isArray(server.command) ? server.command[0] : server.command;
    if (server.command && server.command.length > 1) {
      entry.args = server.command.slice(1);
    }
    if (server.env) entry.env = server.env;
  }
  return { mcpServers: { [serverName]: entry } };
}

/**
 * Converte al formato OpenCode/Kilo (identici).
 * Usa: { mcp: { name: { type, command, url, environment, headers, enabled } } }
 */
function toOpenCode(serverName, server) {
  const entry = {
    type: server.type || 'local',
    enabled: server.enabled !== false,
  };
  if (server.type === 'remote') {
    entry.url = server.url;
    if (server.headers) entry.headers = server.headers;
  } else {
    entry.command = server.command;
    if (server.env) entry.environment = server.env;
  }
  return { mcp: { [serverName]: entry } };
}

/**
 * Converte al formato Junie.
 * Junie usa: { mcpServers: { name: { command, args, env, url, headers, enabled } } }
 * (simile a Cline ma con campo enabled esplicito)
 */
function toJunie(serverName, server) {
  const entry = { enabled: server.enabled !== false };
  if (server.type === 'remote') {
    entry.url = server.url;
    if (server.headers) entry.headers = server.headers;
  } else {
    entry.command = Array.isArray(server.command) ? server.command[0] : server.command;
    if (server.command && server.command.length > 1) {
      entry.args = server.command.slice(1);
    }
    if (server.env) entry.env = server.env;
  }
  return { mcpServers: { [serverName]: entry } };
}

/**
 * Converte tutti gli MCP dal template al formato di una CLI.
 * Ritorna l'oggetto completo da scrivere sul file config.
 */
export function mapMCPsToCLI(cliId, mcpServers) {
  if (cliId === 'kilo' || cliId === 'opencode') {
    const mcp = {};
    for (const [name, server] of Object.entries(mcpServers)) {
      const converted = toOpenCode(name, server);
      Object.assign(mcp, converted.mcp);
    }
    return { mcp };
  }

  if (cliId === 'cline' || cliId === 'junie') {
    const mcpServers_out = {};
    const converter = cliId === 'cline' ? toCline : toJunie;
    for (const [name, server] of Object.entries(mcpServers)) {
      const converted = converter(name, server);
      Object.assign(mcpServers_out, converted.mcpServers);
    }
    return { mcpServers: mcpServers_out };
  }

  return {};
}
