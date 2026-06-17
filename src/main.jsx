import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import TerminalWindow from "./components/TerminalWindow";

// Branching sull'entry point in base al label della finestra Tauri.
// La finestra "main" monta la UCM classica; le finestre "terminal-*"
// (opened programmatically from `WebviewWindow` in TabProject with
// label `terminal-<projectId>-<cliId>`) mount the integrated terminal
// root. Multiple terminal windows can coexist, one per pair (project, CLI).
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
    // Fallback: if the Tauri API is unavailable for any reason
    // (e.g. non-Tauri environment), still mount App so the UI isn't
    // completely broken. We log the error for diagnostics.
    console.error("[main.jsx] Error reading window label:", e);
    return <App />;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {pickRoot()}
  </React.StrictMode>,
);
