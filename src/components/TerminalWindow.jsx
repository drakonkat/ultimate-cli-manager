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
 * Root della finestra Tauri "terminal" (aperta da TabProject via
 * `WebviewWindow`). Mostra un tab bar + un'area xterm.js per ogni
 * tab attiva. Ogni tab è un PTY indipendente lato Rust
 * (vedi `src-tauri/src/pty_manager.rs`).
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
 *   - 'running'  → PTY vivo, in lettura
 *   - 'idle'     → child uscito (pty:exit ricevuto)
 *   - 'error'    → errore di spawn o pty:error ricevuto
 */
function TerminalWindow() {
  // Array di tab: ogni elemento è una "riga" della tab bar.
  // Gli handle "caldi" (Terminal, FitAddon, unsubscribe) stanno in ref.
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);

  // Refs: sessionId → { term, fit, unsub, resizeObserver, containerEl }
  const termsRef = useRef(new Map());

  // All mount: leggi URL params (apertura diretta da TabProject con
  // `?cli=...&path=...`) e ascolta l'evento `terminal:add-tab` per
  // quando l'utente clicca "Open in [cli]" mentre la finestra è già
  // aperta (in quel caso la main window fa setFocus + emit).
  //
  // `initializedRef` serve perché `React.StrictMode` in dev mode monta
  // i componenti due volte: senza il guard, `addTab` verrebbe chiamato
  // due volte con gli stessi URL params e l'utente vedrebbe 2 tab
  // identiche all'apertura. Il primo mount setta il ref a `true`, il
  // secondo mount skippa tutto (URL già parsato, listener già attivo).
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

    // Cleanup: quando la finestra si chiude (via X / Alt+F4), killa
    // tutte le sessioni. Il backend lo fa già in `on_window_event`,
    // ma è bene anche chiudere lato frontend per rilasciare xterm.
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

    // Salva nel ref subito (prima del await) così il useEffect
    // successivo trova l'entry quando il container DOM è pronto.
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
      // Settato 'running' SOLO se non è arrivato un exit nel frattempo
      // (in caso di errore immediato come "CLI non installata").
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId && t.status === 'starting'
            ? { ...t, status: 'running' }
            : t
        )
      );
    } catch (e) {
      // Errore di spawn (es. path non esiste, CLI non installata).
      term.write(`\r\n\x1b[31m[Failed to start PTY: ${e}]\x1b[0m\r\n`);
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId ? { ...t, status: 'error' } : t
        )
      );
      return;
    }

    // Subscribe agli eventi PTY per questa sessione.
    const unsub = await subscribePty(sessionId, (ev) => {
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
    entry.unsub = unsub;

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
    // Killa lato Rust (idempotente, ritorna Ok anche se la sessione
    // è già stata rimossa).
    try {
      await ptyKill(sessionId);
    } catch {
      /* ignore */
    }
    // Rimuovi dallo state. Se era la tab attiva, attiva un'altra.
    setTabs((prev) => {
      const next = prev.filter((t) => t.sessionId !== sessionId);
      return next;
    });
    setActiveId((curr) => {
      if (curr !== sessionId) return curr;
      // Attiva la successiva o la precedente tra quelle rimaste.
      return null; // verrà risolto dal useEffect sotto
    });
  }, []);

  // Quando activeId diventa null e ci sono ancora tab, attiva la prima.
  useEffect(() => {
    if (activeId === null && tabs.length > 0) {
      setActiveId(tabs[0].sessionId);
    }
  }, [activeId, tabs]);

  /**
   * Aggiunge una nuova tab clonando la CLI e il path della tab
   * attiva. Niente prompt: la finestra "terminal" è scoped a un
   * progetto, e l'utente vuole solo un'altra sessione della stessa
   * CLI nello stesso path. Se non c'è una tab attiva (caso limite:
   * finestra appena aperta senza aver parsato gli URL params), non
   * fa nulla.
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
 * Singolo container xterm per tab. Si occupa di:
 *   1. Attaccare xterm al div (in un useEffect, perché il ref arriva
 *      dopo il primo render).
 *   2. Chiamare `fit.fit()` e inviare le dimensioni al backend.
 *   3. ResizeObserver per fit+resize automatici.
 *   4. `display:none` quando non è la tab attiva (mantiene il buffer).
 */
function TerminalContainer({ sessionId, isActive, termsRef }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const entry = termsRef.current.get(sessionId);
    const el = containerRef.current;
    if (!entry || !el) return;
    entry.containerEl = el;

    // Apri xterm nel container (solo se non già aperto).
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
        /* ignore (può succedere se container 0x0) */
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
