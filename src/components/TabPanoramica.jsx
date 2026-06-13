function TabPanoramica({ selectedCLIs }) {
  return (
    <div className="tab-panel">
      <h3>📊 Panoramica</h3>
      <p>CLI selezionate: {selectedCLIs.length > 0 ? selectedCLIs.join(', ') : 'Nessuna'}</p>
      <div className="placeholder-content">
        <p>Qui vedrai lo stato delle configurazioni delle CLI selezionate.</p>
        <p>Questa milestone è per l'UI - la logica arriverà dopo nya~</p>
      </div>
    </div>
  );
}

export default TabPanoramica;
