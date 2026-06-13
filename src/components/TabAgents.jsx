function TabAgents({ selectedCLIs }) {
  return (
    <div className="tab-panel">
      <h3>🤖 Gestione Agenti</h3>
      <p>CLI selezionate: {selectedCLIs.length > 0 ? selectedCLIs.join(', ') : 'Nessuna'}</p>
      <div className="placeholder-content">
        <p>Qui potrai configurare agenti personalizzati per le CLI selezionate.</p>
      </div>
    </div>
  );
}

export default TabAgents;
