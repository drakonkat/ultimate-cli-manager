import { useState, useEffect } from 'react';
import { loadTemplate, upsertMCP, removeMCP } from '../utils/templateManager';
import { propagateToCLIs, detectConflicts, readCLIConfig } from '../utils/propagator';
import { CLI_CONFIG_PATHS } from '../utils/configMapper';

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

function TabMCP({ selectedCLIs }) {
  const [template, setTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingName, setEditingName] = useState(null);
  const [propagating, setPropagating] = useState(false);
  const [propagationResults, setPropagationResults] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [readResults, setReadResults] = useState(null);

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
    if (!confirm(`Eliminare MCP "${name}" dal template?`)) return;
    const updated = await removeMCP(template, name);
    setTemplate(updated);
  };

  const handlePropagate = async () => {
    if (selectedCLIs.length === 0) {
      alert('Seleziona almeno una CLI nella sidebar');
      return;
    }
    if (Object.keys(template.mcp).length === 0) {
      alert('Template MCP vuoto. Aggiungi almeno un server.');
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
      if (!CLI_CONFIG_PATHS[cliId]) {
        results[cliId] = { exists: false, reason: 'CLI non supporta MCP' };
        continue;
      }
      const config = await readCLIConfig(cliId);
      results[cliId] = {
        exists: config !== null,
        path: CLI_CONFIG_PATHS[cliId],
        config,
      };
    }
    setReadResults(results);
  };

  if (!template) return <div className="tab-panel"><p>Caricamento template...</p></div>;

  const mcpEntries = Object.entries(template.mcp || {});

  return (
    <div className="tab-panel">
      <h3>🔌 Gestione MCP</h3>
      <p>
        Template: {mcpEntries.length} server | CLI selezionate: {selectedCLIs.length}
      </p>

      <form onSubmit={handleSubmit} className="mcp-form">
        <h4>{editingName ? `Modifica: ${editingName}` : 'Nuovo MCP Server'}</h4>
        <div className="form-row">
          <label>
            Nome
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="es. github"
              disabled={!!editingName}
              required
            />
          </label>
          <label>
            Tipo
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
            Abilitato
          </label>
        </div>

        {form.type === 'local' ? (
          <>
            <label>
              Comando
              <input
                type="text"
                value={form.command}
                onChange={(e) => setForm({ ...form, command: e.target.value })}
                placeholder="npx -y @modelcontextprotocol/server-everything"
              />
            </label>
            <label>
              Environment (KEY=value, una per riga)
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
            {editingName ? 'Aggiorna' : 'Aggiungi'}
          </button>
          {editingName && (
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setEditingName(null);
              }}
            >
              Annulla
            </button>
          )}
        </div>
      </form>

      <h4>Server nel template</h4>
      {mcpEntries.length === 0 ? (
        <p className="empty-state">Nessun server MCP. Aggiungine uno sopra.</p>
      ) : (
        <ul className="mcp-list">
          {mcpEntries.map(([name, server]) => (
            <li key={name} className="mcp-item">
              <div className="mcp-info">
                <strong>{name}</strong>
                <span className={`mcp-type ${server.type || 'local'}`}>
                  {server.type || 'local'}
                </span>
                {!server.enabled && <span className="mcp-disabled">disabilitato</span>}
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
          {propagating ? '⏳ Propagazione...' : `🚀 Propaga a ${selectedCLIs.length} CLI`}
        </button>
        <button
          className="btn-read"
          onClick={handleReadAll}
          disabled={selectedCLIs.length === 0}
        >
          📂 Leggi config esistenti
        </button>
      </div>

      {conflictDialog && (
        <div className="conflict-dialog">
          <h4>⚠️ Conflitti rilevati</h4>
          <p>Queste CLI hanno già un file config esistente:</p>
          <ul>
            {conflictDialog.conflicts.map((cliId) => (
              <li key={cliId}><strong>{cliId}</strong> — config già presente</li>
            ))}
          </ul>
          <p>Sovrascrivere le config esistenti?</p>
          <div className="conflict-actions">
            <button
              className="btn-overwrite-all"
              onClick={() => {
                const r = {};
                conflictDialog.conflicts.forEach((c) => (r[c] = true));
                handleConflictResolve(r);
              }}
            >
              Sovrascrivi tutte
            </button>
            <button
              className="btn-keep-all"
              onClick={() => {
                const r = {};
                conflictDialog.conflicts.forEach((c) => (r[c] = false));
                handleConflictResolve(r);
              }}
            >
              Mantieni tutte
            </button>
            <button onClick={() => setConflictDialog(null)}>Annulla</button>
          </div>
        </div>
      )}

      {propagationResults && (
        <div className="propagation-results">
          <h4>Risultato propagazione:</h4>
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
          <h4>Config esistenti lette:</h4>
          <ul>
            {Object.entries(readResults).map(([cliId, info]) => (
              <li key={cliId} className={info.exists ? 'exists' : 'missing'}>
                <strong>{cliId}</strong>: {info.exists ? '✓ Esiste' : '✗ Non esiste'}
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
