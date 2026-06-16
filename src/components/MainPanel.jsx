import TabPanoramica from './TabPanoramica';
import TabMCP from './TabMCP';
import TabAgents from './TabAgents';
import TabSkills from './TabSkills';
import TabCharacter from './TabCharacter';
import TabDocs from './TabDocs';
import TabProject from './TabProject';
import TabSettings from './TabSettings';

function MainPanel({ activeSection, closeToTray, onCloseToTrayChange }) {
  let Content;
  switch (activeSection) {
    case 'panoramica':
      Content = TabPanoramica;
      break;
    case 'mcp':
      Content = TabMCP;
      break;
    case 'agents':
      Content = TabAgents;
      break;
    case 'skills':
      Content = TabSkills;
      break;
    case 'character':
      Content = TabCharacter;
      break;
    case 'docs':
      Content = TabDocs;
      break;
    case 'project':
      Content = TabProject;
      break;
    case 'settings':
      Content = TabSettings;
      break;
    default:
      Content = TabPanoramica;
  }

  const props = activeSection === 'settings' ? { closeToTray, onCloseToTrayChange } : {};

  return (
    <main className="main-panel">
      <div className="main-content">
        <div className="main-content-inner">
          <Content {...props} />
        </div>
      </div>
    </main>
  );
}

export default MainPanel;
