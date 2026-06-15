# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Ultimate CLI Manager (UCM)** — desktop app Tauri + React che gestisce in modo unificato la configurazione di 5 CLI AI (Claude Code, Junie, Cline, Kilo, OpenCode) tramite un **template JSON centralizzato** propagato con un click a tutte le CLI selezionate, nya~.

---

## Comandi di sviluppo

Tutti i comandi usano **Bun** come package manager (vedi `bun.lock`).

| Comando | Effetto |
|---|---|
| `bun run dev` | Solo Vite dev server (NO Tauri, utile per test UI pura) |
| `bun run tauri:dev` | Tauri + Vite con hot-reload (finestra desktop live) |
| `bun run build` | Build del solo frontend (output in `dist/`) |
| `bun run tauri:build` | Build production: MSI + NSIS + `ucm.exe` portabile in `src-tauri/target/release/bundle/` |
| `bun run preview` | Anteprima statica del build frontend |

Vite è fissato su **porta 1420** (`strictPort: true`) — non cambiarla, Tauri se lo aspetta. I sorgenti Rust in `src-tauri/` sono esclusi dal watch di Vite.

Per validare il backend Rust senza avviare la UI: `cd src-tauri && cargo check`.

---

## Architettura di alto livello

```
┌─────────────────────────── Frontend React 19 ───────────────────────────┐
│  App.jsx                                                                │
│   └─ useEffect: await initCliPaths()  ← BLOCCA il render del MainPanel  │
│       ├─ Sidebar.jsx       (selezione CLI + stato installazione)        │
│       └─ MainPanel.jsx     (router tab: 6 tab)                          │
│            ├─ TabPanoramica  (overview template + CLI installate)        │
│            ├─ TabMCP         (form editor + test + propaga)              │
│            ├─ TabAgents      (editor ibrido: name+desc+content)          │
│            ├─ TabSkills      (editor ibrido identico)                    │
│            ├─ TabCharacter   (textarea markdown libero)                  │
│            └─ TabDocs        (link docs + bottone installa)              │
│                                                                         │
│  utils/                                                                 │
│   ├─ cliPaths.js       ← popolato da Rust, SINGLE SOURCE OF TRUTH path  │
│   ├─ cliDetector.js    ← CLI_LIST hardcoded, detectAllCLIs()             │
│   ├─ cliInstaller.js   ← wrapper per invoke('install_cli')               │
│   ├─ templateManager   ← load/save suUSERPROFILE\.ucm\template.json │
│   ├─ configMapper.js   ← template → formato specifico per ogni CLI      │
│   └─ propagator.js     ← propaga MCP/agents/skills/character + conflitti│
└─────────────────────────────────────────────────────────────────────────┘
                              │  invoke() IPC
┌─────────────────────────── Backend Rust (Tauri 2) ──────────────────────┐
│  src-tauri/src/lib.rs                                                   │
│   ├─ get_cli_paths       (★ SINGLE SOURCE OF TRUTH per i path CLI)      │
│   ├─ check_cli           (rileva installazione)                         │
│   ├─ install_cli         (esegue powershell.exe / npm.cmd)              │
│   ├─ read_file / write_file / ensure_dir / path_exists                  │
│   ├─ test_mcp            (local: spawna 3s; remote: HEAD request)       │
│   └─ open_url_cmd                                                          │
│                                                                         │
│  UserPaths::resolve()  ← usa `dirs` crate, niente path hardcodati       │
└─────────────────────────────────────────────────────────────────────────┘
                              │  fs
        File System Windows:
       USERPROFILE\.ucm\template.json              ← template centrale
       USERPROFILE\.claude.json                   ← Claude MCP
       USERPROFILE\.junie\mcp\mcp.json            ← Junie MCP
       USERPROFILE\.cline\mcp.json                ← Cline MCP
       USERPROFILE\.config\opencode\opencode.json ← OpenCode
       USERPROFILE\.config\kilo\kilo.jsonc        ← Kilo
       USERPROFILE\.ucm\instructions.md           ← file ponte per OpenCode/Kilo character
```

---

## Regole architetturali non-negoziabili

### 1. I path arrivano **SOLO** dal backend Rust
**MAI** duplicare stringhe di path lato JS. `AGENTS_PATHS`, `SKILLS_PATHS`, `CHARACTER_PATHS`, `CHARACTER_JSON_PATHS`, `UCM_INSTRUCTIONS_FILE` sono popolati da `initCliPaths()` chiamando il command `get_cli_paths`. Questo modulo DEVE essere invocato PRIMA di qualsiasi rendering del `MainPanel` — la guard in `App.jsx` con `pathsReady` lo garantisce, nya~.

Per aggiungere/modificare un path → modifica `get_cli_paths` in `src-tauri/src/lib.rs`, poi tocca solo la cache in `cliPaths.js` con `Object.assign`. **Non** riscrivere i path nei consumer.

### 2. Template = SINGLE SOURCE OF TRUTH della configurazione
Tutto passa per `C:\Users\mauro\.ucm\template.json`. Il template ha 4 sezioni:
- `mcp: { [name]: { type, command|url, env|headers, enabled } }`
- `agents: { [name]: { description, content (YAML frontmatter + md) } }`
- `skills: { [name]: { description, content (YAML frontmatter + md) } }`
- `character: { instructions: stringa markdown }`

