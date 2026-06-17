import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadTemplate, upsertSkill, removeSkill } from '../utils/templateManager';
import {
  propagateSkillsToCLIs,
  detectSkillConflicts,
} from '../utils/propagator';
import { SKILLS_PATHS, supportsSkills } from '../utils/cliPaths';

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

// CLI che supportano skills come sorgente di import
const IMPORTABLE_CLIS_SKILLS = ['claude', 'opencode', 'kilo', 'junie'];

// Tutte le CLI che supportano skills
function getAllSkillCLIs() {
  return Object.entries(SKILLS_PATHS)
    .filter(([_, path]) => path != null)
    .map(([id, _]) => id);
}

function TabSkills() {
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
    const updated = await upsertSkill(template, name, {
      description: form.description.trim(),
      content: form.content,
    });
    setTemplate(updated);
    setForm(EMPTY_FORM);
    setEditingName(null);
  };

  const handleEdit = (name) => {
    const s = template.skills[name];
    setForm({
      name,
      description: s.description || '',
      content: s.content || '',
    });
    setEditingName(name);
  };

  const handleDelete = async (name) => {
    if (!confirm(`Delete skill "${name}" from template?`)) return;
    const updated = await removeSkill(template, name);
    setTemplate(updated);
  };

  const handlePropagate = async () => {
    const allSkillCLIs = getAllSkillCLIs();
    if (allSkillCLIs.length === 0) {
      alert('No CLI supports skills');
      return;
    }
    if (Object.keys(template.skills || {}).length === 0) {
      alert('Skills template is empty. Add one above.');
      return;
    }

    setPropagating(true);
    setPropagationResults(null);
    const conflicts = await detectSkillConflicts(allSkillCLIs, template.skills);
    if (Object.keys(conflicts).length > 0) {
      setConflictDialog({ conflicts });
      setPropagating(false);
      return;
    }

    const results = await propagateSkillsToCLIs(allSkillCLIs, template.skills, {});
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleConflictResolve = async (resolutions) => {
    setConflictDialog(null);
    setPropagating(true);
    const allSkillCLIs = getAllSkillCLIs();
    const results = await propagateSkillsToCLIs(allSkillCLIs, template.skills, resolutions);
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleImportFromCLI = async () => {
    const cliId = importSourceCli;
    const root = SKILLS_PATHS[cliId];
    if (!root) {
      alert('CLI does not support skills');
      return;
    }
    try {
      const subdirs = await invoke('list_dir', { path: root });
      if (subdirs.length === 0) {
        alert('No skills found in ' + root);
        return;
      }
      let updated = { ...template };
      let imported = 0;
      let skipped = 0;
      for (const subdir of subdirs) {
        const skillPath = `${root}\\${subdir}\\SKILL.md`;
        try {
          const content = await invoke('read_file', { path: skillPath });
          const parsed = parseFrontmatter(content);
          if (!parsed) {
            skipped++;
            continue;
          }
          updated = await upsertSkill(updated, parsed.name, {
            description: parsed.description,
            content: content,
          });
          imported++;
        } catch {
          skipped++;
        }
      }
      setTemplate(updated);
      alert(`Imported ${imported} skill(s) from ${cliId}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
    } catch (e) {
      alert('Import error: ' + e);
    }
  };

  if (!template) return <div className="tab-panel"><p>Loading template...</p></div>;

  const skills = Object.entries(template.skills || {});
  const allSkillCLIs = getAllSkillCLIs();

  return (
    <div className="tab-panel">
      <h3>🛠️ Skills Management</h3>
      <p>
        Template: {skills.length} skill(s) | Target CLIs: {allSkillCLIs.length}
        {!allSkillCLIs.includes('cline') && (
          <span className="hint"> (Cline does not support skills)</span>
        )}
      </p>

      <form onSubmit={handleSubmit} className="skill-form">
        <h4>{editingName ? `Edit: ${editingName}` : 'New Skill'}</h4>
        <div className="form-row">
          <label>
            Name (kebab-case)
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. git-release"
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
            placeholder="e.g. Create consistent releases and changelogs"
          />
        </label>
        <label>
          SKILL.md Content (YAML frontmatter + markdown body)
          <textarea
            className="skill-content"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder={`---\nname: git-release\ndescription: Create consistent releases\nlicense: MIT\n---\n\n## What I do\n- Draft release notes from merged PRs\n- Propose a version bump\n- Provide a copy-pasteable gh release create command\n\n## When to use me\nUse this when you are preparing a tagged release.`}
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

      <h4>Skills in template</h4>
      {skills.length === 0 ? (
        <p className="empty-state">No skills. Add one above.</p>
      ) : (
        <ul className="skill-list">
          {skills.map(([name, skill]) => (
            <li key={name} className="skill-item">
              <div className="skill-info">
                <strong>{name}</strong>
                {skill.description && <span className="skill-desc">{skill.description}</span>}
                <code className="skill-len">
                  {skill.content?.length || 0} chars
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
          disabled={propagating || skills.length === 0}
        >
          {propagating ? '⏳ Propagating...' : `🚀 Propagate to ${allSkillCLIs.length} CLI(s)`}
        </button>
        <select
          value={importSourceCli}
          onChange={(e) => setImportSourceCli(e.target.value)}
          style={{ marginRight: '0.5rem' }}
        >
          {IMPORTABLE_CLIS_SKILLS.map((id) => (
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
          {Object.entries(SKILLS_PATHS).map(([cliId, path]) => (
            <li key={cliId}>
              <strong>{cliId}</strong>: {path ? <code>{path + '\\<name>\\SKILL.md'}</code> : <em>not supported</em>}
            </li>
          ))}
        </ul>
      </div>

      {conflictDialog && (
        <div className="conflict-dialog">
          <h4>⚠️ Conflicts detected</h4>
          <p>These skills already exist:</p>
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
          <h4>Skills propagation result:</h4>
          <ul>
            {propagationResults.map((r) => (
              <li key={r.cliId} className={`result-${r.status}`}>
                <strong>{r.cliId}</strong>: {r.status}
                {r.reason && ` (${r.reason})`}
                {r.details && (
                  <ul className="result-details">
                    {r.details.map((d, i) => (
                      <li key={i} className={`detail-${d.status}`}>
                        {d.skill || d.agent}: {d.status}
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

export default TabSkills;
