# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Ultimate CLI Manager (UCM)** — Tauri + React desktop app that unified manages the configuration of 5 AI CLIs (Claude Code, Junie, Cline, Kilo, OpenCode) via a **centralized JSON template** propagated with one click to all selected CLIs.

---

## Development Commands

All commands use **Bun** as package manager (see `bun.lock`).

| Command | Effect |
|---|---|
| `bun run dev` | Vite dev server only (NO Tauri, useful for pure UI testing) |
| `bun run tauri:dev` | Tauri + Vite with hot-reload (live desktop window) |
| `bun run build` | Frontend build only (output in `dist/`) |
| `bun run tauri:build` | Production build: MSI + NSIS + portable `ucm.exe` in `src-tauri/target/release/bundle/` |
| `bun run preview` | Static preview of the frontend build |

Vite is fixed on **port 1420** (`strictPort: true`) — do not change it, Tauri expects it. Rust sources in `src-tauri/` are excluded from Vite's watch.

To validate the Rust backend without launching the UI: `cd src-tauri && cargo check`.

---

## High-Level Architecture

```
┌─────────────────────────── Frontend React 19 ───────────────────────────┐
│  App.jsx                                                                │
│   └─ useEffect: await initCliPaths()  ← BLOCKS MainPanel rendering      │
│       ├─ Sidebar.jsx       (CLI selection + installation status)         │
│       └─ MainPanel.jsx     (tab router: 6 tabs)                         │
│            ├─ TabPanoramica  (template overview + installed CLIs)         │
│            ├─ TabMCP         (form editor + test + propagate)            │
│            ├─ TabAgents      (hybrid editor: name+desc+content)           │
│            ├─ TabSkills      (identical hybrid editor)                    │
│            ├─ TabCharacter   (free markdown textarea)                    │
│            └─ TabDocs        (docs links + install button)               │
│                                                                         │
│  utils/                                                                 │
│   ├─ cliPaths.js       ← populated by Rust, SINGLE SOURCE OF TRUTH     │
│   ├─ cliDetector.js    ← CLI_LIST hardcoded, detectAllCLIs()            │
│   ├─ cliInstaller.js   ← wrapper for invoke('install_cli')             │
│   ├─ templateManager   ← load/save to ~/.ucm/template.json             │
│   ├─ configMapper.js   ← template → CLI-specific format                 │
│   └─ propagator.js     ← propagates MCP/agents/skills/character + conflicts│
└─────────────────────────────────────────────────────────────────────────┘
                              │  invoke() IPC
┌─────────────────────────── Backend Rust (Tauri 2) ──────────────────────┐
│  src-tauri/src/lib.rs                                                   │
│   ├─ get_cli_paths       (★ SINGLE SOURCE OF TRUTH for CLI paths)       │
│   ├─ check_cli           (detects installation)                         │
│   ├─ install_cli         (runs powershell.exe / npm.cmd)               │
│   ├─ read_file / write_file / ensure_dir / path_exists                 │
│   ├─ test_mcp            (local: spawn 3s; remote: HEAD request)       │
│   └─ open_url_cmd                                                         │
│                                                                         │
│  UserPaths::resolve()  ← uses `dirs` crate, no hardcoded paths          │
└─────────────────────────────────────────────────────────────────────────┘
                              │  fs
        Windows File System:
       ~/.ucm/template.json              ← central template
       ~/.claude.json                   ← Claude MCP
       ~/.junie/mcp/mcp.json            ← Junie MCP
       ~/.cline/mcp.json                ← Cline MCP
       ~/.config/opencode/opencode.json ← OpenCode
       ~/.config/kilo/kilo.jsonc        ← Kilo
       ~/.ucm/instructions.md           ← bridge file for OpenCode/Kilo character
```

---

## Non-Negotiable Architectural Rules

### 1. Paths come from the Rust backend ONLY
**NEVER** duplicate path strings in JS. `AGENTS_PATHS`, `SKILLS_PATHS`, `CHARACTER_PATHS`, `CHARACTER_JSON_PATHS`, `MCP_CONFIG_PATHS`, `UCM_INSTRUCTIONS_FILE` are all populated by `initCliPaths()` calling the `get_cli_paths` command. This module MUST be invoked BEFORE any `MainPanel` rendering — the `pathsReady` guard in `App.jsx` guarantees this.

To add/modify a path → modify `get_cli_paths` in `src-tauri/src/lib.rs`, then touch only the cache in `cliPaths.js` with `Object.assign`. **Do not** rewrite paths in consumers.

### 2. Template = SINGLE SOURCE OF TRUTH for configuration
Everything flows through `~/.ucm/template.json`. The template has 4 sections:
- `mcp: { [name]: { type, command|url, env|headers, enabled } }`
- `agents: { [name]: { description, content (YAML frontmatter + md) } }`
- `skills: { [name]: { description, content (YAML frontmatter + md) } }`
- `character: { instructions: markdown string }`

