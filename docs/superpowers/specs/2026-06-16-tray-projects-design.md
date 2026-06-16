# Tray Projects — Design Spec

## Obiettivo

Aggiungere al menu tray icon la possibilità di visualizzare i **progetti registrati** e, per ciascuno, spawnare una CLI specifica nella cartella di quel progetto.

Il comportamento è analogo a quanto già presente nella scheda **Project** (`TabProject.jsx`), ma accessibile direttamente dalla tray icon senza aprire la finestra principale.

---

## Struttura menu tray (nuovo)

```
Apri UCM
──────────────────
Projects ▶        ← sottomenu espandibile (click)
  └─ progetto-1
       ├─ Spawn Claude
       ├─ Spawn Junie
       ├─ Spawn Cline
       ├─ Spawn Kilo
       └─ Spawn OpenCode
  └─ progetto-2
       ├─ Spawn Claude
       └─ ...
──────────────────
Esci
```

- Click su "Projects ▶" apre il **sottomenu** con l'elenco dei progetti
- Ogni progetto espande i **5 sottocomandi** "Spawn <CLI>"
- Click su un sottocomando → spawn della CLI nella cartella di quel progetto (direct, no directory picker — il path è già noto)
- Se nessun progetto è registrato, il sottomenu "Projects" mostra una voce disabilitata "Nessun progetto"

---

## Impostazioni — General (nuova sezione)

```
Projects in tray:
☑ progetto-1
☑ progetto-2
☐ progetto-3   ← despuntato = non appare nella tray
```

- Checkbox list di tutti i progetti registrati (letta da `~/.ucm/template.json`)
- **Default**: tutti spuntati
- Deselezionando un progetto → non appare nel sottomenu Projects della tray
- I progetti non registrati non appaiono nella lista (vengono aggiunti/rimossi automaticamente quando si aggiunge/rimuove un progetto in Project tab)

**Storage**: nuovo campo `tray_projects: string[]` (array di UUID) in `~/.ucm/settings.json`. Se assente o vuoto → tutti i progetti visibili (comportamento default).

---

## Storage

### `~/.ucm/settings.json` (modificato)

```json
{
  "last_spawn_paths": { "claude": "C:\\path", ... },
  "close_to_tray": true,
  "tray_projects": ["uuid-1", "uuid-2"]   // UUID dei progetti da mostrare nel tray
}
```

- `tray_projects` è **source of truth** per il tray
- Se campo assente → tutti i progetti (`projects: []` in template.json)

### `~/.ucm/template.json` (letto)

```json
{
  "mcp": { ... },
  "agents": { ... },
  "skills": { ... },
  "character": { ... },
  "projects": [
    { "id": "uuid-1", "name": "my-project", "path": "C:\\..." },
    { "id": "uuid-2", "name": "altro", "path": "D:\\..." }
  ]
}
```

I progetti non sono duplicati: `settings.json` contiene solo gli UUID selezionati per il tray.

---

## Componenti da modificare

### Backend Rust (`src-tauri/src/tray.rs`)

1. **Nuovo campo in `Settings`**:
   ```rust
   tray_projects: Vec<String>   // UUID dei progetti da mostrare
   ```

2. **Nuovi metodi in `Settings`**:
   - `get_tray_projects() -> Vec<String>` — restituisce UUID da mostrare (o tutti se vuoto)
   - `set_tray_projects(uuids: Vec<String>)`
   - `toggle_tray_project(uuid, enabled: bool)` — aggiunge/rimuove UUID

3. **Nuovo comando Tauri** `get_tray_projects_setting`:
   - Restituisce `Vec<String>` (UUID dei progetti nel tray)
   - Frontend lo usa per pre-selezionare i checkbox

4. **Nuovo comando Tauri** `set_tray_projects`:
   - Accetta `Vec<String>` (UUID) e salva in `settings.json`

5. **Nuovo comando Tauri** `get_all_projects`:
   - Legge `template.json` e restituisce `Vec<{id, name, path}>`
   - Serve alla scheda Settings per popolare la lista checkbox

6. **Menu tray riscritto**:
   - Legge i progetti da `template.json`
   - Filtra con `tray_projects` da `settings.json`
   - Costruisce sottomenu "Projects" con voci dinamiche
   - Ogni sottocomando ha id: `project_<uuid>_spawn_<cli_id>`

7. **Handler eventi menu**:
   - Match su `id.starts_with("project_")` → estrae `uuid` e `cli_id`
   - Chiama `spawn_cli(cli_id, project_path)` direttamente (no directory picker)

### Frontend React

1. **`TabSettings.jsx`** — nuova sezione "Projects in tray":
   - Chiama `get_all_projects` per avere l'elenco
   - Chiama `get_tray_projects_setting` per avere gli UUID selezionati
   - Renderizza checkbox list
   - Su toggle → chiama `set_tray_projects` con la lista aggiornata
   - Binding bidirezionale con `closeToTray` esistente

2. **`App.jsx`** — nessuna modifica necessaria (già passa `closeToTray`)

---

## Flusso completo

### Apertura app
1. `lib.rs::setup()` chiama `setup_tray()`
2. `setup_tray()` legge `template.json` → ottiene lista progetti
3. `setup_tray()` legge `settings.json` → ottiene `tray_projects`
4. Se `tray_projects` è vuoto → tutti i progetti; altrimenti solo quelli con UUID in lista
5. Costruisce menu con sottomenu "Projects" dinamico

### Click su sottocomando tray
1. `on_menu_event` riceve id `project_<uuid>_spawn_<cli_id>`
2. Estrae `uuid` e `cli_id`
3. Cerca il `path` del progetto da `template.json` (in memoria o riletto)
4. Chiama `spawn_cli(cli_id, path)` direttamente

### Modifica checkbox in Settings
1. Utente toggle checkbox progetto
2. Frontend → `set_tray_projects([uuid1, uuid2])`
3. Backend aggiorna `settings.json`
4. **Ricarica menu tray** — il tray deve essere ricostruito per riflettere il cambiamento
   - Soluzione: comando `refresh_tray_menu` che ri-chiama `setup_tray()` o equivalente

### Ricarica menu tray dinamico
- `setup_tray()` viene chiamato solo all'avvio
- Per ricaricare: Tauri non ha API nativa per rimuovere/ricreare menu a runtime
- **Workaround**: quando cambia `tray_projects`, ricostruire il menu tray via `app.set_tray_menu()` (se supportato) oppure ricaricare l'intera tray icon
- Alternativa semplice: alla modifica dei settings, emettere un evento al frontend che dice "reload tray" e il backend ricostruisce e sostituisce il menu

---

## Edge case

- **Nessun progetto registrato**: sottomenu "Projects" mostra una sola voce disabilitata "Nessun progetto"
- **Tutti i progetti deselezionati**: sottomenu "Projects" mostra "Nessun progetto" (comportamento identico)
- **Progetto rimosso da Project tab**: se il suo UUID non è più in `template.json`, viene ignorato nella tray anche se è in `tray_projects`
- **CLI non installata**: il sottocomando "Spawn <CLI>" è comunque visibile (la CLI potrebbe essere installata in seguito)

---

## Non scope

- Directory picker dalla tray (si usa il path già registrato nel progetto)
- Modifica progetti dalla tray
- Sottomenu "hover" (non supportato bene su Windows tray)
