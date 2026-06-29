# Tauri Backend Architecture

## Overview

The backend is a Rust Tauri command layer in `src-tauri/src/lib.rs`. The binary entrypoint in `src-tauri/src/main.rs` calls `kill_ports_lib::run()`, which builds the Tauri application, registers the opener plugin, manages shared PID state, and exposes command handlers to the frontend.

The backend is macOS-specific. It shells out to native macOS/Unix tools rather than using cross-platform process APIs.

## Registered command surface

`run()` registers these commands:

| Command | Purpose | Primary system tools |
|---|---|---|
| `list_listeners` | Return TCP listener rows enriched with cwd, project, uptime, and command line. | `lsof`, `ps` |
| `list_listeners_admin` | Return TCP listener rows from elevated `lsof`. | `osascript`, `lsof`, `ps` |
| `list_processes` | Return running process rows enriched with listener addresses and selected cwd/project values. | `ps`, `lsof` |
| `get_system_metrics` | Return memory and root disk metrics. | `sysctl`, `vm_stat`, `df` |
| `kill_pid` | Kill an allowlisted PID with SIGKILL. | `/bin/kill -9` |
| `open_url` | Open a URL in the default macOS browser/app handler. | `open` |

## Shared backend state

The backend manages one piece of shared state:

```rust
pub struct KnownPids(Mutex<HashSet<u32>>);
```

`KnownPids` is updated after listener and process scans. `kill_pid` checks this allowlist before spawning `/bin/kill -9`. This prevents the frontend from sending an arbitrary PID that was not present in the latest backend scan.

## Listener scan pipeline

```mermaid
flowchart TD
  A[list_listeners] --> B[lsof -n -P -iTCP -sTCP:LISTEN]
  B --> C[parse_lsof]
  C --> D[get_cwds_chunked via lsof -Fn -d cwd -p]
  C --> E[get_uptimes via ps -ax -o pid=,etime=]
  C --> F[get_commands via ps -axww -o pid=,command=]
  D --> G[attach_cwds]
  E --> H[attach_uptimes]
  F --> I[attach_commands]
  I --> J[update KnownPids]
  J --> K[return PortProcess[]]
```

`parse_lsof` expects normal `lsof` output with `COMMAND`, `PID`, and `NAME` columns and extracts the command name, PID, raw address, and port. It de-duplicates rows by `(pid, port, address)` and sorts numerically by port.

The admin scan uses AppleScript:

```applescript
do shell script "lsof -n -P -iTCP -sTCP:LISTEN" with administrator privileges
```

If the admin prompt is cancelled or fails, `list_listeners_admin` returns an error string to the frontend. After elevated `lsof`, cwd lookup still runs as the current user, so some system PIDs may not receive project labels.

## Process scan pipeline

`list_processes` runs:

```bash
ps -axww -o pid=,etime=,command=
```

It parses each row into `RunningProcess`, deriving the display process name from the command's first token. Then it calls `attach_listener_addresses`, which runs `lsof -n -P -iTCP -sTCP:LISTEN`, parses listeners, groups listener addresses by PID, and attaches sorted/deduplicated listener addresses to matching processes.

CWD lookup is selective to reduce overhead. `needs_cwd_lookup` returns true for processes that own listener addresses or whose names match likely development runtimes/tools such as `node`, `bun`, `deno`, `npm`, `pnpm`, `yarn`, `vite`, `python`, `python3`, `uvicorn`, `ruby`, `rails`, or `cargo`.

## System metrics pipeline

`get_system_metrics` returns:

- Memory metrics from `sysctl -n hw.memsize` and `vm_stat`.
- Disk metrics from `df -k /`.
- `process_count: 0` and `listening_process_count: 0` as placeholders.

The frontend fills the process counts from the concurrently fetched process list to avoid a duplicate listener scan.

Memory availability is calculated from free, inactive, and speculative pages multiplied by the detected page size. Disk values are parsed from the root filesystem `df` output and converted from KiB to bytes.

## Kill behavior

`kill_pid` is intentionally narrow:

1. It receives a numeric PID from the frontend.
2. It checks `KnownPids` for the PID.
3. If the PID is absent, it returns: `PID {pid} is not in the current scan — refresh and try again`.
4. If present, it runs `/bin/kill -9 <pid>`.
5. It returns success only if the command exits successfully; otherwise it reports that the process may require elevated privileges.

The frontend adds confirmation and protection controls, but the backend allowlist is the final guard against arbitrary PID termination from the WebView command bridge.

## URL opening

`open_url` shells out to macOS `open` with the full URL string produced by the frontend. The frontend currently builds open URLs as `{scheme}://localhost:{port}{optionalPath}` for listener rows and uses a fixed GitHub repository URL in the title bar.

## Backend unit tests

`src-tauri/src/lib.rs` includes unit tests for:

- Parsing and sorting unique `lsof` listener rows.
- Parsing cwd output and skipping root-only cwd values.
- Formatting `ps` `etime` values into compact labels.
- Parsing process rows while preserving full command strings and deriving display names.

## Known constraints

- The backend is macOS-only.
- Parsing assumes command output formats from macOS `lsof`, `ps`, `sysctl`, `vm_stat`, and `df`.
- Admin scan elevation is limited to listener discovery; follow-up cwd lookup still uses the current user's permissions.
- Kills use SIGKILL and cannot be undone.
- Builds are unsigned/not notarized until Apple Developer signing secrets and workflow steps are added.

## Source references

- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src/App.tsx`
- `README.md`
- `STATUS.md`
