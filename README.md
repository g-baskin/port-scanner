# Port Scanner

A lightweight **macOS** desktop app to scan TCP listeners, see bind addresses and uptime, open `http://localhost:{port}` in your browser, and kill processes when you need a clean slate. Built with **Tauri 2**, **Vite**, **React**, and **TypeScript**.

![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)

## macOS compatibility (Apple Silicon & Intel)

- **Apple Silicon (M1 / M2 / M3 / M4 and newer)** — fully supported. Build natively on an ARM Mac, or use Rust’s `aarch64-apple-darwin` target.
- **Intel Macs** — supported via `x86_64-apple-darwin`.
- **macOS version** — targets **macOS 11 (Big Sur)** and newer (Tauri 2 baseline). Use the latest Xcode Command Line Tools for best results.

Install Rust via [rustup](https://rustup.rs/) and select the default toolchain for your Mac; it will use the correct architecture automatically.

### Optional: Universal macOS binary

To ship one `.app` that runs on both ARM and Intel, build each architecture and merge with `lipo` (or use a CI matrix). Example outline:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
# Build each target with npm run tauri build -- --target <triple>
# Then combine the main binaries with lipo into a single bundle (see Tauri docs on universal builds).
```

For day-to-day use, a single-architecture build on your machine is enough.

## Requirements

- [Rust](https://rustup.rs/) (stable)
- **Node.js 18+** and **npm**

## Development

```bash
git clone https://github.com/g-baskin/port-scanner.git
cd port-scanner
npm install
npm run tauri dev
```

The UI loads from the Vite dev server (port **1420**); Tauri opens the native window.

> **CI tip:** Some environments set `CI=1`, which can break `tauri build`. If you see an invalid `--ci` error, run:  
> `env -u CI npm run tauri build`

## Build (release `.app`)

```bash
npm run tauri build
```

Output (typical):

- `src-tauri/target/release/bundle/macos/PORT SCANNER - created by @g-baskin.app` (name follows `productName` in `tauri.conf.json`)

Copy the `.app` to `/Applications` or the Desktop. If Gatekeeper complains, right-click → **Open** once.

## Features

| Feature | Description |
|--------|-------------|
| **Dashboard** | Open ports count, unique PIDs, average / longest / newest uptime |
| **Chart** | Relative uptime bars per listener (collapsible) |
| **Sortable columns** | Click headers to sort (Excel-style), toggle ascending / descending |
| **Filter** | Search box narrows rows by name, PID, port, bind, project, uptime |
| **Protect** | 🛡 per row — blocked from Kill (stored in localStorage) |
| **Kill confirm** | Modal before SIGKILL; optional **Skip** in ⚙ Settings |
| **Copy** | ⧉ copies open URL + row fields (tab-separated) |
| **Open in browser** | Respects **http/https** and optional **path** (⚙ Settings) |
| **Auto-refresh** | Toolbar: off / 5s / 10s / 30s + **Pause** |
| **Export** | **CSV** / **JSON** of the current (filtered) table |
| **Bound to** | Human-readable bind, e.g. `localhost:3001` vs `0.0.0.0:3001` |
| **Kill** | `kill -9` with PID allowlist from the last scan |
| **Scan as Admin** | Optional `osascript` elevation for a fuller `lsof` view |
| **Repo link** | Click **@g-baskin** in the title bar to open this GitHub repository in your browser |

---

## User documentation

### Layout

| Area | Purpose |
|------|---------|
| **Title bar** | App name, **@g-baskin** link to the source repo, **admin** badge when the last scan used elevation |
| **Header actions** | **⚙ Settings**, **↻ Refresh**, **Scan as Admin** |
| **Stats strip** | Live counts: open ports, unique processes, average / longest / newest uptime |
| **Toolbar** (when listeners exist) | **Filter** box, **Auto** refresh interval, **Pause**, **CSV** / **JSON** export |
| **Uptime chart** | Collapsible bar chart (longest uptime first); click the section header to expand/collapse |
| **Table** | One row per TCP listener; sortable columns; per-row actions |
| **Footer** | Total listeners (or “showing X of Y” when filtered), admin/auto-refresh hints |

### Sorting

Click any sortable column header (**Process**, **PID**, **Port**, **Bound to**, **Open**). The first click sorts ascending; clicking the **same** column again reverses to descending. A new column always starts ascending. The active column shows **▲** or **▼**.

### Filter

Type in **Filter by name, PID, port, bind…** to hide non-matching rows. Matching is case-insensitive and checks process name, PID, port, human-readable bind, raw address, project folder name, and uptime text. **Export** (CSV/JSON) exports **only the rows you see** after filtering.

### Protect (🛡)

The first column toggles protection for that **exact listener** (PID + port + bind). When 🛡 is on, **Kill** is disabled for that row (shows **—**). Protected row keys are saved in the browser’s **localStorage** under the key `port-scanner-settings-v1` (see **Settings & persistence** below) so they survive app restarts.

### Kill & confirmation

**Kill** sends `kill -9` to the process PID (only if it appeared in the latest scan). A **confirmation modal** appears unless you enable **Skip kill confirmation** in ⚙ Settings. **Cancel** closes the dialog; **Kill** proceeds.

### Copy (⧉)

Copies one **tab-separated** line to the clipboard: open URL (respecting Settings), process name, PID, port, and human-readable bind. Useful for pasting into notes, tickets, or spreadsheets.

### Open in browser (↗)

Opens the configured URL for that row’s port: `{scheme}://localhost:{port}{optionalPath}`. Defaults to `http://localhost:{port}`. Change scheme and path in ⚙ Settings.

### Settings (⚙)

| Option | Effect |
|--------|--------|
| **Open in browser** | `http://` or `https://` |
| **URL path after port** | Optional suffix, e.g. `/` or `/dashboard` (leading `/` added if omitted) |
| **Skip kill confirmation** | If checked, **Kill** runs immediately with no modal |

### Settings & persistence

Preferences and protected rows are stored locally in **localStorage** as JSON:

- **Key:** `port-scanner-settings-v1`
- **Fields:** `protectedRowKeys` (string array), `openScheme`, `openPath`, `autoRefreshSec`, `skipKillConfirm`

Clearing site data for the app removes these. They are **not** synced to GitHub or any server.

### Auto-refresh

Choose **Off**, **5s**, **10s**, or **30s**. When enabled, the app re-runs a normal scan on that interval **without** clearing per-row kill state. Use **Pause** to suspend auto-refresh temporarily. The footer shows `auto Ns` when auto-refresh is on and not paused.

### Export

- **CSV** — Header row plus one row per visible listener (name, pid, port, bound, raw address, uptime, project, cwd).
- **JSON** — Array of objects for the same visible rows.

Files download with a timestamp in the filename.

### Scanning & killing (technical)

- Default scan: `lsof -n -P -iTCP -sTCP:LISTEN`
- **Scan as Admin**: same command via AppleScript **with administrator privileges** (password prompt).
- **Kill** only allows PIDs that appeared in the **most recent** scan (allowlist in the Rust backend).

---

### GitHub Actions (CI)

On every push to `main`, [.github/workflows/build-macos.yml](.github/workflows/build-macos.yml):

1. Checks out the repo on **macOS** (GitHub-hosted runner).
2. Installs Node **22**, Rust stable, runs `npm ci`, `npm run build`, then `npm run tauri build` with **`CI`** unset (`CI: false`) so the Tauri CLI does not mis-parse flags.
3. Uploads the built **`.app`** from `src-tauri/target/release/bundle/macos/` as a workflow **artifact** named `port-scanner-macos-app`.

The artifact matches the **native architecture of the runner** (e.g. Apple Silicon on current `macos-latest`). It is **not** code-signed or notarized unless you add secrets and steps yourself.

### Distribution & code signing (macOS)

Unsigned builds trigger **Gatekeeper** warnings for downloaders. To ship a broadly trusted `.app`:

1. Enroll in the **Apple Developer Program**.
2. In Xcode, create a **Developer ID Application** certificate.
3. Set Tauri signing environment variables (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) and follow [Tauri v2 — macOS code signing](https://v2.tauri.app/distribute/sign/macos/) for signing and notarization.

This repository does **not** contain signing certificates or passwords; configure them locally or as **encrypted GitHub Actions secrets** if you extend the workflow.

---

## Windows

**Not supported.** The Rust backend uses macOS-only tools (`lsof`, `osascript`, `/bin/kill`, `open`). A future Windows build would need alternate implementations (e.g. `netstat` / Win APIs) behind the same Tauri commands. Contributions welcome.

## License — GPL-3.0

This project is licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE).

In short:

- You may **use, modify, and sell** binaries or services based on this code.
- If you **distribute** a modified version, you must **share the corresponding source** under GPL-3.0 with recipients and **keep copyright and license notices** (including [NOTICE](NOTICE)).
- There is no requirement to send pull requests to this repository, but you **must not** withhold the source from people who receive your version.

This is not legal advice; read the full license text.

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first so we can align on approach (especially for Windows support).
