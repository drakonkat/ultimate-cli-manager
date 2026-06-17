import { CLI_LIST } from '../utils/cliDetector';

/**
 * Header a tab per la finestra "terminal". Ogni tab rappresenta una
 * sessione PTY attiva (CLI + path). Mostra:
 *   - pallino stato (running / starting / idle / error)
 *   - icona CLI + nome abbreviato
 *   - path abbreviato
 *   - × button to close the tab
 *
 * Plus a "+ Add tab" button on the right to open a new session.
 *
 * Props:
 *   - tabs:        Array<{ sessionId, cliId, name, path, status }>
 *   - activeId:    string | null
 *   - onSelect:    (sessionId) => void
 *   - onClose:     (sessionId) => void
 *   - onAdd:       () => void
 */
function TerminalTabBar({ tabs, activeId, onSelect, onClose, onAdd }) {
  // Mappa id → entry completa di CLI_LIST per icona e nome.
  const cliById = Object.fromEntries(CLI_LIST.map((c) => [c.id, c]));

  return (
    <div className="terminal-tab-bar">
      {tabs.map((tab) => {
        const cli = cliById[tab.cliId];
        const isActive = tab.sessionId === activeId;
        return (
          <div
            key={tab.sessionId}
            className={`terminal-tab ${isActive ? 'active' : ''}`}
            onClick={() => onSelect(tab.sessionId)}
            title={`${tab.cliId} in ${tab.path}`}
          >
            {/* Pallino stato: riusa la classe .status-dot esistente,
                aggiunge la variante specifica per il tab. */}
            <span
              className={`status-dot ${tab.status}`}
              title={tab.status}
            />
            <span style={{ fontSize: '0.9rem' }}>{cli?.icon || '💻'}</span>
            <span style={{ fontWeight: 500 }}>{cli?.name || tab.cliId}</span>
            <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>
              {shortenPath(tab.path)}
            </span>
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.sessionId);
              }}
              title="Close tab"
            >
              ×
            </span>
          </div>
        );
      })}
      <button
        type="button"
        className="terminal-add-btn"
        onClick={onAdd}
        title="Open a new terminal session"
      >
        + Add tab
      </button>
    </div>
  );
}

/**
 * Tronca un path per la visualizzazione nella tab: mostra solo le
 * ultime 2 cartelle + l'ultimo segmento, prefisso con `…/`.
 * Es. `\projects\my-app` → `…/projects/my-app`
 */
function shortenPath(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

export default TerminalTabBar;
