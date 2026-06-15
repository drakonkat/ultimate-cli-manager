import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadTemplate, upsertMCP, removeMCP } from '../utils/templateManager';
import { propagateToCLIs, detectConflicts, readCLIConfig } from '../utils/propagator';
import { MCP_CONFIG_PATHS } from '../utils/cliPaths';

const EMPTY_FORM = {
  name: '',
  type: 'local',
  command: '',
  url: '',
  envText: '',
  enabled: true,
};

function parseCommand(cmd) {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

function serializeCommand(arr) {
  return Array.isArray(arr) ? arr.join(' ') : '';
}

function parseEnv(text) {
  const env = {};
  text.split('\n').forEach((line) => {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) env[k.trim()] = rest.join('=').trim();
  });
  return env;
}

function serializeEnv(env) {
  if (!env) return '';
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}

// CLI che supportano MCP come sorgente di import
const IMPORTABLE_CLIS_MCP = ['claude', 'junie', 'cline'];

function TabMCP({ selectedCLIs }) {
  const [template, setTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingName, setEditingName] = useState(null);
  const [propagating, setPropagating] = useState(false);
  const [propagationResults, setPropagationResults] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [readResults, setReadResults] = useState(null);
  const [importSourceCli, setImportSourceCli] = useState('claude');

  useEffect(() => {
    loadTemplate().then(setTemplate);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    const config =
      form.type === 'remote'
        ? {
            type: 'remote',
            url: form.url.trim(),
            enabled: form.enabled,
          }
        : {
            type: 'local',
            command: parseCommand(form.command),
            env: parseEnv(form.envText),
            enabled: form.enabled,
          };

    const updated = await upsertMCP(template, form.name.trim(), config);
    setTemplate(updated);
    setForm(EMPTY_FORM);
    setEditingName(null);
  };

  const handleEdit = (name) => {
    const server = template.mcp[name];
    setForm({
      name,
      type: server.type || 'local',
      command: serializeCommand(server.command),
      url: server.url || '',
      envText: serializeEnv(server.env),
      enabled: server.enabled !== false,
    });
    setEditingName(name);
  };

  const handleDelete = async (name) => {
    if (!confirm(`Delete MCP "${name}" from template?`)) return;
    const updated = await removeMCP(template, name);
    setTemplate(updated);
  };

  const handlePropagate = async () => {
    if (selectedCLIs.length === 0) {
      alert('Select at least one CLI in the sidebar');
      return;
    }
    if (Object.keys(template.mcp).length === 0) {
      alert('MCP template is empty. Add at least one server.');
      return;
    }

    setPropagating(true);
    setPropagationResults(null);

    const conflicts = await detectConflicts(selectedCLIs);

    if (conflicts.length > 0) {
      setConflictDialog({ conflicts, pending: true });
      setPropagating(false);
      return;
    }

    const results = await propagateToCLIs(selectedCLIs, template.mcp, {});
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleConflictResolve = async (resolutions) => {
    setConflictDialog(null);
    setPropagating(true);
    const results = await propagateToCLIs(selectedCLIs, template.mcp, resolutions);
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleReadAll = async () => {
    const results = {};
    for (const cliId of selectedCLIs) {
      if (!MCP_CONFIG_PATHS[cliId]) {
        results[cliId] = { exists: false, reason: 'CLI does not support MCP' };
        continue;
      }
      const config = await readCLIConfig(cliId);
      results[cliId] = {
        exists: config !== null,
        path: MCP_CONFIG_PATHS[cliId],
        config,
      };
    }
    setReadResults(results);
  };

  const handleImportFromCLI = async () => {
    const cliId = importSourceCli;
    const path = MCP_CONFIG_PATHS[cliId];
    if (!path) {
      alert('CLI does not support MCP');
      return;
    }
    try {
      const content = await invoke('read_file', { path });
      const config = JSON.parse(content);
      const mcpServers = config.mcpServers || {};
      if (Object.keys(mcpServers).length === 0) {
        alert('No MCP server found in ' + path);
        return;
      }
      let updated = { ...template };
      let imported = 0;
      for (const [name, server] of Object.entries(mcpServers)) {
        const isRemote = !!(server.url || (server.command && String(server.command).startsWith('http')));
        const serverConfig = isRemote
          ? {
              type: 'remote',
              url: server.url || '',
              enabled: server.enabled !== false,
            }
          : {
              type: 'local',
              command: server.args
                ? [server.command, ...server.args]
                : server.command || '',
              env: server.env || {},
              enabled: server.enabled !== false,
            };
        updated = await upsertMCP(updated, name, serverConfig);
        imported++;
      }
      setTemplate(updated);
      alert(`Imported ${imported} MCP server(s) from ${cliId}`);
    } catch (e) {
      alert('Import error: ' + e);
    }
  };

  if (!template) return <div className="tab-panel"><p>Loading template...</p></div>;

  const mcpEntries = Object.entries(template.mcp || {});

  return (
    <div className="tab-panel">
      <h3>🔌 MCP Management</h3>
      <p>
        Template: {mcpEntries.length} server(s) | Selected CLIs: {selectedCLIs.length}
      </p>

      <form onSubmit={handleSubmit} className="mcp-form">
        <h4>{editingName ? `Edit: ${editingName}` : 'New MCP Server'}</h4>
        <div className="form-row">
          <label>
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. github"
              disabled={!!editingName}
              required
            />
          </label>
          <label>
            Type
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="local">Local (STDIO)</option>
              <option value="remote">Remote (HTTP)</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        {form.type === 'local' ? (
          <>
            <label>
              Command
              <input
                type="text"
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
                placeholder="npx -y @modelcontextprotocol/server-everything"
              />
            </label>
            <label>
              Environment (KEY=value, one per line)
              <textarea
                value={form.envText}
                onChange={(e) => setForm({ ...form, envText: e.target.value })}
                placeholder="API_KEY=xxx"
                rows={3}
              />
            </label>
          </>
        ) : (
          <label>
            URL
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://mcp.example.com/mcp"
            />
          </label>
        )}

        <div className="form-actions">
          <button type="submit" className="btn-primary">
            {editingName ? 'Update' : 'Add'}
          </button>
          {editingName && (
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setEditingName(null);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <h4>Servers in template</h4>
      {mcpEntries.length === 0 ? (
        <p className="empty-state">No MCP servers. Add one above.</p>
      ) : (
        <ul className="mcp-list">
          {mcpEntries.map(([name, server]) => (
            <li key={name} className="mcp-item">
              <div className="mcp-info">
                <strong>{name}</strong>
                <span className={`mcp-type ${server.type || 'local'}`}>
                  {server.type || 'local'}
                </span>
                {!server.enabled && <span className="mcp-disabled">disabled</span>}
                <code className="mcp-cmd">
                  {server.type === 'remote'
                    ? server.url
                    : serializeCommand(server.command)}
                </code>
              </div>
              <div className="mcp-actions">
                <button onClick={() => handleEdit(name)}>✏️</button>
                <button onClick={() => handleDelete(name)}>🗑️</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="propagate-section">
        <button
          className="btn-propagate"
          onClick={handlePropagate}
          disabled={propagating || selectedCLIs.length === 0}
        >
          {propagating ? '⏳ Propagating...' : `🚀 Propagate to ${selectedCLIs.length} CLI(s)`}
        </button>
        <button
          className="btn-read"
          onClick={handleReadAll}
          disabled={selectedCLIs.length === 0}
        >
          📂 Read existing configs
        </button>
        <select
          value={importSourceCli}
          onChange={(e) => setImportSourceCli(e.target.value)}
          style={{ marginRight: '0.5rem' }}
        >
          {IMPORTABLE_CLIS_MCP.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <button
          className="btn-import"
          onClick={handleImportFromCLI}
        >
          📥 Import from {importSourceCli}
        </button>
      </div>

      {conflictDialog && (
        <div className="conflict-dialog">
          <h4>⚠️ Conflicts detected</h4>
          <p>These CLIs already have an existing config file:</p>
          <ul>
            {conflictDialog.conflicts.map((cliId) => (
              <li key={cliId}><strong>{cliId}</strong> — config already present</li>
            ))}
          </ul>
          <p>Overwrite existing configs?</p>
          <div className="conflict-actions">
            <button
              className="btn-overwrite-all"
              onClick={() => {
                const r = {};
                conflictDialog.conflicts.forEach((c) => (r[c] = true));
                handleConflictResolve(r);
              }}
            >
              Overwrite all
            </button>
            <button
              className="btn-keep-all"
              onClick={() => {
                const r = {};
                conflictDialog.conflicts.forEach((c) => (r[c] = false));
                handleConflictResolve(r);
              }}
            >
              Keep all
            </button>
            <button onClick={() => setConflictDialog(null)}>Cancel</button>
          </div>
        </div>
      )}

      {propagationResults && (
        <div className="propagation-results">
          <h4>Propagation result:</h4>
          <ul>
            {propagationResults.map((r) => (
              <li key={r.cliId} className={`result-${r.status}`}>
                <strong>{r.cliId}</strong>: {r.status}
                {r.path && ` → ${r.path}`}
                {r.reason && ` (${r.reason})`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {readResults && (
        <div className="read-results">
          <h4>Existing configs read:</h4>
          <ul>
            {Object.entries(readResults).map(([cliId, info]) => (
              <li key={cliId} className={info.exists ? 'exists' : 'missing'}>
                <strong>{cliId}</strong>: {info.exists ? '✓ Exists' : '✗ Does not exist'}
                {info.path && <code> ({info.path})</code>}
                {info.config && (
                  <pre>{JSON.stringify(info.config, null, 2)}</pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default TabMCP;
