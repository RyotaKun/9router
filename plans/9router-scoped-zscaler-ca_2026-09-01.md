# Plan: Scoped Zscaler CA for the 9Router server process

> **SUPERSEDED 2026-09-01** by [`zscaler-scoped-ca-fleet_2026-09-01.md`](zscaler-scoped-ca-fleet_2026-09-01.md).
> This plan scoped 9Router only. Buzz was then reported broken from the same root cause, and the user
> required that every fix prove no service regressed — which changes the work from a two-file edit to
> a fleet fix plus a repeatable regression suite. The root-cause evidence here is still valid; the
> scope is not. Do not execute this plan.
>
> **Superseded again 2026-09-01** by [`zscaler-ca-architecture_2026-09-01.md`](zscaler-ca-architecture_2026-09-01.md),
> which **deliberately drops** this plan's per-launcher edits rather than deferring them. One global
> `NODE_EXTRA_CA_CERTS` covers every Node service and every Node version on the machine, so no launcher
> needs to change. See that plan's Finding 1 — the rule that forced per-service scoping was based on a
> misdiagnosis.

**Created:** 2026-09-01
**Runner / target model:** `claude-opus-5` (profile `opus-5`; no `--for`, so target = runner)
**Project:** C-0828-buzz (9Router is the agent-routing tier for Buzz)

---

## Investigation note — the premise is confirmed, and the cause is one layer out from the symptom

The brief reads the `502 ... UNABLE_TO_GET_ISSUER_CERT_LOCALLY` as a 9Router fault. It is not.
9Router is healthy; its **outbound fetch to the GitHub Models upstream** is what fails, because the
9Router Node process has no CA bundle in its environment. Global `NODE_EXTRA_CA_CERTS` was
deliberately cleared on 2026-08-29 (session-log Session 7) so Antigravity's Google sign-in would work,
and nothing ever gave 9Router a scoped replacement. This is the same class of regression as the Weir
AWS SSO break in Session 12, from the same root cause.

Every claim below was measured in this session (2026-09-01):

