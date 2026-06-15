# Ultimate CLI Manager (UCM)

<div align="center">

![UCM Banner](https://img.shields.io/badge/UCM-Ultimate%20CLI%20Manager-6366f1?style=for-the-badge&labelColor=1e1e2e)
[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1?style=for-the-badge&labelColor=1e1e2e)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-2.0-6366f1?style=for-the-badge&labelColor=1e1e2e)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-6366f1?style=for-the-badge&labelColor=1e1e2e)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-2021-6366f1?style=for-the-badge&labelColor=1e1e2e)](https://www.rust-lang.org)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-6366f1?style=for-the-badge&labelColor=1e1e2e)](https://www.microsoft.com/windows)

**A unified desktop app to manage and synchronize MCP servers, agents, skills, and character instructions across 5 AI CLI tools — with a single click.**

[Features](#-features) • [Supported CLIs](#-supported-clis) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Contributing](#-contributing)

</div>

---

## 🎯 What is UCM?

Managing multiple AI CLI tools (Claude Code, Junie, Cline, Kilo, OpenCode) means managing multiple configuration files, each with its own format and location. **Ultimate CLI Manager** solves this by giving you a single central JSON template that propagates to all your CLIs with one click.

- **One template, everywhere** — Define your MCP servers, agents, skills, and character instructions once
- **One-click sync** — Push configuration to all selected CLIs instantly
- **Conflict detection** — UCM warns you before overwriting existing configs
- **Import existing** — Pull MCP servers, agents, and skills directly from an already-configured CLI
- **Install missing CLIs** — One-click installation links to official docs/installers

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔌 **MCP Server Management** | Add local (STDIO) and remote (HTTP) MCP servers to a central template, then propagate to any combination of CLIs |
| 🤖 **Agents Management** | Define sub-agents with YAML frontmatter + markdown body; UCM writes the correct `.md` file per CLI |
| 🛠️ **Skills Management** | Create reusable skills with the same frontmatter pattern; UCM creates the `SKILL.md` file in the right directory structure |
| 💬 **Character / Instructions** | Write free-form markdown global instructions and push them to all selected CLIs |
| 📥 **Import from CLI** | Import existing MCP servers, agents, and skills from any already-configured CLI directly into your template |
| ⚠️ **Conflict Resolution** | Before propagating, UCM detects existing configs and lets you choose: overwrite all, keep all, or cancel |
| 📊 **Overview Dashboard** | See at a glance how many CLIs are installed, how many entities are configured, and which CLIs are selected |
| 📚 **Docs & Install Tab** | Quick links to official documentation for each CLI, plus one-click install for missing CLIs |

---

## 🖥️ Supported CLIs

| CLI | MCP | Agents | Skills | Character |
|---|---|---|---|---|
| 🤖 Claude Code | ✅ | ✅ | ✅ | ✅ |
| 🐝 Junie | ✅ | ✅ | ✅ | ✅ |
| 🐛 Cline | ✅ | ❌ | ❌ | ✅ |
| ⚡ Kilo | ✅ | ✅ | ✅ | ✅ |
| 🔥 OpenCode | ✅ | ✅ | ✅ | ✅ |

> **Note:** Cline only supports MCP servers and character instructions (no agents or skills).

---

## 🚀 Quick Start

### Prerequisites

- **Windows 10/11**
- **Node.js + npm** — required to install CLIs and run local MCP servers
- **PowerShell** — used for installing Claude and Junie, and for validating remote MCP endpoints
- **Rust** — for building the Tauri backend (only needed for development)

### Installation

#### From Release (Windows)

1. Download the latest `ucm.exe` from the [Releases page](https://github.com/YOUR_USERNAME/ultimate-cli-manager/releases)
2. Run the installer (MSI or NSIS) or use the portable `.exe`
3. Launch **UCM** from the Start Menu

#### From Source

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/ultimate-cli-manager.git
cd ultimate-cli-manager

# Install dependencies (uses Bun as package manager)
bun install

# Development mode — launches the Tauri desktop app with hot-reload
bun run tauri:dev

# Production build — creates MSI + NSIS installers
bun run tauri:build
```

> **Tip:** Run `bun run dev` if you only want to preview the React UI without the desktop window.

### First Run

1. **Select CLIs** in the sidebar — check the boxes for the CLI tools you want to manage
2. **Go to the Overview tab** to see which CLIs are detected as installed
3. **Add MCP servers, agents, or skills** in their respective tabs
4. **Click Propagate** to push your template to all selected CLIs

---

## 🏗️ Architecture

```
┌─────────────────────────────────── React 19 Frontend ───────────────────────────────────┐
│  App.jsx                                                                                  │
│   └─ initCliPaths() ──── Waits for Rust backend before rendering MainPanel               │
│       ├─ Sidebar.jsx          (CLI selection + install status dot)                        │
│       └─ MainPanel.jsx        (6-tab router)                                             │
│            ├─ 📊 Overview      (template summary + CLI install status)                     │
│            ├─ 🔌 MCP          (add/edit/test/propagate MCP servers)                       │
│            ├─ 🤖 Agents       (add/edit/propagate agents)                                  │
│            ├─ 🛠️ Skills      (add/edit/propagate skills)                                  │
│            ├─ 💬 Character   (markdown textarea + propagate)                              │
│            └─ 📚 Docs         (links + install buttons)                                    │
│                                                                                                 │
│  utils/                                                                                    │
│   ├─ cliPaths.js        ← Populated by Rust, single source of truth for all paths         │
│   ├─ cliDetector.js    ← Detects which CLIs are installed                                │
│   ├─ templateManager   ← Loads/saves ~/.ucm/template.json                                 │
│   ├─ configMapper.js   ← Translates template format → CLI-specific format                │
│   └─ propagator.js     ← Propagates entities + detects conflicts                         │
└─────────────────────────────────────── IPC ─────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────── Tauri 2 Backend (Rust) ──────────────────────────────┐
│  src-tauri/src/lib.rs                                                                    │
│   ├─ get_cli_paths       ← Single source of truth for all CLI paths                      │
│   ├─ check_cli           ← Detects if a CLI is installed                                 │
│   ├─ install_cli         ← Runs the CLI-specific install command                          │
│   ├─ read_file / write_file / ensure_dir / path_exists                                   │
│   ├─ test_mcp            ← Tests MCP servers (local: spawn 3s; remote: HEAD request)    │
│   └─ open_url_cmd        ← Opens URLs in default browser                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### File Storage

All configuration lives in your user profile:

| File | Purpose |
|---|---|
| `~/.ucm/template.json` | **Central UCM template** — your single source of truth |
| `~/.claude.json` | Claude Code MCP config |
| `~/.junie/mcp/mcp.json` | Junie MCP config |
| `~/.cline/mcp.json` | Cline MCP config |
| `~/.config/opencode/opencode.json` | OpenCode MCP + character |
| `~/.config/kilo/kilo.jsonc` | Kilo MCP + character |
| `~/.ucm/instructions.md` | Bridge file for OpenCode/Kilo character instructions |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | [Tauri v2](https://tauri.app) |
| Frontend | [React 19](https://react.dev) + [Vite 7](https://vitejs.dev) |
| Backend | [Rust 2021](https://www.rust-lang.org) |
| Package Manager | [Bun](https://bun.sh) |
| Styling | Catppuccin Mocha (CSS custom properties) |
| Target OS | Windows 10/11 (x64) |
| Installers | MSI + NSIS |

---

## 📁 Project Structure

```
ultimate-cli-manager/
├── src/                        # React frontend
│   ├── App.jsx                 # Root component + path initialization
│   ├── App.css                 # Global styles (Catppuccin Mocha)
│   ├── components/
│   │   ├── Sidebar.jsx        # CLI selection sidebar
│   │   ├── MainPanel.jsx      # Tab router
│   │   ├── TabPanoramica.jsx  # Overview dashboard
│   │   ├── TabMCP.jsx         # MCP server management
│   │   ├── TabAgents.jsx       # Agent management
│   │   ├── TabSkills.jsx       # Skills management
│   │   ├── TabCharacter.jsx    # Character/instructions
│   │   └── TabDocs.jsx         # Docs + install
│   └── utils/
│       ├── cliPaths.js         # Bridge: Rust paths → JS constants
│       ├── cliDetector.js      # Detects installed CLIs
│       ├── cliInstaller.js     # Wraps install_cli Tauri command
│       ├── templateManager.js  # Load/save central template
│       ├── configMapper.js     # Template → CLI-specific format
│       └── propagator.js       # Propagation logic + conflict detection
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   └── lib.rs             # All Tauri commands
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                       # Design docs and specs
├── CLAUDE.md                   # Claude Code guidance
└── README.md                   # This file
```

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

### Development Setup

```bash
# Install Bun (if not already installed)
powershell -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"

# Install dependencies
bun install

# Run in development mode
bun run tauri:dev
```

### Code Style

- **React components**: Functional components with hooks, no class components
- **Naming**: kebab-case for file names, camelCase for JS/JSX, PascalCase for React components
- **No "ny~" in code** — output strings, comments, and documentation only
- **Template format**: All user content stored in `~/.ucm/template.json` — never hardcode paths in consumers

### Reporting Issues

If you find a bug or have a feature request, please [open an issue](https://github.com/YOUR_USERNAME/ultimate-cli-manager/issues/new/choose) using the appropriate template.

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with 💜 using Tauri + React + Rust**

*If UCM made your life easier, consider giving it a ⭐ !*

</div>
