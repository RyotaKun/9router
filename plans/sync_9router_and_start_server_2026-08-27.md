# Plan: Sync Latest Upstream Changes and Start 9Router Dashboard

**Date:** 2026-08-27
**Target Model:** base (Gemini 3.7 Flash)
**Status:** Ready to Execute

---

## Brief

9Router repository synchronized with upstream `decolua/9router` on master, dependencies cleanly installed, and the local web dashboard and proxy server actively running and responding on port 20128.

---

## Stack

- Next.js 16.1.6
- React 19.2.4
- Node.js v25.2.1
- npm 11.6.2
- Express 5.2.1
- better-sqlite3 / sql.js
- Git 2.52.0

---

## Scope — Visuals

- Dashboard landing and login interface accessible at `http://localhost:20128/login` with dark theme styling and form inputs.
- Web dashboard top navigation and status indicators showing local 9Router runtime state.

---

## Scope — Functionality

1. Verify git remotes and configure `upstream` pointing to `https://github.com/decolua/9router` if not already present.
2. Fetch latest commits from `upstream/master` and fast-forward or merge cleanly into local `master`.
3. Push synchronized `master` branch to `origin` (`https://github.com/RyotaKun/9router`).
4. Install npm dependencies cleanly via `npm install` (with automatic `sql.js` fallback if native `better-sqlite3` build is skipped on Windows).
5. Ensure a valid `.env` configuration file exists based on `.env.example` with local development defaults (`PORT=20128`, `JWT_SECRET`, `INITIAL_PASSWORD`, `DATA_DIR`).
6. Launch the local dev/dashboard server (`npm run dev`) as a background task bound to port `20128`.
7. Verify that API health/version endpoints (`/api/version`) and dashboard UI routes (`/login`) respond with HTTP status 200.

---

## Out of Scope

- Modifying upstream routing logic, RTK compression algorithms, or adding new external AI provider integrations.
- Production container deployment with Docker or cloud sync publishing to `9router.com`.

---

## Constraints

- **Non-destructive git workflow**: Review `git status --porcelain` before pull/merge; no `git reset --hard` or unbacked-up stashes.
- **Single-path git flow**: Synchronize from `upstream/master` -> local `master` -> `origin/master`.
- **Port invariant**: Server must bind to local port `20128` without conflicting with existing services.
- **Resilient SQLite runtime**: Allow `sql.js` runtime fallback if `better-sqlite3` native build is unavailable on Windows.
- **Environment protection**: Keep `.env` local and gitignored (`.gitignore` must contain `.env` and `data/`).

---

## Definition of Done

9router is synchronized with upstream decolua/9router master, dependencies are installed, and the local server on port 20128 responds with HTTP 200 on /api/version and /login.

---

## Acceptance Criteria

- **AC-1:** Git remote `upstream` is configured to `https://github.com/decolua/9router` and local `master` is synchronized to latest upstream HEAD.
- **AC-2:** Updated `master` is pushed to `origin/master` (`RyotaKun/9router`).
- **AC-3:** `npm install` completes successfully without unhandled fatal errors.
- **AC-4:** Local `.env` exists with required keys (`PORT=20128`, `JWT_SECRET`, `INITIAL_PASSWORD`, `DATA_DIR`).
- **AC-5:** Local server process starts and listens on TCP port `20128`.
- **AC-6:** HTTP GET request to `http://localhost:20128/api/version` returns status 200 with valid JSON response.
- **AC-7:** HTTP GET request to `http://localhost:20128/login` returns status 200 with rendered dashboard HTML.

---

## Verification

```powershell
# 1. Verify git remotes and recent commits
git remote -v
git log -n 3 --oneline

# 2. Verify port listening
Get-NetTCPConnection -LocalPort 20128 -State Listen

# 3. Verify version API
Invoke-RestMethod -Uri "http://localhost:20128/api/version" -Method Get

# 4. Verify login page HTML response
(Invoke-WebRequest -Uri "http://localhost:20128/login" -Method Get).StatusCode
```

---

## Turn Budget

20 turns

---

## References

- Repository: `C:\repos\ryo_claude\ryo-9router\9router`
- Upstream: https://github.com/decolua/9router
- Fork Remote: https://github.com/RyotaKun/9router