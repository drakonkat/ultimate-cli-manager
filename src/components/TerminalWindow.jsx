import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  ptySpawn,
  ptyWrite,
  ptyResize,
  ptyKill,
  subscribePty,
} from '../utils/ptyClient';
import TerminalTabBar from './TerminalTabBar';
import '@xterm/xterm/css/xterm.css';

/**
 * Root of the Tauri "terminal" window (opened from TabProject via
 * `WebviewWindow`). Shows a tab bar + an xterm.js area for each
 * active tab. Each tab is an independent PTY on the Rust side
 * (see `src-tauri/src/pty_manager.rs`).
 *
 * Ciclo di vita di una tab:
 *   1. `addTab(cliId, path)` → genera sessionId, crea Terminal, chiama
 *      `pty_spawn`, subscribe agli eventi, attacca onData.
 *   2. Container DOM riceve ref → `term.open(el)` + `fit.fit()` +
 *      `ptyResize` con cols/rows iniziali.
 *   3. ResizeObserver sul container → `ptyResize` su ogni resize.
 *   4. `closeTab(sessionId)` → `ptyKill` + dispose xterm + unsubscribe.
 *
 * Status della tab (drives .status-dot CSS):
 *   - 'starting' → appena creata, prima del primo evento
 *   - 'running'  → PTY alive, reading
 *   - 'idle'     → child uscito (pty:exit ricevuto)
 *   - 'error'    → spawn error or pty:error received
 */
