---
name: commit
description: Run checks, agent code review, commit with AI message, and push
---

1. Run quality checks and fix ALL errors before continuing:
   - `npm run build`
   - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
   - `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

2. Review changes: run `git status`, `git diff --staged`, and `git diff`.

3. Fast review gate: spawn ONE subagent with the full diff. Instructions: review ONLY the diff for real bugs, regressions, leftover debug code, and unintended changes. Score each issue 0-100 confidence. Pre-existing issues and stylistic nitpicks = false positives, score low. Report ONLY issues with confidence >= 80, with file:line and a one-line fix. If none, reply `CLEAR`.

4. If CLEAR: proceed straight to step 5 and push WITHOUT asking the user anything. If issues >= 80 were reported: STOP, show the issues, and ask exactly:
   "Want me to fix this first, or commit and push anyway?
   A) Fix it first, then commit & push
   B) Commit & push anyway"
   On A: fix, re-run step 1, then continue with no re-review. On B: continue as-is.

5. Stage relevant files with `git add <specific files>`; never use `git add -A`.

6. Generate a one-line commit message that starts with a verb and is specific.

7. Commit AND push in one go without pausing:
   `git commit -m "your generated message" && git push`