| Claim | Source |
|---|---|
| 9Router is running and serving `gh/gpt-5.6-luna` | `curl http://127.0.0.1:20128/v1/models` → 200, model listed with `contextWindow: 400000` |
| Its process is a Next.js dev server | `Win32_Process` PID 16092 → `node.exe C:\repos\ryo_claude\ryo-9router\9router\node_modules\next\dist\server\lib\start-server.js` |
| Global CA vars are empty (correct per house rule) | `SSL_CERT_FILE=[<empty>]`, `NODE_EXTRA_CA_CERTS=[<empty>]` |
| The exact reported error reproduces from a bare Node fetch | `node -e "fetch('https://models.github.ai/...')"` → `FAIL UNABLE_TO_GET_ISSUER_CERT_LOCALLY` |
| A scoped CA bundle fixes it | same command with `NODE_EXTRA_CA_CERTS=~/.certs/zscaler.pem` → `HTTP 410` (reached the server; 410 is the upstream's answer to an empty body) |
| `zscaler.pem` alone is sufficient — the 276 KB `zscaler-combined.pem` is not needed | Node **appends** `NODE_EXTRA_CA_CERTS` to its built-in Mozilla store rather than replacing it; both bundles returned `HTTP 410` (2 certs vs 139) |
| `~/.certs/zscaler.pem` is the house convention for a scoped bundle | `ryo-smart-provider-switcher/SKILL.md:113` |
| `start-9router.bat` is the single choke point for the primary start path | Startup shortcut `9Router.lnk` → `wscript.exe start-9router-silent.vbs` → `cmd /c start-9router.bat` → `npm run dev -- -p 20128` |
| The management skill has a **second**, independent start path that bypasses the `.bat` | `ryo-smart-9router-startup/scripts/manage-9router.ps1:69` — `Start-Process cmd.exe "/c cd /d $routerDir && npm run dev -- -p $port"` |

**Consequence for scope:** a fix in `start-9router.bat` alone leaves `manage-9router.ps1:69` able to
start an uncertified server, which would reproduce this exact 502 the next time the skill takes its
fallback branch. Both paths are in scope.

**`.env.local` is not a candidate.** Node reads `NODE_EXTRA_CA_CERTS` from the real process
environment at startup, before any dotenv loader runs. It must be set by the wrapper that spawns
Node, not by a file Next.js reads later.

---

## Brief

The 9Router server reaches its upstream model providers through the corporate Zscaler proxy without
any global certificate variable being set, so agent calls stop returning
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` while Antigravity's Google sign-in keeps working. This unblocks
Buzz's `@claude` and `@gh-luna-5-6` channel agents, which route entirely through 9Router.

## Stack

- Node.js v25.2.1 (`C:\nvm4w\nodejs\node.exe`)
- Next.js dev server — 9Router, `C:\repos\ryo_claude\ryo-9router\9router`, port 20128
- Windows batch (`start-9router.bat`) + VBScript (`start-9router-silent.vbs`)
- PowerShell 5.1 (`manage-9router.ps1`, 126 lines)
- CA bundle: `C:\Users\sangm\.certs\zscaler.pem` (2 certificates)
- Reasoning effort: **`medium`**. This is a small, well-specified two-file change with a measured
  root cause; `high` is not warranted. Do not disable thinking.

## Scope — Functionality

- `start-9router.bat` sets `NODE_EXTRA_CA_CERTS` to `%USERPROFILE%\.certs\zscaler.pem` for the
  spawned server only, before `npm run dev`.
- The same scoped assignment covers `manage-9router.ps1`'s direct-`npm` fallback branch (line 69),
  so no start path can produce an uncertified server.
- Absent-bundle tolerance: if `~\.certs\zscaler.pem` does not exist, the server starts with the
  environment unchanged rather than pointing Node at a missing file (Node exits on an unreadable
  `NODE_EXTRA_CA_CERTS`, so a naive assignment turns a working machine into a broken one).
- No variable is written to the user or machine environment, and no global `SSL_CERT_FILE` or
  `NODE_EXTRA_CA_CERTS` is set or restored.
- `manage-9router.ps1` reports whether the running server has the scoped CA, so a stale
  pre-fix process is distinguishable from a fixed one without reading the code.
- The 9Router skill's `SKILL.md` records the scoped-CA behaviour and the diagnostic signature
  (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` = server started without the bundle).

## Out of Scope

- The Buzz-only launcher, the Buzz relay bridge (`azure_relay_bridge.cjs`, port 3001), and the
  Antigravity ACP adapter. All three are separately tracked in `C-0828-buzz` and none is required
  to fix 9Router.
- The Weir launcher and `ryo-smart-provider-switcher`. Their scoped-AWS fix already shipped in
  Session 12 and is not touched.
- Any change to global `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS`, or to Antigravity's certificate
  path. Restoring either is explicitly forbidden.
- Migrating 9Router off `npm run dev` to a production build, or adding a service/daemon manager.
- Any in-application change to 9Router's fetch layer (a custom `undici` Agent, `rejectUnauthorized`,
  or a per-provider CA option). The per-process environment variable is the established house
  pattern and is what the probe validated.
- Renewing or re-exporting the Zscaler certificate itself.

## Constraints

