import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import { initCliPaths } from './utils/cliPaths';
import './App.css';

function App() {
  const [pathsReady, setPathsReady] = useState(false);
  const [pathsError, setPathsError] = useState(null);
  const [closeToTray, setCloseToTray] = useState(true);
  const [activeSection, setActiveSection] = useState('panoramica');

  useEffect(() => {
    initCliPaths()
      .then(() => invoke('get_close_to_tray').then(setCloseToTray))
      .catch((err) => setPathsError(err?.message || String(err)))
      .finally(() => setPathsReady(true));
  }, []);

  const handleCloseToTrayChange = async (value) => {
    setCloseToTray(value);
    await invoke('set_close_to_tray', { value });
  };

  if (pathsError) {
    return (
      <div className="app-error">
        <h2>⚠️ Path initialization error</h2>
        <pre>{pathsError}</pre>
      </div>
    );
  }

  if (!pathsReady) {
    return (
      <div className="app-loading">
        <p>Loading paths… nya~</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />
      <MainPanel
        activeSection={activeSection}
        closeToTray={closeToTray}
        onCloseToTrayChange={handleCloseToTrayChange}
      />
    </div>
  );
}

export default App;
