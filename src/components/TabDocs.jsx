import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { detectAllCLIs, CLI_LIST } from '../utils/cliDetector';
import { installCLI } from '../utils/cliInstaller';

function TabDocs() {
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
    setOutput(`Installing ${cliId} in progress...`);
    try {
      const result = await installCLI(cliId);
      setOutput(result);
      await refreshStatus();
    } catch (e) {
      setOutput(`Error: ${e}`);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="tab-panel">
      <div className="docs-header">
        <h3>📚 Documentation & Installation</h3>
        <button onClick={refreshStatus} className="btn-refresh">↻ Detect status</button>
      </div>
      <p>CLIs installed: {Object.values(installStatus).filter(Boolean).length} / 5</p>

      <div className="docs-grid">
        {CLI_LIST.map((doc) => {
          const installed = installStatus[doc.id];
          const isInstalling = installing === doc.id;
          return (
            <div key={doc.id} className="doc-card-full">
              <div className="doc-header">
                <span className="doc-icon">{doc.icon}</span>
                <span className="doc-name">{doc.name}</span>
                <span
                  className={`status-dot ${installed === true ? 'installed' : installed === false ? 'not-installed' : 'unknown'}`}
                  title={installed === true ? 'Installed' : installed === false ? 'Not installed' : 'Checking...'}
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
                    {isInstalling ? '⏳...' : '📥 Install'}
                  </button>
                )}
                {installed === true && (
                  <span className="badge-installed">✓ Installed</span>
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
          <h4>Installation output:</h4>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}

export default TabDocs;
