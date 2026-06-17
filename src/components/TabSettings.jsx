import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

function TabSettings({ closeToTray, onCloseToTrayChange }) {
  const [projects, setProjects] = useState([]);
  const [trayProjects, setTrayProjects] = useState([]);
  const [spawnMode, setSpawnMode] = useState('terminal');
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      invoke('get_all_projects'),
      invoke('get_tray_projects'),
      invoke('get_spawn_mode'),
    ])
      .then(([allProjects, selectedUuids, mode]) => {
        setProjects(allProjects || []);
        setTrayProjects(selectedUuids || []);
        setSpawnMode(mode || 'terminal');
        setLoading(false);
      })
      .catch((e) => {
        console.error('Failed to load projects:', e);
        setLoading(false);
      });
  }, []);

  const handleToggle = (projectId) => {
    setTrayProjects((prev) => {
      const isSelected = prev.includes(projectId);
      let next;
      if (isSelected) {
        next = prev.filter((id) => id !== projectId);
      } else {
        next = [...prev, projectId];
      }
      setDirty(true);
      return next;
    });
  };

  const handleSpawnModeChange = (e) => {
    setSpawnMode(e.target.value);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('set_tray_projects', { uuids: trayProjects });
      await invoke('set_spawn_mode', { mode: spawnMode });
      await invoke('refresh_tray_menu');
      setDirty(false);
    } catch (e) {
      console.error('Failed to save settings:', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="tab-panel">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="tab-panel">
      <h3>⚙️ Settings</h3>
      <p>Configure application behavior.</p>

      <div className="settings-section">
        <h4>General</h4>
        <div className="settings-item">
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={closeToTray}
              onChange={(e) => onCloseToTrayChange(e.target.checked)}
            />
            <span>Close in the tray insted of exiting</span>
          </label>
          <p className="settings-description">
            When enabled, closing the main window hides the app to the system tray instead of exiting.
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h4>CLI Spawn mode</h4>
        <p className="settings-description">
          Choose how CLIs are launched from the tray menu and Projects section.
        </p>
        <div className="settings-item">
          <label className="settings-radio">
            <input
              type="radio"
              name="spawnMode"
              value="terminal"
              checked={spawnMode === 'terminal'}
              onChange={handleSpawnModeChange}
            />
            <span>🪟 Integrated terminal (beta)</span>
          </label>
          <p className="settings-description" style={{ marginLeft: '1.5rem' }}>
            Opens a built-in terminal window with PTY support. Recommended.
          </p>
          <label className="settings-radio" style={{ marginTop: '0.5rem' }}>
            <input
              type="radio"
              name="spawnMode"
              value="powershell"
              checked={spawnMode === 'powershell'}
              onChange={handleSpawnModeChange}
            />
            <span>💻 PowerShell</span>
          </label>
          <p className="settings-description" style={{ marginLeft: '1.5rem' }}>
            Opens a standard PowerShell window. Legacy behavior.
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h4>Projects in tray</h4>
        <p className="settings-description">
          Select which projects appear in the tray icon submenu. All projects are shown by default.
        </p>
        {projects.length === 0 ? (
          <p>
            <em>No projects registered. Add projects in the Project tab.</em>
          </p>
        ) : (
          <div className="settings-item">
            {projects.map((p) => {
              const id = p.id || p._id || '';
              const name = p.name || 'Unnamed';
              const isChecked = trayProjects.includes(id);
              return (
                <label key={id} className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggle(id)}
                  />
                  <span>{name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {dirty && (
        <div style={{ marginTop: '1rem' }}>
          <button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save and restart tray'}
          </button>
          <span style={{ marginLeft: '0.5rem', opacity: 0.7, fontSize: '0.85em' }}>
            Changes will be applied when the tray restarts
          </span>
        </div>
      )}
    </div>
  );
}

export default TabSettings;
