import { useState } from 'react';
import Sidebar from './components/Sidebar';
import MainPanel from './components/MainPanel';
import './App.css';

function App() {
  const [selectedCLIs, setSelectedCLIs] = useState([]);

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
