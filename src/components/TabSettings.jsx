function TabSettings({ closeToTray, onCloseToTrayChange }) {
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
    </div>
  );
}

export default TabSettings;
