# Development, Build, and Release

## Purpose

This document describes the local development workflow, release build workflow, and GitHub Actions release path for Port Scanner.

Port Scanner is a macOS-only Tauri 2 desktop app. The frontend is built with Vite, React 19, and TypeScript. The backend is a Rust crate under `src-tauri/`.

## Local prerequisites

Use the versions and tools expected by the repository:

- macOS 11 Big Sur or newer.
- Node.js 22+ and npm.
- Rust stable from rustup.
- The pinned Rust toolchain from `rust-toolchain.toml`: Rust `1.90.0` with `rustfmt` and `clippy`.
- Xcode Command Line Tools for macOS build tooling.

## Local development flow

From a fresh checkout:

```bash
git clone https://github.com/g-baskin/port-scanner.git
cd port-scanner
npm install
npm run tauri dev
```

The Tauri dev shell runs the frontend through Vite. `src-tauri/tauri.conf.json` configures:

- `beforeDevCommand`: `npm run dev`
- `devUrl`: `http://localhost:1420`
- `beforeBuildCommand`: `npm run build`
- `frontendDist`: `../dist`

`src/main.tsx` mounts the React app, and `src-tauri/src/main.rs` starts the Rust/Tauri runtime through `kill_ports_lib::run()`.

## Local frontend-only commands

`package.json` defines:

| Script | Behavior |
|---|---|
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Run `tsc` and then `vite build`, writing frontend assets to `dist/`. |
| `npm run preview` | Preview the built Vite frontend. |
| `npm run tauri` | Pass through to the Tauri CLI. |
| `npm run check` | Run frontend build and Rust quality gates. |
| `npm run check:rust` | Run Rust format check, Clippy with warnings denied, and Rust tests. |

## Local release build

Build the macOS `.app` bundle with:

```bash
npm run tauri build
```

The current Tauri bundle target is only `app`, so local builds produce a `.app` bundle rather than a `.dmg`.

Expected bundle path:

```text
src-tauri/target/release/bundle/macos/PORT SCANNER - created by @g-baskin.app
```

The product name comes from `src-tauri/tauri.conf.json`.

If an environment sets `CI=1` and Tauri CLI behavior changes, the README recommends unsetting CI:

```bash
env -u CI npm run tauri build
```

The GitHub Actions workflows set `CI: false` for the Tauri build step for this reason.

## macOS architecture support

The README documents support for:

- Apple Silicon through native ARM builds or Rust's `aarch64-apple-darwin` target.
- Intel Macs through `x86_64-apple-darwin`.
- Optional universal binaries by building each architecture and merging with `lipo`.

The current CI uses `macos-14` and produces an artifact matching the runner's native architecture. Universal build automation is not currently implemented.

## GitHub Actions build workflow

`.github/workflows/build-macos.yml` runs on:

- Pushes to `main`.
- Pull requests targeting `main`.
- Manual `workflow_dispatch`.

The workflow runs on `macos-14` and performs:

1. Checkout with `actions/checkout@v4`.
2. Node setup with `actions/setup-node@v4`, Node `22`, and npm cache.
3. Rust setup through `rustup show`, relying on `rust-toolchain.toml`.
4. Dependency install with `npm ci`.
5. Rust format check.
6. Rust Clippy with `-D warnings`.
7. Rust tests.
8. Frontend build with `npm run build`.
9. Tauri release build with `CI: false`.
10. Upload of `src-tauri/target/release/bundle/macos/*.app` as artifact `port-scanner-macos-app`.

## GitHub Actions release workflow

`.github/workflows/release-macos.yml` runs when a tag matching `v*` is pushed.

The release workflow grants `contents: write` and runs the same quality/build gates as the build workflow. After building the `.app`, it:

1. Changes into `src-tauri/target/release/bundle/macos`.
2. Zips `PORT SCANNER - created by @g-baskin.app` into `PortScanner-macos.zip`.
3. Publishes a GitHub Release using `softprops/action-gh-release@v2`.
4. Attaches `PortScanner-macos.zip` and generates release notes.

Create a release with:

```bash
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

Use a new version tag for each release.

## Signing and notarization status

Current builds are not code-signed or notarized. The README notes that unsigned downloaded builds can trigger Gatekeeper warnings.

Future trusted distribution should add Apple Developer Program credentials and Tauri signing/notarization environment variables through local configuration or encrypted GitHub Actions secrets.

## Generated artifact policy

Generated build artifacts are intentionally not committed:

- `dist/`
- `src-tauri/target/`
- `src-tauri/gen/`
- `.app` bundles
- release zip outputs

Installable builds should be shared through GitHub Release assets or workflow artifacts, not the git tree.

## Source references

- `README.md`
- `STATUS.md`
- `package.json`
- `rust-toolchain.toml`
- `src-tauri/tauri.conf.json`
- `.github/workflows/build-macos.yml`
- `.github/workflows/release-macos.yml`
