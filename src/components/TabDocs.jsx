import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { detectAllCLIs, CLI_LIST } from '../utils/cliDetector';
import { installCLI } from '../utils/cliInstaller';

function TabDocs({ selectedCLIs }) {
  const [installStatus, setInstallStatus] = useState({});
  const [installing, setInstalling] = useState(null);
  const [output, setOutput] = useState('');

  const refreshStatus = async () => {
    const status = await detectAllCLIs();
    setInstallStatus(status);
  };

  const openDocs = async (url) => {
    try {
      await invoke('open_url_cmd', { url });
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  const handleInstall = async (cliId) => {
    setInstalling(cliId);
    setOutput(`Installazione ${cliId} in corso...`);
    try {
      const result = await installCLI(cliId);
      setOutput(result);
      await refreshStatus();
    } catch (e) {
      setOutput(`Errore: ${e}`);
    } finally {
      setInstalling(null);
    }
  };

  const filteredDocs = selectedCLIs.length > 0
    ? CLI_LIST.filter(doc => selectedCLIs.includes(doc.id))
    : CLI_LIST;

  return (
    <div className="tab-panel">
      <div className="docs-header">
        <h3>📚 Documentazione & Installazione</h3>
        <button onClick={refreshStatus} className="btn-refresh">↻ Rileva stato</button>
      </div>
      <p>CLI installate: {Object.values(installStatus).filter(Boolean).length} / 5</p>

      <div className="docs-grid">
        {filteredDocs.map((doc) => {
          const installed = installStatus[doc.id];
          const isInstalling = installing === doc.id;
          return (
            <div key={doc.id} className="doc-card-full">
              <div className="doc-header">
                <span className="doc-icon">{doc.icon}</span>
                <span className="doc-name">{doc.name}</span>
                <span
                  className={`status-dot ${installed === true ? 'installed' : installed === false ? 'not-installed' : 'unknown'}`}
                  title={installed === true ? 'Installata' : installed === false ? 'Non installata' : 'Verifica...'}
                />
              </div>
              <div className="doc-actions">
                <button
                  className="btn-docs"
                  onClick={() => openDocs(doc.url)}
                >
                  📖 Docs
                </button>
                {installed === false && (
                  <button
                    className="btn-install"
                    onClick={() => handleInstall(doc.id)}
                    disabled={isInstalling}
                  >
                    {isInstalling ? '⏳...' : '📥 Installa'}
                  </button>
                )}
                {installed === true && (
                  <span className="badge-installed">✓ Installata</span>
                )}
                {installed === undefined && (
                  <span className="badge-unknown">?</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {output && (
        <div className="install-output">
          <h4>Output installazione:</h4>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}

export default TabDocs;
