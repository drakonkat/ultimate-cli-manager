import { useEffect, useState } from 'react';
import { detectAllCLIs, CLI_LIST } from '../utils/cliDetector';

function Sidebar({ selectedCLIs, onToggleCLI, onSelectAll, onDeselectAll }) {
  const [installStatus, setInstallStatus] = useState({});
  const [loading, setLoading] = useState(true);

  const refreshStatus = async () => {
    setLoading(true);
    const status = await detectAllCLIs();
    setInstallStatus(status);
    setLoading(false);
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>CLI Manager</h2>
        <div className="select-controls">
          <button onClick={onSelectAll} className="btn-small">All</button>
          <button onClick={onDeselectAll} className="btn-small">None</button>
          <button onClick={refreshStatus} className="btn-small" disabled={loading}>
            {loading ? '...' : '↻'}
          </button>
        </div>
      </div>
      <ul className="cli-list">
        {CLI_LIST.map((cli) => {
          const installed = installStatus[cli.id];
          return (
            <li key={cli.id} className="cli-item">
              <label>
                <input
                  type="checkbox"
                  checked={selectedCLIs.includes(cli.id)}
                  onChange={() => onToggleCLI(cli.id)}
                />
                <span className="cli-icon">{cli.icon}</span>
                <span className="cli-name">{cli.name}</span>
                <span
                  className={`status-dot ${installed === true ? 'installed' : installed === false ? 'not-installed' : 'unknown'}`}
                  title={installed === true ? 'Installata' : installed === false ? 'Non installata' : 'Verifica...'}
                />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="sidebar-footer">
        <span className="selection-count">
          {selectedCLIs.length} of {CLI_LIST.length} selected
        </span>
      </div>
    </aside>
  );
}

export default Sidebar;
