# Port Scanner User Guide

## What Port Scanner does

Port Scanner is a macOS desktop app for local development and troubleshooting.

Use it to:

- See TCP ports currently listening on your Mac.
- Inspect running processes.
- Check memory and disk telemetry.
- Open `localhost` services in your browser.
- Copy or export filtered rows.
- Kill scanned processes when you need to clear a stuck local service.

Port Scanner runs locally. It is built as a Tauri `.app` bundle.

## Main layout

| Area | Purpose |
|---|---|
| Title/header | Shows app status, the GitHub repo link, local weather panel, settings, refresh, and admin scan. |
| Dashboard | Shows active mode, scan health, auto-refresh state, and summary stats. |
| Toolbar | Switches views, filters rows, controls auto-refresh, pauses auto-refresh, and exports CSV/JSON. |
| MFD panels | Compact side-by-side lists for ports and processes. |
| Table | Detailed rows for the selected view. |
| Footer | Current row counts, scan status, admin scan state, and auto-refresh state. |

## Ports view

Ports is the default view.

It shows one row per detected TCP listener with:

- Process name.
- PID.
- Port.
- Human-readable bind address.
- Uptime.
- Project folder and command when available.
- Copy, open, protect, and kill actions.

The backend scans with:

```bash
lsof -n -P -iTCP -sTCP:LISTEN
```

### Open a local service

Click the open action to launch:

```text
{scheme}://localhost:{port}{optionalPath}
```

The default is:

```text
http://localhost:{port}
```

Change scheme and path in Settings.

### Protect a listener

Click the shield column to protect a listener row.

Protected listener rows cannot be killed from the UI. Protection is saved locally for that exact PID, port, and bind address.

## Processes view

Processes shows running processes with:

- Process name.
- PID.
- Command line.
- Uptime.
- Project folder when available.
- Listener addresses when the process owns listening TCP ports.
- Copy and kill actions.

This view is useful when you know the process but not the port.

## System view

System shows:

- Memory usage and available memory.
- Root disk usage and free space.
- Total process count.
- Count of processes listening on TCP ports.

System export includes metrics plus visible process rows.

## Filter rows

Use the toolbar filter to narrow visible rows.

Filtering is case-insensitive and supports terms such as:

- Process name.
- `pid:123`.
- `port:3000`.
- Bind address such as `localhost` or `0.0.0.0`.
- Command text.
- Project folder.
- CWD path.
- Uptime.

Exports include only rows currently visible after filtering.

## Sort rows

Click a sortable table header to sort.

Ports view sortable columns:

- Process.
- PID.
- Port.
- Bound to.
- Open/uptime.

Processes view sortable columns:

- Process.
- PID.
- Command.
- Open/uptime.
- Listeners.

Click the active sort column again to reverse direction.

## Copy rows

Copy actions write tab-separated text to your clipboard.

Ports copy includes:

- Open URL.
- Process name.
- PID.
- Port.
- Bind address.
- Command when available.

Processes copy includes:

- Process name.
- PID.
- Uptime.
- Project.
- Listener addresses.
- Command.

## Export data

Use CSV or JSON in the toolbar.

Export behavior:

- Ports export: visible listener rows.
- Processes export: visible process rows.
- System export: system metrics plus visible process rows.

Filenames include the view name and a timestamp.

## Auto-refresh

Choose an auto-refresh interval in the toolbar:

- Off.
- 5 seconds.
- 10 seconds.
- 30 seconds.

Use Pause to temporarily stop auto-refresh without changing the saved interval.

## Settings

Open Settings from the header.

Available settings:

| Setting | Effect |
|---|---|
| Open in browser | Choose `http://` or `https://`. |
| URL path after port | Add a path such as `/` or `/dashboard`. A leading slash is added automatically when needed. |
| Skip kill confirmation dialog | If enabled, Kill runs immediately without the confirmation modal. |

Settings are stored locally in the app WebView's localStorage.

## Kill a process

Kill sends SIGKILL to a scanned PID.

Default flow:

1. Click Kill on a listener or process row.
2. Review the confirmation modal.
3. Click Cancel to stop, or Kill to proceed.
4. On success, the row is removed after a short delay.

Safety controls:

- Kill confirmation is enabled by default.
- Protected listener rows cannot be killed.
- The backend only kills PIDs seen in the latest backend scan.
- A kill can still fail if the process requires elevated privileges.

Use Kill only for processes you recognize. `kill -9` is forceful and can cause unsaved work in the target process to be lost.

## Scan as Admin

Admin Sweep applies to the Ports view.

It uses AppleScript to run the listener scan with administrator privileges. macOS prompts for an administrator password.

Use admin scan when a normal scan may not show enough listener detail.

If you cancel the prompt, the app shows an error and continues running.

## Local weather panel

The header includes an optional local weather panel.

When enabled, it may request geolocation permission. If geolocation is unavailable or denied, it can fall back to approximate IP location and then fetch current weather.

Weather data is separate from port/process scanning. Port/process data is not sent to weather services by the inspected code.

## Installing from a GitHub Release

For shared installs:

1. Open the repository Releases page.
2. Download `PortScanner-macos.zip` from the latest release.
3. Unzip it.
4. Drag `PORT SCANNER - created by @g-baskin.app` into Applications.

Unsigned builds may trigger a Gatekeeper warning. Right-click and choose Open once if macOS blocks a trusted local build.

## Local persistence

The app stores local settings under:

```text
port-scanner-settings-v1
```

Weather cache uses:

```text
port-scanner-weather-v1
```

Clearing local app/site data removes these values.