- **Source traceability.** Every factual claim in any file or message this plan produces names its
  source (a file path with line number, a command's output, or a session-log entry). Do not present
  an inference as an asserted fact.
- Never set `SSL_CERT_FILE` or `NODE_EXTRA_CA_CERTS` globally, and never restore the values from
  `C:\Users\sangm\.certs\antigravity-env-backup.json`. Antigravity's Google sign-in depends on both
  staying empty (`~/.claude/CLAUDE.md`, per-app CA rule; session-log Session 7).
- The CA override must travel only with the spawned 9Router process. Do not mutate the calling shell.
- Use `~/.certs/zscaler.pem`, not `zscaler-combined.pem`. Both were measured working; the 2-cert
  bundle is the documented house convention (`ryo-smart-provider-switcher/SKILL.md:113`).
- Restarting 9Router drops any in-flight agent turn. Treat the restart as the one checkpoint in this
  plan: confirm before killing PID 16092 if agent work may be running.
- Do not edit `start-9router-silent.vbs`. It is a two-line `WshShell.Run` wrapper around the `.bat`
  and inherits the fix for free; editing it adds a second place for the CA path to go stale.
- Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and check in
  only when different readings of the request would lead to materially different work. If the request
  seems mistaken or a better approach exists, say so in a sentence and continue with the task as
  asked rather than quietly narrowing, widening, or transforming it. Finish the whole task, and stop
  short of actions that are clearly beyond what was asked.
- Match the length of written documents to what the task needs: cover the substance, but do not pad
  with filler sections, redundant summaries, or boilerplate.
- Only correct an earlier statement when the error would change the user's code, conclusions, or
  decisions. State corrections plainly and briefly, then continue the task. For slips that change
  nothing for the user, make the fix and move on without noting it.
- Before your first tool call, say in one sentence what you're about to do. While working, give a
  brief update only when you find something important or change direction. When you finish, lead with
  the outcome: your first sentence should answer "what happened" or "what did you find," with
  supporting detail after it for readers who want it.

## Definition of Done

`start-9router.bat` and `manage-9router.ps1` set `NODE_EXTRA_CA_CERTS` to `~\.certs\zscaler.pem`
for the spawned process only, global `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` are still empty, and
a restarted 9Router answers `POST /v1/chat/completions` for `gh/gpt-5.6-luna` with no
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in the response or the server log.

## Acceptance Criteria

- **AC-1** `start-9router.bat` sets `NODE_EXTRA_CA_CERTS` to the `.certs\zscaler.pem` path before
  invoking `npm run dev`, inside a `setlocal` scope.
- **AC-2** `start-9router.bat` skips the assignment when `%USERPROFILE%\.certs\zscaler.pem` does not
  exist, and still starts the server.
- **AC-3** `manage-9router.ps1`'s direct-`npm` start branch (line 69 pre-edit) applies the same
  scoped CA, so it cannot start an uncertified server.
- **AC-4** `manage-9router.ps1` prints whether the running server has the scoped CA applied.
- **AC-5** `start-9router-silent.vbs` is unchanged (`git diff --stat` shows no entry for it).
- **AC-6** No user- or machine-level environment variable was created or modified: a fresh shell
  reports `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` as empty.
- **AC-7** After a restart through `start-9router.bat`, the 9Router process environment contains
  `NODE_EXTRA_CA_CERTS` pointing at `zscaler.pem`.
- **AC-8** `POST http://127.0.0.1:20128/v1/chat/completions` with model `gh/gpt-5.6-luna` returns a
  response containing no `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` and no `502`. An upstream `401`/`403`
  is a pass — it proves TLS completed and only credentials are outstanding.
- **AC-9** `ryo-smart-9router-startup/SKILL.md` documents the scoped-CA behaviour and names
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` as the signature of a server started without the bundle.
- **AC-10** The `9Router.lnk` Startup shortcut still targets `start-9router-silent.vbs` unchanged, so
  the next Windows login inherits the fix with no further action.

## Verification

Preconditions: run from Git Bash unless a block says PowerShell. `~/.certs/zscaler.pem` must exist
(`ls -l /c/Users/sangm/.certs/zscaler.pem`).

```bash
# AC-1, AC-2 — inspect the batch file
cat "/c/repos/ryo_claude/ryo-9router/9router/scripts/start-9router.bat"

# AC-3, AC-4 — inspect the scoped branch and the status report
grep -n "NODE_EXTRA_CA_CERTS\|zscaler\|npm run dev" \
  ~/.claude/my-plugins/skills/ryo-smart-9router-startup/scripts/manage-9router.ps1

# AC-5 — the VBS must be untouched
git -C /c/repos/ryo_claude/ryo-9router/9router diff --stat -- scripts/

# AC-6 — global CA vars still empty, in a FRESH shell
powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','User'); [Environment]::GetEnvironmentVariable('SSL_CERT_FILE','User')"
```

Restart (this is the checkpoint — confirm first if agent work may be in flight):

```bash
# Stop the old server, then start via the fixed batch path
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 20128 -State Listen | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id \$_ -Force }"
powershell -NoProfile -Command "Start-Process wscript.exe -ArgumentList '\"C:\repos\ryo_claude\ryo-9router\9router\scripts\start-9router-silent.vbs\"'"
```

```bash
# AC-7 — the live process now carries the bundle
powershell -NoProfile -Command "\$p=(Get-NetTCPConnection -LocalPort 20128 -State Listen).OwningProcess; (Get-Process -Id \$p).StartInfo.EnvironmentVariables['NODE_EXTRA_CA_CERTS']"
# Fallback if the above is empty (StartInfo is not always populated for an already-running process):
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name=\"node.exe\"' | Select-Object ProcessId,CommandLine | Format-List"

