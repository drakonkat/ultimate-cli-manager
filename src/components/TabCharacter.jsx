import { useState, useEffect } from 'react';
import { loadTemplate, setCharacter } from '../utils/templateManager';
import {
  propagateCharacterToCLIs,
  detectCharacterConflicts,
} from '../utils/propagator';
import {
  CHARACTER_PATHS,
  CHARACTER_JSON_PATHS,
  supportsCharacter,
} from '../utils/cliPaths';

const STARTER_TEMPLATE = `# Global Instructions / Character

Write here the instructions you want to apply to all selected CLIs.
You can use free-form markdown.

Example:
- Friendly tone of voice
- Always respond in English
- Prefer simple solutions
- Always use TypeScript strict mode
`;

// Tutte le CLI che supportano character
function getAllCharacterCLIs() {
  return Object.entries(CHARACTER_PATHS)
    .filter(([_, path]) => path != null)
    .map(([id, _]) => id);
}

function TabCharacter() {
  const [template, setTemplate] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [dirty, setDirty] = useState(false);
  const [propagating, setPropagating] = useState(false);
  const [conflictDialog, setConflictDialog] = useState(null);
  const [propagationResults, setPropagationResults] = useState(null);

  useEffect(() => {
    loadTemplate().then((t) => {
      setTemplate(t);
      setInstructions(t.character?.instructions || '');
    });
  }, []);

  const handleSave = async () => {
    if (!template) return;
    const updated = await setCharacter(template, instructions);
    setTemplate(updated);
    setDirty(false);
  };

  const handlePropagate = async () => {
    const allCharCLIs = getAllCharacterCLIs();
    if (allCharCLIs.length === 0) {
      alert('No CLI supports character');
      return;
    }
    if (dirty) {
      const ok = confirm('There are unsaved changes. Save before propagating?');
      if (ok) await handleSave();
    }

    setPropagating(true);
    setPropagationResults(null);

    const conflicts = await detectCharacterConflicts(allCharCLIs);
    if (conflicts.length > 0) {
      setConflictDialog({ conflicts });
      setPropagating(false);
      return;
    }

    const results = await propagateCharacterToCLIs(allCharCLIs, instructions, {});
    setPropagationResults(results);
    setPropagating(false);
  };

  const handleConflictResolve = async (resolutions) => {
    setConflictDialog(null);
    setPropagating(true);
    const allCharCLIs = getAllCharacterCLIs();
    const results = await propagateCharacterToCLIs(allCharCLIs, instructions, resolutions);
    setPropagationResults(results);
    setPropagating(false);
  };

  if (!template) return <div className="tab-panel"><p>Loading template...</p></div>;

  const charLen = instructions.length;
  const allCharCLIs = getAllCharacterCLIs();

  return (
    <div className="tab-panel">
      <h3>💬 Character / Instructions</h3>
      <p>
        Global instructions (character) will be applied to {allCharCLIs.length} CLIs that support them.
      </p>

      <div className="char-form">
        <label>
          Global instructions (free-form markdown)
          <textarea
            className="char-textarea"
            value={instructions}
            onChange={(e) => {
              setInstructions(e.target.value);
              setDirty(true);
            }}
            placeholder={STARTER_TEMPLATE}
            rows={14}
          />
        </label>
        <div className="char-stats">
          {charLen} chars {dirty && <span className="char-dirty">• unsaved</span>}
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={!dirty}
          >
            💾 Save to template
          </button>
          <button
            type="button"
            className="btn-propagate"
            onClick={handlePropagate}
            disabled={propagating}
          >
            {propagating ? '⏳ Propagating...' : `🚀 Propagate to ${allCharCLIs.length} CLI(s)`}
          </button>
        </div>
      </div>

      <div className="char-targets">
        <h4>CLI Destinations</h4>
        <ul className="char-targets-list">
          <li>
            <strong>Claude</strong>: <code>{CHARACTER_PATHS.claude}</code>
          </li>
          <li>
            <strong>OpenCode</strong>: <code>instructions</code> field in <code>{CHARACTER_JSON_PATHS.opencode}</code> + file{' '}
            <code>~/.ucm/instructions.md</code>
          </li>
          <li>
            <strong>Kilo</strong>: <code>instructions</code> field in <code>{CHARACTER_JSON_PATHS.kilo}</code> + file{' '}
            <code>~/.ucm/instructions.md</code>
          </li>
          <li>
            <strong>Junie</strong>: <code>{CHARACTER_PATHS.junie}</code>
          </li>
          <li>
            <strong>Cline</strong>: <code>{CHARACTER_PATHS.cline}</code> <em>(fallback, Cline has no global standard path)</em>
          </li>
        </ul>
      </div>

      {conflictDialog && (
        <div className="conflict-dialog">
          <h4>⚠️ Conflicts detected</h4>
          <p>These CLIs already have an existing character file:</p>
          <ul>
            {conflictDialog.conflicts.map((cliId) => (
              <li key={cliId}><strong>{cliId}</strong> — file already present</li>
            ))}
          </ul>
          <p>Overwrite?</p>
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
          <h4>Character propagation result:</h4>
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
    </div>
  );
}

export default TabCharacter;