Modifica template → modifica il file JSON → alla prossima propagazione viene letto e tradotto per ogni CLI.

### 3. Ogni CLI ha un formato MCP proprio
Vedi `configMapper.js`. Le 5 CLI si dividono in 2 famiglie:
- **OpenCode / Kilo** → chiave `mcp`, campi `{type, command, environment, enabled}` (no `mcpServers`!)
- **Claude / Junie / Cline** → chiave `mcpServers`, campi `{command, args, env|url, enabled|disabled}`

**Cline usa `disabled`** per disabilitare, gli altri usano `enabled`. Il mapper se ne occupa — non duplicare la logica.

### 4. Cline supporta SOLO character
Niente agents, niente skills. `supportsAgents('cline')` e `supportsSkills('cline')` ritornano `false`. Le tab mostrano l'avviso "(N selezionate non supportano agents/skills, es. Cline)".

### 5. Character per OpenCode/Kilo: meccanismo speciale
Non si scrive direttamente nel file della CLI. Si scrive il contenuto in `~/.ucm/instructions.md` e si aggiorna l'array `instructions` del JSON `opencode.json`/`kilo.jsonc` per includere quel path. Quando si svuota il character, l'entry viene rimossa dall'array, nya~.

### 6. Conflitti SEMPRE prima della propagazione
Pattern fisso in ogni tab (MCP/Agents/Skills/Character):
1. `detect*Conflicts()` → mappa `{ cliId: [entità esistenti] }` o `cliId: true` per MCP
2. Se conflitti → mostra `ConflictDialog` con bottoni "Sovrascrivi tutte/i | Mantieni tutte/i | Annulla"
3. Le risoluzioni `{ cliId: true|false }` arrivano a `propagate*ToCLIs()`
4. Skip silente per CLI non supportate (status: `'skipped'`, reason: `'CLI non supporta ...'`)

---

## Comportamento del propagator

- **`propagateToCLIs`** — MCP: legge config esistente, scrive solo se `overwrite=true`
- **`propagateAgentsToCLIs`** — scrive `<root>\<name>.md` per ogni agent
- **`propagateSkillsToCLIs`** — crea `<root>\<name>\` e scrive `SKILL.md`
- **`propagateCharacterToCLIs`** — 2 casi: file libero (Claude/Junie/Cline) o JSON+file ponte (OpenCode/Kilo)

Tutte ritornano `Array<{ cliId, status: 'propagated'|'kept'|'skipped'|'error', details?, reason? }>`.

---

## Convenzioni

- **Nomi file agent/skill**: kebab-case obbligatorio (validato con regex `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`); UI chiede conferma se l'utente scrive qualcosa d'altro
- **Editor agents/skills**: campo `content` è un blocco unico YAML frontmatter + markdown body — l'utente controlla il formato esatto richiesto dalla CLI target, non parsiamo nulla
- **Editor character**: singola textarea markdown libero con `STARTER_TEMPLATE` di esempio
- **Status dot** in Sidebar/Docs: verde `installed` / rosso `not-installed` / grigio `unknown` (durante verifica)
- **Palette**: Catppuccin Mocha, definita in `src/App.css`

---

## Stack tecnico e dipendenze esterne

- **Tauri 2** + **React 19** + **Vite 7** + **Rust 2021 edition**
- **Dipendenze di sistema richieste** (per utente finale):
  - **Node.js + npm** — per installare Cline/Kilo/OpenCode e per eseguire MCP locali
  - **PowerShell** — per installare Claude/Junie e per validare MCP remote (HEAD request)
- **Storage**: solo file system JSON, niente DB
- **Target**: Windows 10/11 (path e installer MSI/NSIS)
- **`dirs` crate** in Rust per path utente portabili (no `C:\Users\mauro` hardcodato lato backend)

---

## Bug storici da NON ripetere

1. **Mapper scriveva `mcpServers` in OpenCode** → OpenCode rifiuta la config. Il mapper ritorna SOLO la chiave giusta per la famiglia, mai entrambe.
2. **`Command::new("powershell")` non trovava l'eseguibile su Windows** → usato `powershell.exe` e `npm.cmd` (con estensione), mai i nomi nudi.
3. **Path iniziali sbagliati da websearch**: i path "ufficiali" non corrispondevano al PC reale. Path corretti verificati:
   - Kilo: `kilo.jsonc` (non `opencode.json`)
   - Cline CLI: `mcp.json` nella root (non in `data/settings/cline_mcp_settings.json`)
   - Claude: `.claude.json` nella home (non `.claude/.mcp.json`)
4. **File corrotti da propagazioni sbagliate** (vanno puliti manualmente, NON toccare senza conferma utente):
   - `C:\Users\mauro\.config\kilo\opencode.json` — cancellare
   - `C:\Users\mauro\.config\opencode\opencode.json` — rimuovere chiave `"mcpServers": {}`

---

## Dove guardare per la visione d'insieme

- `docs/superpowers/specs/README.md` — architettura, milestone, mapping CLI, TODO
- `docs/superpowers/specs/2026-06-13-mvp-completion-design.md` — design delle tab Agents/Skills/Character appena implementate
- `src-tauri/src/lib.rs` — UNICA fonte di verità per i path e per le capability backend
- `src/utils/cliPaths.js` — bridge Rust → JS, API invariata per i consumer
- `src/utils/propagator.js` — logica di propagazione e conflitti (4 funzioni `propagate*ToCLIs`)