function TerminalWindow() {
  // Tab array: each element is a "row" of the tab bar.
  // "Hot" handles (Terminal, FitAddon, unsubscribe) live in refs.
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);

  // Refs: sessionId → { term, fit, unsub, resizeObserver, containerEl }
  const termsRef = useRef(new Map());

  // On mount: read URL params (direct open from TabProject with
  // `?cli=...&path=...`) and listen for `terminal:add-tab` event for
  // when the user clicks "Open in [cli]" while the window is already
  // open (in that case the main window does setFocus + emit).
  //
  // `initializedRef` is needed because `React.StrictMode` in dev mode
  // mounts components twice: without the guard, `addTab` would be called
  // twice with the same URL params and the user would see 2 identical
  // tabs on open. The first mount sets the ref to `true`, the second
  // mount skips everything (URL already parsed, listener already active).
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const cli = params.get('cli');
    const path = params.get('path');
    if (cli && path) {
      addTab(cli, path);
    }

    // Cleanup: when the window closes (via X / Alt+F4), kill
    // all sessions. The backend already does this in `on_window_event`,
    // but it's good to also close on the frontend side to release xterm.
    const cleanup = listen('terminal:add-tab', (e) => {
      const { cliId, projectPath } = e.payload;
      if (cliId && projectPath) addTab(cliId, projectPath);
    });
    return () => {
      cleanup.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chiude tutte le tab quando la finestra viene chiusa.
  useEffect(() => {
    const handler = () => {
      for (const [sessionId, entry] of termsRef.current) {
        try {
          entry.resizeObserver?.disconnect();
          entry.unsub?.();
          entry.term?.dispose();
          ptyKill(sessionId).catch(() => {});
        } catch {
          /* ignore */
        }
      }
      termsRef.current.clear();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /**
   * Crea una nuova tab. Genera sessionId, istanzia xterm, invoca
   * `pty_spawn`, subscribe agli eventi, hookup onData.
   * Aggiorna lo state per render della tab bar + container DOM.
   */
  const addTab = useCallback(async (cliId, projectPath) => {
    const sessionId = crypto.randomUUID();

    // Crea xterm con tema Catppuccin Mocha (coerente con App.css).
    const term = new Terminal({
      fontFamily: '"Cascadia Code","Consolas",monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#cdd6f4',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Aggiungi alla tab bar (status iniziale 'starting').
    setTabs((prev) => [
      ...prev,
      { sessionId, cliId, path: projectPath, status: 'starting' },
    ]);
    setActiveId(sessionId);

    // Save to ref immediately (before await) so the subsequent useEffect
    // finds the entry when the DOM container is ready.
    const entry = { term, fit, unsub: null, resizeObserver: null, containerEl: null };
    termsRef.current.set(sessionId, entry);

    // Spawna il PTY lato Rust.
    try {
      await ptySpawn({
        cliId,
        projectPath,
        cols: 80,
        rows: 24,
        windowLabel: 'terminal',
        sessionId,
      });
      // Set to 'running' ONLY if no exit arrived in the meantime
      // (in case of immediate error like "CLI not installed").
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId && t.status === 'starting'
            ? { ...t, status: 'running' }
            : t
        )
      );
    } catch (e) {
      // Spawn error (e.g. path doesn't exist, CLI not installed).
      term.write(`\r\n\x1b[31m[Failed to start PTY: ${e}]\x1b[0m\r\n`);
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId ? { ...t, status: 'error' } : t
        )
      );
      return;
    }

    // Subscribe agli eventi PTY per questa sessione.
    entry.unsub = await subscribePty(sessionId, (ev) => {
      if (ev.kind === 'data') {
        term.write(ev.data);
      } else if (ev.kind === 'exit') {
        term.write(
          `\r\n\x1b[33m[Process exited with code ${ev.code}]\x1b[0m\r\n`
        );
        setTabs((prev) =>
          prev.map((t) =>
            t.sessionId === sessionId ? { ...t, status: 'idle' } : t
          )
        );
      } else if (ev.kind === 'error') {
        term.write(
          `\r\n\x1b[31m[PTY error: ${ev.message}]\x1b[0m\r\n`
        );
        setTabs((prev) =>
          prev.map((t) =>
            t.sessionId === sessionId ? { ...t, status: 'error' } : t
          )
        );
      }
    });

    // Hookup input utente: xterm onData → pty_write.
    term.onData((data) => {
      ptyWrite(sessionId, data).catch((e) => {
        term.write(`\r\n\x1b[31m[Write error: ${e}]\x1b[0m\r\n`);
      });
    });
  }, []);

  /**
   * Chiude una tab: killa il PTY, dispose xterm, unsubscribe,
   * rimuovi dallo state e dai refs.
   */
  const closeTab = useCallback(async (sessionId) => {
    const entry = termsRef.current.get(sessionId);
    if (entry) {
      try {
        entry.resizeObserver?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        entry.unsub?.();
      } catch {
        /* ignore */
      }
      try {
        entry.term?.dispose();
      } catch {
        /* ignore */
      }
      termsRef.current.delete(sessionId);
    }
    // Kill on Rust side (idempotent, returns Ok even if the session
    // was already removed).
    try {
      await ptyKill(sessionId);
    } catch {
      /* ignore */
    }
    // Rimuovi dallo state. Se era la tab attiva, attiva un'altra.
    setTabs((prev) => {
      return prev.filter((t) => t.sessionId !== sessionId);
    });
    setActiveId((curr) => {
      if (curr !== sessionId) return curr;
      // Activate the next or previous among those remaining.
      return null; // will be resolved by the useEffect below
    });
  }, []);

  // Quando activeId diventa null e ci sono ancora tab, attiva la prima.
  useEffect(() => {
    if (activeId === null && tabs.length > 0) {
      setActiveId(tabs[0].sessionId);
    }
  }, [activeId, tabs]);

  /**
   * Adds a new tab by cloning the active tab's CLI and path. No prompt:
   * the "terminal" window is scoped to a project, and the user just
   * wants another session of the same CLI in the same path. If there's
   * no active tab (edge case: window just opened without parsing URL
   * params), does nothing.
   */
  const handleAdd = useCallback(() => {
    if (!activeId) return;
    const active = tabs.find((t) => t.sessionId === activeId);
    if (!active) return;
    addTab(active.cliId, active.path);
  }, [activeId, tabs, addTab]);

  return (
    <div className="terminal-window">
      <TerminalTabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onAdd={handleAdd}
      />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {tabs.map((tab) => (
          <TerminalContainer
            key={tab.sessionId}
            sessionId={tab.sessionId}
            isActive={tab.sessionId === activeId}
            termsRef={termsRef}
          />
        ))}
        {tabs.length === 0 && (
          <div className="empty-state" style={{ margin: '1rem' }}>
            <em>
              No terminal sessions yet. Click <strong>+ Add tab</strong> above
              to open one.
            </em>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single xterm container per tab. Handles:
 *   1. Attach xterm to div (in a useEffect, because ref arrives
 *      after the first render).
 *   2. Call `fit.fit()` and send dimensions to the backend.
 *   3. ResizeObserver for automatic fit+resize.
 *   4. `display:none` when not the active tab (preserves buffer).
 */
function TerminalContainer({ sessionId, isActive, termsRef }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const entry = termsRef.current.get(sessionId);
    const el = containerRef.current;
    if (!entry || !el) return;
    entry.containerEl = el;

    // Open xterm in the container (only if not already open).
    if (!entry.term.element || !entry.term.element.parentElement) {
      entry.term.open(el);
    }

    // fit() e notifica cols/rows al backend. Piccolo ritardo per
    // dare al DOM il tempo di assestarsi (soprattutto al primo mount).
    const sendSize = () => {
      try {
        entry.fit.fit();
        const { cols, rows } = entry.term;
        if (cols > 0 && rows > 0) {
          ptyResize(sessionId, cols, rows).catch(() => {});
        }
      } catch {
        /* ignore (can happen if container is 0x0) */
      }
    };
    const t = setTimeout(sendSize, 50);

    // ResizeObserver: ogni cambio dimensione del container → fit+resize.
    const ro = new ResizeObserver(() => {
      sendSize();
    });
    ro.observe(el);
    entry.resizeObserver = ro;

    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [sessionId, termsRef]);

  return (
    <div
      ref={containerRef}
      className={`terminal-container ${isActive ? '' : 'hidden'}`}
      style={{
        position: isActive ? 'absolute' : 'absolute',
        inset: 0,
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
      }}
    />
  );
}

export default TerminalWindow;
