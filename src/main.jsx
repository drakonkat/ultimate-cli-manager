import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import TerminalWindow from "./components/TerminalWindow";

// Branching sull'entry point in base al label della finestra Tauri.
// La finestra "main" monta la UCM classica; le finestre "terminal-*"
// (aperte programmaticamente da `WebviewWindow` in TabProject con
// label `terminal-<projectId>-<cliId>`) montano il root del terminale
// integrato. Più finestre terminal possono coesistere, una per coppia
// (progetto, CLI).
//
// Questo evita di avere due HTML / due Vite entry point e tiene il
// bundle unico.
function pickRoot() {
  try {
    const currentLabel = getCurrentWebviewWindow().label || "";
    // Log diagnostico: visibile aprendo i DevTools della finestra
    // (click destro → Inspect, oppure Ctrl+Shift+I in dev mode).
    console.log("[main.jsx] window label =", currentLabel);
    if (currentLabel.startsWith("terminal-")) {
      return <TerminalWindow />;
    }
    return <App />;
  } catch (e) {
    // Fallback: se per qualche motivo l'API Tauri non è disponibile
    // (es. ambiente non-Tauri), monta App comunque così la UI non è
    // completamente rotta. Logghiamo l'errore per diagnosi.
    console.error("[main.jsx] Errore lettura window label:", e);
    return <App />;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {pickRoot()}
  </React.StrictMode>,
);
