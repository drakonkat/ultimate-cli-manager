import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

function TabSettings({ closeToTray, onCloseToTrayChange }) {
  const [projects, setProjects] = useState([]);
  const [trayProjects, setTrayProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      invoke('get_all_projects'),
      invoke('get_tray_projects'),
    ])
      .then(([allProjects, selectedUuids]) => {
        setProjects(allProjects || []);
        setTrayProjects(selectedUuids || []);
        setLoading(false);
      })
      .catch((e) => {
        console.error('Failed to load projects:', e);
        setLoading(false);
      });
  }, []);

  const handleToggle = async (projectId) => {
    const isSelected = trayProjects.includes(projectId);
    let newTrayProjects;
    if (isSelected) {
      newTrayProjects = trayProjects.filter((id) => id !== projectId);
    } else {
      newTrayProjects = [...trayProjects, projectId];
    }
    setTrayProjects(newTrayProjects);
    try {
      await invoke('set_tray_projects', { uuids: newTrayProjects });
      await invoke('refresh_tray_menu');
    } catch (e) {
      console.error('Failed to update tray projects:', e);
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
            <span>Chiudi in tray invece di uscire</span>
          </label>
          <p className="settings-description">
            When enabled, closing the main window hides the app to the system tray instead of exiting.
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
              // If trayProjects is empty, all projects are shown (default behavior)
              const isChecked = trayProjects.length === 0 || trayProjects.includes(id);
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
    </div>
  );
}

export default TabSettings;
