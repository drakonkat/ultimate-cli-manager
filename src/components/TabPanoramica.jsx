import { useState, useEffect } from 'react';
import { loadTemplate } from '../utils/templateManager';
import { detectAllCLIs, CLI_LIST } from '../utils/cliDetector';
import { TEMPLATE_PATH } from '../utils/templateManager';

function TabPanoramica({ selectedCLIs }) {
  const [template, setTemplate] = useState(null);
  const [installStatus, setInstallStatus] = useState({});

  useEffect(() => {
    loadTemplate().then(setTemplate);
    detectAllCLIs().then(setInstallStatus);
  }, []);

  if (!template) {
    return <div className="tab-panel"><p>Loading template...</p></div>;
  }

  const mcpCount = Object.keys(template.mcp || {}).length;
  const agentCount = Object.keys(template.agents || {}).length;
  const skillCount = Object.keys(template.skills || {}).length;
  const charLen = (template.character?.instructions || '').length;
  const installedCount = Object.values(installStatus).filter(Boolean).length;

  return (
    <div className="tab-panel">
      <h3>📊 Overview</h3>

      <div className="overview-grid">
        <div className="overview-card">
          <h4>🖥️ CLI</h4>
          <div className="big-number">{installedCount} / {CLI_LIST.length}</div>
          <p className="card-sub">installed</p>
          <ul className="overview-cli-list">
            {CLI_LIST.map((cli) => {
              const installed = installStatus[cli.id];
              const selected = selectedCLIs.includes(cli.id);
              return (
                <li key={cli.id} className={selected ? 'selected' : ''}>
                  <span>{cli.icon} {cli.name}</span>
                  <span className={`status-dot ${installed === true ? 'installed' : installed === false ? 'not-installed' : 'unknown'}`} />
                  {selected && <span className="sel-badge">selected</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="overview-card">
          <h4>📋 Template</h4>
          <div className="big-number">{mcpCount + agentCount + skillCount + (charLen > 0 ? 1 : 0)}</div>
          <p className="card-sub">entities configured</p>
          <ul className="overview-template-list">
            <li>
              <span>🔌 MCP server</span>
              <strong>{mcpCount}</strong>
            </li>
            <li>
              <span>🤖 Agent</span>
              <strong>{agentCount}</strong>
            </li>
            <li>
              <span>🛠️ Skill</span>
              <strong>{skillCount}</strong>
            </li>
            <li>
              <span>💬 Character</span>
              <strong>{charLen > 0 ? `${charLen} chars` : 'empty'}</strong>
            </li>
          </ul>
          <p className="card-footer">
            <code>{TEMPLATE_PATH}</code>
          </p>
        </div>
      </div>

      <div className="overview-actions">
        <h4>Quick actions</h4>
        <p>Go to tabs to configure:</p>
        <ul className="quick-actions">
          <li><strong>🔌 MCP</strong> — add local or remote MCP servers</li>
          <li><strong>🤖 Agents</strong> — define specialized sub-agents</li>
          <li><strong>🛠️ Skills</strong> — create reusable skills</li>
          <li><strong>💬 Character</strong> — global instructions for CLIs</li>
          <li><strong>📚 Docs (install)</strong> — install missing CLIs or open docs</li>
        </ul>
      </div>
    </div>
  );
}

export default TabPanoramica;
