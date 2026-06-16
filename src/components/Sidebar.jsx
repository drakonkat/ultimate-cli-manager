import { useState } from 'react';

const CLI_ITEMS = [
  { id: 'panoramica', label: 'Overview', icon: '📊' },
  { id: 'mcp', label: 'MCP', icon: '🔌' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
  { id: 'skills', label: 'Skills', icon: '🛠️' },
  { id: 'character', label: 'Character', icon: '💬' },
  { id: 'docs', label: 'Docs', icon: '📚' },
  { id: 'project', label: 'Project', icon: '📁' },
];

const SETTINGS_ITEMS = [
  { id: 'settings', label: 'General', icon: '🔧' },
];

function Sidebar({ activeSection, onSectionChange }) {
  const [expandedSection, setExpandedSection] = useState('cli');

  const toggleSection = (section) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const isActive = (sectionId) => activeSection === sectionId;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>UCM</h2>
      </div>

      <nav className="sidebar-menu">
        {/* CLI Section */}
        <div className="sidebar-section">
          <button
            className={`sidebar-menu-item ${expandedSection === 'cli' ? 'active' : ''}`}
            onClick={() => toggleSection('cli')}
          >
            <span className="menu-icon">🧩</span>
            <span className="menu-label">CLI</span>
            <span className={`menu-arrow ${expandedSection === 'cli' ? 'open' : ''}`}>▶</span>
          </button>
          {expandedSection === 'cli' && (
            <div className="sidebar-submenu">
              {CLI_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-submenu-item ${isActive(item.id) ? 'active' : ''}`}
                  onClick={() => onSectionChange(item.id)}
                >
                  <span className="submenu-icon">{item.icon}</span>
                  <span className="submenu-label">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings Section */}
        <div className="sidebar-section">
          <button
            className={`sidebar-menu-item ${expandedSection === 'settings' ? 'active' : ''}`}
            onClick={() => toggleSection('settings')}
          >
            <span className="menu-icon">⚙️</span>
            <span className="menu-label">Settings</span>
            <span className={`menu-arrow ${expandedSection === 'settings' ? 'open' : ''}`}>▶</span>
          </button>
          {expandedSection === 'settings' && (
            <div className="sidebar-submenu">
              {SETTINGS_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-submenu-item ${isActive(item.id) ? 'active' : ''}`}
                  onClick={() => onSectionChange(item.id)}
                >
                  <span className="submenu-icon">{item.icon}</span>
                  <span className="submenu-label">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}

export default Sidebar;