# AC-8 — the real proof: an upstream call that no longer dies in TLS
curl -s -m 45 http://127.0.0.1:20128/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gh/gpt-5.6-luna","messages":[{"role":"user","content":"reply with the single word ok"}],"max_tokens":16}' \
  | head -c 800
# PASS  = a completion, or 401/403 (TLS completed, credentials outstanding)
# FAIL  = 502, or any UNABLE_TO_GET_ISSUER_CERT_LOCALLY

# AC-9 — the skill documents the behaviour and the signature
grep -n "NODE_EXTRA_CA_CERTS\|UNABLE_TO_GET_ISSUER_CERT_LOCALLY\|zscaler" \
  ~/.claude/my-plugins/skills/ryo-smart-9router-startup/SKILL.md
```

```bash
# AC-10 — Startup shortcut untouched
powershell -NoProfile -Command "\$s=(New-Object -ComObject WScript.Shell).CreateShortcut('C:\Users\sangm\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\9Router.lnk'); \$s.TargetPath; \$s.Arguments"
# Expect: C:\Windows\system32\wscript.exe  /  "...\scripts\start-9router-silent.vbs"
```

Regression check — Antigravity must keep working:

```bash
# Prove the built-in store is still reachable WITHOUT the bundle (Antigravity's path)
node -e "fetch('https://accounts.google.com/.well-known/openid-configuration').then(r=>console.log('google',r.status)).catch(e=>console.log('FAIL',e.cause?.code||e.message))"
```

## Turn Budget

`25 turns`

## References

- `C:\Users\sangm\.shared\ryo-projects\C-0828-buzz\session-log.md` — Session 7 (global CA cleared for
  Antigravity), Session 12 (scoped-launcher precedent for Weir AWS SSO)
- `~/.claude/CLAUDE.md` — per-app CA rule: keep `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` empty globally
- `~/.claude/my-plugins/skills/ryo-smart-provider-switcher/SKILL.md:113` — the scoped-override pattern
  this plan copies
- `~/.claude/my-plugins/skills/ryo-smart-9router-startup/scripts/manage-9router.ps1:67,69` — the two
  start branches
- `C:\repos\ryo_claude\ryo-9router\9router\scripts\start-9router.bat` — the primary choke point

## Risks / Open Questions

- **`manage-9router.ps1` lives in a git-tracked shared skills repo with a human review gate.** Per
  `~/.claude/CLAUDE.md`, pushing `~/.claude` changes goes through `/lo-smart-push` and lands on two
  remotes under different `gh` accounts. Editing the file is in scope; pushing it is a separate,
  user-triggered step and is not part of this plan's DoD.
- **AC-8 may return 401/403 rather than a completion** if the GitHub Models token in 9Router's config
  has expired. That is still a pass for this plan — the TLS fix is what's being proved — but it would
  reveal a second, unrelated blocker for the Buzz agents that should be filed separately rather than
  fixed here.
- **A cached-CA false green.** The already-running PID 16092 predates the fix, so any check run
  before the restart measures the old process. Do the restart before AC-7 and AC-8.
- Turn budget may need to increase if `manage-9router.ps1`'s two start branches turn out to share
  more logic than the line-67/69 split suggests, requiring a small refactor rather than two local
  edits.
