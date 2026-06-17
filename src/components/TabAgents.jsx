import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadTemplate, upsertAgent, removeAgent } from '../utils/templateManager';
import {
  propagateAgentsToCLIs,
  detectAgentConflicts,
} from '../utils/propagator';
import { AGENTS_PATHS, supportsAgents } from '../utils/cliPaths';

/**
 * Parses YAML frontmatter from markdown content.
 * Returns { name, description, content } or null if no frontmatter.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const yamlStr = match[1];
  const result = { name: '', description: '', content };
  for (const line of yamlStr.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'name') result.name = val;
    if (key === 'description') result.description = val;
  }
  if (!result.name) return null;
  return result;
}

const EMPTY_FORM = { name: '', description: '', content: '' };

// CLI che supportano agents come sorgente di import
const IMPORTABLE_CLIS_AGENTS = ['claude', 'opencode', 'kilo', 'junie'];

// Tutte le CLI che supportano agents
function getAllAgentCLIs() {
  return Object.entries(AGENTS_PATHS)
    .filter(([_, path]) => path != null)
    .map(([id, _]) => id);
}

function TabAgents() {
  const [template, setTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingName, setEditingName] = useState(null);
  const [propagating, setPropagating] = useState(false);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [propagationResults, setPropagationResults] = useState(null);
  const [importSourceCli, setImportSourceCli] = useState('claude');

  useEffect(() => {
    loadTemplate().then(setTemplate);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
      if (!confirm(`"${name}" is not in kebab-case. Continue anyway?`)) return;
    }
    const updated = await upsertAgent(template, name, {
      description: form.description.trim(),
      content: form.content,
    });
    setTemplate(updated);
    setForm(EMPTY_FORM);
    setEditingName(null);
  };

  const handleEdit = (name) => {
    const a = template.agents[name];
    setForm({
      name,
      description: a.description || '',
      content: a.content || '',
    });
    setEditingName(name);
  };

  const handleDelete = async (name) => {
    if (!confirm(`Delete agent "${name}" from template?`)) return;
    const updated = await removeAgent(template, name);
    setTemplate(updated);
  };

  const handlePropagate = async () => {
    const allAgentCLIs = getAllAgentCLIs();
    if (allAgentCLIs.length === 0) {
      alert('No CLI supports agents');
      return;
    }
    if (Object.keys(template.agents || {}).length === 0) {
      alert('Agents template is empty. Add one above.');
      return;
    }

    setPropagating(true);
    setPropagationResults(null);
    const conflicts = await detectAgentConflicts(allAgentCLIs, template.agents);
    if (Object.keys(conflicts).length > 0) {
      setConflictDialog({ conflicts });
      setPropagating(false);
      return;
    }

    const results = await propagateAgentsToCLIs(allAgentCLIs, template.agents, {});
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleConflictResolve = async (resolutions) => {
    setConflictDialog(null);
    setPropagating(true);
    const allAgentCLIs = getAllAgentCLIs();
    const results = await propagateAgentsToCLIs(allAgentCLIs, template.agents, resolutions);
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleImportFromCLI = async () => {
    const cliId = importSourceCli;
    const root = AGENTS_PATHS[cliId];
    if (!root) {
      alert('CLI does not support agents');
      return;
    }
    try {
      const files = await invoke('list_dir', { path: root });
      const mdFiles = files.filter((f) => f.endsWith('.md'));
      if (mdFiles.length === 0) {
        alert('No .md files found in ' + root);
        return;
      }
      let updated = { ...template };
      let imported = 0;
      let skipped = 0;
      for (const file of mdFiles) {
        const filePath = `${root}\\${file}`;
        const content = await invoke('read_file', { path: filePath });
        const parsed = parseFrontmatter(content);
        if (!parsed) {
          skipped++;
          continue;
        }
        updated = await upsertAgent(updated, parsed.name, {
          description: parsed.description,
          content: content,
        });
        imported++;
      }
      setTemplate(updated);
      alert(`Imported ${imported} agent(s) from ${cliId}${skipped > 0 ? ` (${skipped} skipped, missing frontmatter)` : ''}`);
    } catch (e) {
      alert('Import error: ' + e);
    }
  };

  if (!template) return <div className="tab-panel"><p>Loading template...</p></div>;

  const agents = Object.entries(template.agents || {});
  const allAgentCLIs = getAllAgentCLIs();

  return (
    <div className="tab-panel">
      <h3>🤖 Agents Management</h3>
      <p>
        Template: {agents.length} agent(s) | Target CLIs: {allAgentCLIs.length}
        {!allAgentCLIs.includes('cline') && (
          <span className="hint"> (Cline does not support agents)</span>
        )}
      </p>

      <form onSubmit={handleSubmit} className="agent-form">
        <h4>{editingName ? `Edit: ${editingName}` : 'New Agent'}</h4>
        <div className="form-row">
          <label>
            Name (kebab-case)
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. code-reviewer"
              disabled={!!editingName}
              required
            />
          </label>
        </div>
        <label>
          Description (1 line)
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="e.g. Reviews PR for bugs and style"
          />
        </label>
        <label>
          Content (YAML frontmatter + markdown body)
          <textarea
            className="agent-content"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder={`---\nname: code-reviewer\ndescription: Reviews code...\ntools: Read, Grep, Glob\nmodel: claude-opus-4-5\n---\n\nYou are a senior code reviewer...`}
            rows={12}
          />
        </label>
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

      <h4>Agents in template</h4>
      {agents.length === 0 ? (
        <p className="empty-state">No agents. Add one above.</p>
      ) : (
        <ul className="agent-list">
          {agents.map(([name, agent]) => (
            <li key={name} className="agent-item">
              <div className="agent-info">
                <strong>{name}</strong>
                {agent.description && <span className="agent-desc">{agent.description}</span>}
                <code className="agent-len">
                  {agent.content?.length || 0} chars
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
          disabled={propagating || agents.length === 0}
        >
          {propagating ? '⏳ Propagating...' : `🚀 Propagate to ${allAgentCLIs.length} CLI(s)`}
        </button>
        <select
          value={importSourceCli}
          onChange={(e) => setImportSourceCli(e.target.value)}
          style={{ marginRight: '0.5rem' }}
        >
          {IMPORTABLE_CLIS_AGENTS.map((id) => (
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

      <div className="char-targets">
        <h4>CLI Destinations</h4>
        <ul className="char-targets-list">
          {Object.entries(AGENTS_PATHS).map(([cliId, path]) => (
            <li key={cliId}>
              <strong>{cliId}</strong>: {path ? <code>{path + '\\<name>.md'}</code> : <em>not supported</em>}
            </li>
          ))}
        </ul>
      </div>

      {conflictDialog && (
        <div className="conflict-dialog">
          <h4>⚠️ Conflicts detected</h4>
          <p>These agents already exist:</p>
          <ul>
            {Object.entries(conflictDialog.conflicts).map(([cliId, names]) => (
              <li key={cliId}>
                <strong>{cliId}</strong>: {names.join(', ')}
              </li>
            ))}
          </ul>
          <p>Overwrite existing files?</p>
          <div className="conflict-actions">
            <button
              className="btn-overwrite-all"
              onClick={() => {
                const r = {};
                Object.keys(conflictDialog.conflicts).forEach((c) => (r[c] = true));
                handleConflictResolve(r);
              }}
            >
              Overwrite all
            </button>
            <button
              className="btn-keep-all"
              onClick={() => {
                const r = {};
                Object.keys(conflictDialog.conflicts).forEach((c) => (r[c] = false));
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
          <h4>Agents propagation result:</h4>
          <ul>
            {propagationResults.map((r) => (
              <li key={r.cliId} className={`result-${r.status}`}>
                <strong>{r.cliId}</strong>: {r.status}
                {r.reason && ` (${r.reason})`}
                {r.details && (
                  <ul className="result-details">
                    {r.details.map((d, i) => (
                      <li key={i} className={`detail-${d.status}`}>
                        {d.agent || d.skill}: {d.status}
                        {d.path && ` → ${d.path}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default TabAgents;
