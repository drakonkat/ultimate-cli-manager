function TabCharacter({ selectedCLIs }) {
  return (
    <div className="tab-panel">
      <h3>💬 Carattere / Instructions</h3>
      <p>CLI selezionate: {selectedCLIs.length > 0 ? selectedCLIs.join(', ') : 'Nessuna'}</p>
      <div className="placeholder-content">
        <p>Qui potrai configurare le istruzioni globali e il carattere degli agenti.</p>
      </div>
    </div>
  );
}

export default TabCharacter;
