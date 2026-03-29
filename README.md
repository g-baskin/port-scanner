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

> **Cursor / CI tip:** If `tauri build` fails with an error about `--ci`, unset `CI` first:  
> `env -u CI npm run tauri build`

## Build (release `.app`)

```bash
npm run tauri build
```

Output (typical):

- `src-tauri/target/release/bundle/macos/Port Scanner.app` (name follows `productName` in `tauri.conf.json`)

Copy the `.app` to `/Applications` or the Desktop. If Gatekeeper complains, right-click → **Open** once.

## Features

| Feature | Description |
|--------|-------------|
| **Dashboard** | Open ports count, unique PIDs, average / longest / newest uptime |
| **Chart** | Relative uptime bars per listener (collapsible) |
| **Bound to** | Human-readable bind, e.g. `localhost:3001` vs `0.0.0.0:3001` |
| **Open in browser** | Button to open `http://localhost:{port}` |
| **Kill** | `kill -9` with PID allowlist from the last scan |
| **Scan as Admin** | Optional `osascript` elevation for a fuller `lsof` view |

### Scanning & killing

- Default scan: `lsof -n -P -iTCP -sTCP:LISTEN`
- **Scan as Admin**: runs the same via AppleScript with administrator privileges (password prompt).
- **Kill** only allows PIDs seen in the latest scan.

## Windows

**Not supported yet.** The backend uses macOS-specific tools (`lsof`, `osascript`, `open`). A Windows port would use different APIs (e.g. parsing `netstat` output or Win APIs) behind the same Tauri commands. Contributions welcome.

## License — GPL-3.0

This project is licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE).

In short:

- You may **use, modify, and sell** binaries or services based on this code.
- If you **distribute** a modified version, you must **share the corresponding source** under GPL-3.0 with recipients and **keep copyright and license notices** (including [NOTICE](NOTICE)).
- There is no requirement to send pull requests to this repository, but you **must not** withhold the source from people who receive your version.

This is not legal advice; read the full license text.

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first so we can align on approach (especially for Windows support).
