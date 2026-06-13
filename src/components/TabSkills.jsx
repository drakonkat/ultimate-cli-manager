function TabSkills({ selectedCLIs }) {
  return (
    <div className="tab-panel">
      <h3>🛠️ Gestione Skills</h3>
      <p>CLI selezionate: {selectedCLIs.length > 0 ? selectedCLIs.join(', ') : 'Nessuna'}</p>
      <div className="placeholder-content">
        <p>Qui potrai aggiungere e gestire skills per le CLI selezionate.</p>
      </div>
    </div>
  );
}

export default TabSkills;
