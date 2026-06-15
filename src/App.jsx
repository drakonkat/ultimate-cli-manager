import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import { initCliPaths } from './utils/cliPaths';
import './App.css';

function App() {
  const [selectedCLIs, setSelectedCLIs] = useState([]);
  const [pathsReady, setPathsReady] = useState(false);
  const [pathsError, setPathsError] = useState(null);

  useEffect(() => {
    // SINGLE SOURCE OF TRUTH: i path arrivano dal backend Rust.
    // Aspettiamo il primo fetch PRIMA di renderizzare il main panel,
    // così tutti i consumer (TabAgents, TabSkills, propagator, ...) trovano
    // le costanti già popolate.
    initCliPaths()
      .then(() => setPathsReady(true))
      .catch((err) => setPathsError(err?.message || String(err)));
  }, []);

  const handleToggleCLI = (cliId) => {
    setSelectedCLIs((prev) =>
      prev.includes(cliId)
        ? prev.filter((id) => id !== cliId)
        : [...prev, cliId]
    );
  };

  const handleSelectAll = () => {
    setSelectedCLIs(['claude', 'junie', 'cline', 'kilo', 'opencode']);
  };

  const handleDeselectAll = () => {
    setSelectedCLIs([]);
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
        selectedCLIs={selectedCLIs}
        onToggleCLI={handleToggleCLI}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
      />
      <MainPanel selectedCLIs={selectedCLIs} />
    </div>
  );
}

export default App;
