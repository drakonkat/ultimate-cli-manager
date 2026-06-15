import { useState } from 'react';
import TabPanoramica from './TabPanoramica';
import TabMCP from './TabMCP';
import TabAgents from './TabAgents';
import TabSkills from './TabSkills';
import TabCharacter from './TabCharacter';
import TabDocs from './TabDocs';
import TabProject from './TabProject';

const TABS = [
  { id: 'panoramica', label: 'Overview', icon: '📊' },
  { id: 'mcp', label: 'MCP', icon: '🔌' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
  { id: 'skills', label: 'Skills', icon: '🛠️' },
  { id: 'character', label: 'Character', icon: '💬' },
  { id: 'docs', label: 'Docs (install)', icon: '📚' },
  { id: 'project', label: 'Project', icon: '📁' },
];

function MainPanel({ selectedCLIs }) {
  const [activeTab, setActiveTab] = useState('panoramica');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'panoramica':
        return <TabPanoramica selectedCLIs={selectedCLIs} />;
      case 'mcp':
        return <TabMCP selectedCLIs={selectedCLIs} />;
      case 'agents':
        return <TabAgents selectedCLIs={selectedCLIs} />;
      case 'skills':
        return <TabSkills selectedCLIs={selectedCLIs} />;
      case 'character':
        return <TabCharacter selectedCLIs={selectedCLIs} />;
      case 'docs':
        return <TabDocs selectedCLIs={selectedCLIs} />;
      case 'project':
        return <TabProject selectedCLIs={selectedCLIs} />;
      default:
        return <TabPanoramica selectedCLIs={selectedCLIs} />;
    }
  };

  return (
    <main className="main-panel">
      <nav className="tab-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>
      <div className="tab-content">
        {renderTabContent()}
      </div>
    </main>
  );
}

export default MainPanel;
