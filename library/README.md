# Port Scanner Library

This `library/` directory is the tracked documentation home for the Port Scanner repository using Library Guardian schema v2.

Port Scanner is a macOS desktop utility built with Tauri 2, Vite, React 19, TypeScript, and Rust. It scans TCP listeners, lists running processes, displays system memory and disk metrics, exports filtered data, opens local services in the default browser, and can kill PIDs that were observed in the most recent backend scan.

## Documentation map

### Private knowledge

- [System overview](knowledge/private/system/overview.md) — product scope, runtime shape, source map, and operating assumptions.
- [Frontend architecture](knowledge/private/architecture/frontend-architecture.md) — React entrypoint, state model, views, persistence, exports, and UI styling.
- [Tauri backend architecture](knowledge/private/architecture/tauri-backend-architecture.md) — Rust command surface, macOS command integration, parsing, enrichment, and PID allowlist.
- [Data flow and trust boundaries](knowledge/private/architecture/data-flow-and-trust-boundaries.md) — frontend/backend/system/browser/network boundaries and sensitive operations.
- [Development, build, and release](knowledge/private/operations/development-build-release.md) — local setup, build outputs, CI, release workflow, and distribution notes.
- [Testing and quality gates](knowledge/private/operations/testing-and-quality-gates.md) — local and GitHub Actions gates.

### Public knowledge

- [Port Scanner user guide](knowledge/public/user-guide/port-scanner-user-guide.md) — end-user operating guide for views, filtering, exports, settings, admin scan, and kill behavior.

### Reports

- [Library wiki initialization report](requirements/reports/2026-06-28-library-wiki-initialization-report.md) — initial tracked docs generation report.

## Schema v2 notes

This repository intentionally uses schema v2 paths:

- `library/knowledge/public/` for user-facing documentation.
- `library/knowledge/private/` for internal engineering and operations documentation.
- `library/requirements/reports/` for this initialization report.

No PRD or IRD folders were created by this initialization pass.

## Generated/local wiki note

`library/knowledge-base/wiki/` is a generated/local wiki location and is currently ignored. Tracked Library Guardian documentation should be authored in the schema v2 paths above, not in `library/knowledge-base/wiki/`.
