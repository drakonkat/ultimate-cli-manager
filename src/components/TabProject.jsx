import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { loadTemplate, upsertProject, removeProject } from '../utils/templateManager';
import { CLI_LIST, detectAllCLIs } from '../utils/cliDetector';
import { EDITOR_LIST, detectAllEditors } from '../utils/editorDetector';

/**
 * Tab "Project" — permette di registrare cartelle di progetto e di
 * lanciare, per ciascuna, una CLI installata in una nuova finestra
 * PowerShell persistente.
 *
 * Persistenza: campo `projects: []` in `~/.ucm/template.json`
 * (vedi `templateManager.upsertProject` / `removeProject`).
 *
 * Per avviare la CLI delega al comando Rust `run_cli` (vedi
 * `src-tauri/src/lib.rs`), che apre PowerShell con
 * `-NoExit -Command "cd '<path>'; <cli>"`.
 */
function TabProject() {
  const [template, setTemplate] = useState(null);
  const [formName, setFormName] = useState('');
  const [formPath, setFormPath] = useState('');
  const [browseError, setBrowseError] = useState(null);
  const [installedCLIs, setInstalledCLIs] = useState({});
  const [installedEditors, setInstalledEditors] = useState({});

  // Carica template + detection delle CLI installate al mount.
  useEffect(() => {
    loadTemplate().then((t) => {
      // Migrazione difensiva: assicurati che `projects` esista
      // (template scritti da versioni precedenti non ce l'hanno).
      if (!t.projects) {
        t.projects = [];
      }
      setTemplate(t);
    });
    detectAllCLIs().then(setInstalledCLIs);
    detectAllEditors().then(setInstalledEditors);
  }, []);

  // Mappa id CLI → CLI object (per icona e label).
  const cliById = Object.fromEntries(CLI_LIST.map((c) => [c.id, c]));

  // CLI effettivamente "avviabili" = tutte quelle installate (nessun filtro sidebar)
  const availableCLIs = CLI_LIST.filter(
    (cli) => installedCLIs[cli.id] === true
  );

  // Mappa id editor → editor object (per icona e label).
  const editorById = Object.fromEntries(EDITOR_LIST.map((e) => [e.id, e]));

  // Editor "apribili" = installati sulla macchina (non c'è sidebar
  // per gli editor, quindi basta il filtro di detection).
  const availableEditors = EDITOR_LIST.filter(
    (e) => installedEditors[e.id] === true
  );

  const handleBrowse = async () => {
    setBrowseError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === 'string' && selected.length > 0) {
        setFormPath(selected);
        if (!formName) {
          // Precompila il name con l'ultima cartella del path.
          const parts = selected.split(/[\\/]/).filter(Boolean);
          setFormName(parts[parts.length - 1] || '');
        }
      }
    } catch (e) {
      setBrowseError(String(e));
    }
  };

  const handleAdd = async () => {
    if (!formName.trim() || !formPath.trim()) {
      alert('Name e path sono obbligatori.');
      return;
    }
    try {
      const exists = await invoke('path_exists', { path: formPath });
      if (!exists) {
        alert(`Il path non esiste: ${formPath}`);
        return;
      }
      const project = {
        id: crypto.randomUUID(),
        name: formName.trim(),
        path: formPath.trim(),
      };
      const updated = await upsertProject(template, project);
      setTemplate(updated);
      setFormName('');
      setFormPath('');
    } catch (e) {
      alert(`Errore salvataggio progetto: ${e}`);
    }
  };

  const handleRemove = async (projectId) => {
    if (!window.confirm('Rimuovere questo progetto?')) return;
    try {
      const updated = await removeProject(template, projectId);
      setTemplate(updated);
    } catch (e) {
      alert(`Errore rimozione progetto: ${e}`);
    }
  };

  const handlePlay = async (cliId, projectPath) => {
    try {
      await invoke('run_cli', { cliId, projectPath });
    } catch (e) {
      alert(`Impossibile avviare la CLI: ${e}`);
    }
  };

  const handleOpenInEditor = async (editorId, projectPath) => {
    try {
      await invoke('open_in_editor', { editorId, projectPath });
    } catch (e) {
      alert(`Impossibile aprire l'editor: ${e}`);
    }
  };

  /**
   * Apre (o mette a fuoco) la finestra Tauri "terminal" per la coppia
   * (progetto, CLI) data. Ogni combinazione (projectId, cliId) ha la
   * SUA finestra dedicata con label `terminal-<projectId>-<cliId>`:
   *   - Click ripetuto sulla stessa coppia → focus + add tab.
   *   - Click su un progetto diverso o una CLI diversa → nuova finestra.
   *
   * La finestra monta `TerminalWindow` (vedi `src/main.jsx` che fa il
   * branching su `getCurrentWebviewWindow().label.startsWith('terminal-')`).
   * I parametri `cli` e `path` passano via URL query string.
   */
  const openInIntegratedTerminal = async (cliId, projectPath, projectId, projectName) => {
    try {
      const windowLabel = `terminal-${projectId}-${cliId}`;
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await existing.setFocus();
        // Notifica la finestra già aperta di aggiungere una nuova tab.
        // `TerminalWindow` ascolta questo evento al mount.
        await existing.emit('terminal:add-tab', {
          cliId,
          projectPath,
        });
        return;
      }
      // Crea la nuova finestra. Stesso bundle, `main.jsx` instrada
      // su `TerminalWindow` quando il label inizia con `terminal-`.
      const cliObj = cliById[cliId];
      const win = new WebviewWindow(windowLabel, {
        url: `/?cli=${encodeURIComponent(cliId)}&path=${encodeURIComponent(projectPath)}`,
        title: `${cliObj?.icon || ''} ${cliObj?.name || cliId} — ${projectName} [beta]`,
        width: 1100,
        height: 700,
        minWidth: 600,
        minHeight: 400,
      });
      win.once('tauri://error', (e) => {
        alert(`Cannot open terminal window: ${e.payload}`);
      });
    } catch (e) {
      alert(`Impossibile aprire il terminale integrato: ${e}`);
    }
  };

  if (!template) {
    return (
      <div className="tab-panel">
        <p>Loading template…</p>
      </div>
    );
  }

  const projects = template.projects || [];

  return (
    <div className="tab-panel">
      <h3>📁 Projects</h3>
      <p>Register a project folder, then launch any installed CLI directly inside it.</p>

      {/* Form "Add project" */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxWidth: '600px',
        }}
      >
        <label>
          Name
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="my-project"
          />
        </label>
        <label>
          Path
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              value={formPath}
              onChange={(e) => setFormPath(e.target.value)}
              placeholder="C:\Users\me\projects\my-project"
              style={{ flex: 1 }}
            />
            <button type="button" onClick={handleBrowse}>
              Browse…
            </button>
          </div>
          {browseError && (
            <small style={{ color: 'red' }}>{browseError}</small>
          )}
        </label>
        <div>
          <button type="submit">➕ Add project</button>
        </div>
      </form>

      {/* Lista progetti */}
      <h4>Existing projects ({projects.length})</h4>
      {projects.length === 0 ? (
        <p>
          <em>No projects registered yet.</em>
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {projects.map((p) => (
            <li
              key={p.id}
              style={{
                border: '1px solid var(--border, #444)',
                borderRadius: '6px',
                padding: '0.75rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong>{p.name}</strong>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.85em',
                      opacity: 0.8,
                    }}
                  >
                    {p.path}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(p.id)}
                  title="Remove project"
                >
                  🗑️
                </button>
              </div>

              {availableCLIs.length === 0 ? (
                <p style={{ marginTop: '0.5rem', opacity: 0.6 }}>
                  <em>
                    No installed CLI detected. Install one from the Docs tab.
                  </em>
                </p>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                    marginTop: '0.5rem',
                  }}
                >
                  {availableCLIs.map((cli) => (
                    <button
                      key={cli.id}
                      type="button"
                      onClick={() => handlePlay(cli.id, p.path)}
                      title={`Open PowerShell in ${p.path} and run ${cli.id}`}
                    >
                      ▶ {cli.icon} {cli.name || cli.id}
                    </button>
                  ))}
                </div>
              )}

              {/* Sezione "Open in editor" */}
              {availableEditors.length === 0 ? (
                <p
                  style={{
                    marginTop: '0.5rem',
                    opacity: 0.6,
                    fontSize: '0.85em',
                  }}
                >
                  <em>
                    No editor detected. Install VSCode, Cursor, or JetBrains
                    Toolbox to see this section.
                  </em>
                </p>
              ) : (
                <div style={{ marginTop: '0.5rem' }}>
                  <div
                    style={{
                      fontSize: '0.8em',
                      opacity: 0.7,
                      marginBottom: '0.25rem',
                    }}
                  >
                    Open in editor:
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                    }}
                  >
                    {availableEditors.map((ed) => (
                      <button
                        key={ed.id}
                        type="button"
                        onClick={() => handleOpenInEditor(ed.id, p.path)}
                        title={`Open ${p.path} in ${ed.name}`}
                      >
                        📂 {ed.icon} {ed.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sezione "Open in integrated terminal (beta)" — apre
                  una nuova finestra Tauri con tab xterm.js e PTY reale. */}
              {availableCLIs.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div
                    style={{
                      fontSize: '0.8em',
                      opacity: 0.7,
                      marginBottom: '0.25rem',
                    }}
                  >
                    Open in integrated terminal
                    <span className="beta-tag">[beta]</span>:
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                    }}
                  >
                    {availableCLIs.map((cli) => (
                      <button
                        key={cli.id}
                        type="button"
                        onClick={() => openInIntegratedTerminal(cli.id, p.path, p.id, p.name)}
                        title={`Open a new Tauri window (or focus the existing one) with a PTY running ${cli.id} in ${p.path}`}
                      >
                        🪟 {cli.icon} {cli.name || cli.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TabProject;