Modify template → modify the JSON file → on next propagation it is read and translated for each CLI.

### 3. Each CLI has its own MCP format
See `configMapper.js`. The 5 CLIs split into 2 families:
- **OpenCode / Kilo** → key `mcp`, fields `{type, command, environment, enabled}` (no `mcpServers`!)
- **Claude / Junie / Cline** → key `mcpServers`, fields `{command, args, env|url, enabled|disabled}`

**Cline uses `disabled`** to disable, the others use `enabled`. The mapper handles this — do not duplicate the logic.

### 4. Cline supports ONLY character
No agents, no skills. `supportsAgents('cline')` and `supportsSkills('cline')` return `false`. Tabs show the warning "(N selected do not support agents/skills, e.g. Cline)".

### 5. Character for OpenCode/Kilo: special mechanism
Do not write directly to the CLI file. Write the content to `~/.ucm/instructions.md` and update the `instructions` array of the `opencode.json`/`kilo.jsonc` JSON to include that path. When the character is cleared, the entry is removed from the array.

### 6. Conflicts ALWAYS before propagation
Fixed pattern in every tab (MCP/Agents/Skills/Character):
1. `detect*Conflicts()` → map `{ cliId: [existing entities] }` or `cliId: true` for MCP
2. If conflicts → show `ConflictDialog` with buttons "Overwrite all | Keep all | Cancel"
3. Resolutions `{ cliId: true|false }` are passed to `propagate*ToCLIs()`
4. Silent skip for unsupported CLIs (status: `'skipped'`, reason: `'CLI does not support ...'`)

---

## Propagator Behavior

- **`propagateToCLIs`** — MCP: reads existing config, writes only if `overwrite=true`
- **`propagateAgentsToCLIs`** — writes `<root>\<name>.md` for each agent
- **`propagateSkillsToCLIs`** — creates `<root>\<name>\` and writes `SKILL.md`
- **`propagateCharacterToCLIs`** — 2 cases: free file (Claude/Junie/Cline) or JSON+bridge file (OpenCode/Kilo)

All return `Array<{ cliId, status: 'propagated'|'kept'|'skipped'|'error', details?, reason? }>`.

---

## Conventions

- **Agent/skill file names**: kebab-case mandatory (validated with regex `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`); UI asks for confirmation if the user types something else
- **Agents/skills editor**: `content` field is a single block of YAML frontmatter + markdown body — the user controls the exact format required by the target CLI, we do not parse anything
- **Character editor**: single free markdown textarea with an example `STARTER_TEMPLATE`
- **Status dot** in Sidebar/Docs: green `installed` / red `not-installed` / gray `unknown` (during verification)
- **Palette**: Catppuccin Mocha, defined in `src/App.css`

---

## Tech Stack and External Dependencies

- **Tauri 2** + **React 19** + **Vite 7** + **Rust 2021 edition**
- **Required system dependencies** (for end user):
  - **Node.js + npm** — to install Cline/Kilo/OpenCode and run local MCPs
  - **PowerShell** — to install Claude/Junie and validate remote MCPs (HEAD request)
- **Storage**: JSON file system only, no DB
- **Target**: Windows 10/11 (paths and MSI/NSIS installers)
- **`dirs` crate** in Rust for portable user paths (no `C:\Users\<username>` hardcoded in backend)

---

## Historical Bugs to NOT Repeat

1. **Mapper wrote `mcpServers` in OpenCode** → OpenCode rejects the config. The mapper returns ONLY the correct key for the family, never both.
2. **`Command::new("powershell")` could not find the executable on Windows** → used `powershell.exe` and `npm.cmd` (with extension), never bare names.
3. **Initial paths wrong from web search**: official paths did not match the real PC. Corrected paths verified:
   - Kilo: `kilo.jsonc` (not `opencode.json`)
   - Cline CLI: `mcp.json` in root (not in `data/settings/cline_mcp_settings.json`)
   - Claude: `.claude.json` in home (not `.claude/.mcp.json`)
4. **Corrupted files from wrong propagations** (must be cleaned manually, do NOT touch without user confirmation):
   - `~/.config/kilo/opencode.json` — delete
   - `~/.config/opencode/opencode.json` — remove key `"mcpServers": {}`

---

## Where to Look for the Big Picture

- `docs/superpowers/specs/README.md` — architecture, milestones, CLI mapping, TODO
- `docs/superpowers/specs/2026-06-13-mvp-completion-design.md` — design of Agents/Skills/Character tabs just implemented
- `src-tauri/src/lib.rs` — UNIQUE source of truth for paths and backend capabilities
- `src/utils/cliPaths.js` — Rust → JS bridge, API unchanged for consumers
- `src/utils/propagator.js` — propagation and conflicts logic (4 `propagate*ToCLIs` functions)
