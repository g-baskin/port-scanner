# Testing and Quality Gates

## Purpose

This document records the quality gates currently encoded in Port Scanner for local development and GitHub Actions.

The repository has frontend build checks, Rust formatting, Rust linting, and Rust unit tests. It does not currently include browser end-to-end tests or React component tests.

## One-command local gate

Before submitting changes, run:

```bash
npm run check
```

`package.json` expands this to:

```bash
npm run build && npm run check:rust
```

`npm run check:rust` expands to:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check && \
  cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && \
  cargo test --manifest-path src-tauri/Cargo.toml
```

## Frontend build gate

`npm run build` runs:

```bash
tsc && vite build
```

This gate verifies:

- TypeScript compilation for the React frontend.
- Vite production asset build into `dist/`.
- Frontend imports and package compatibility at build time.

Important frontend source files covered by this gate include:

- `src/main.tsx`
- `src/App.tsx`
- `src/prefs.ts`
- `src/App.css`

## Rust formatting gate

Rust formatting is checked with:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

This checks formatting for the Tauri Rust crate without mutating files.

## Rust lint gate

Rust linting is checked with:

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Warnings are denied, so new Clippy warnings fail the gate.

## Rust unit tests

Rust tests are run with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Current unit tests in `src-tauri/src/lib.rs` cover:

- `parse_lsof_extracts_and_sorts_unique_listeners`
  - Verifies `lsof` listener parsing, duplicate suppression, bad PID handling, and numeric port sorting.
- `parse_cwds_maps_pid_to_non_root_working_directory`
  - Verifies cwd parser behavior and root path skipping.
- `format_etime_returns_compact_human_labels`
  - Verifies compact uptime labels for `ps` `etime` formats.
- `parse_processes_preserves_command_and_derives_name`
  - Verifies process parsing, full command preservation, process name derivation, and uptime formatting.

## CI parity

`.github/workflows/build-macos.yml` and `.github/workflows/release-macos.yml` run the same core gates:

1. `npm ci`
2. `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
3. `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
4. `cargo test --manifest-path src-tauri/Cargo.toml`
5. `npm run build`
6. `npm run tauri build` with `CI: false`

The build workflow uploads a `.app` artifact. The release workflow zips the `.app` and publishes it on tag pushes matching `v*`.

## Manual smoke checks

After changes that affect runtime behavior, perform a local Tauri smoke check:

```bash
npm run tauri dev
```

Confirm the relevant changed path:

- Ports view scans listeners and row actions work.
- Processes view loads process rows and listener address enrichment.
- System view loads memory/disk metrics and process counts.
- Settings persist after closing/reopening the window.
- CSV/JSON exports contain the currently filtered rows.
- Kill confirmation appears unless skipped in settings.
- Admin scan prompts for administrator privileges and handles cancellation.

## Known gaps

- No automated React component tests are currently configured.
- No end-to-end Tauri UI test suite is currently configured.
- No cross-platform backend tests exist because the backend is macOS-specific.
- CI artifacts are not signed or notarized.

`STATUS.md` recommends adding end-to-end UI coverage only if the app grows beyond its current local utility scope.

## Source references

- `package.json`
- `src-tauri/src/lib.rs`
- `.github/workflows/build-macos.yml`
- `.github/workflows/release-macos.yml`
- `README.md`
- `STATUS.md`
