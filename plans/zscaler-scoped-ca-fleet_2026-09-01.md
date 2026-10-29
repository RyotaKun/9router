# Plan: Fleet-wide scoped Zscaler CA + a service regression suite

> **SUPERSEDED 2026-09-01** by [`zscaler-ca-architecture_2026-09-01.md`](zscaler-ca-architecture_2026-09-01.md).
> **Its per-launcher edits were deliberately dropped**, not deferred. Two measurements killed them:
> (1) `accounts.google.com` is issued by Google Trust Services, not Zscaler — it is on Zscaler's
> inspection bypass list, so no CA variable could ever have broken Antigravity's Google sign-in, and
> the Session 7 rule that forced per-service scoping rests on a refuted diagnosis; (2) only Node needs
> any certificate configuration at all — Python and Cargo already work via global `REQUESTS_CA_BUNDLE`
> and `CARGO_HTTP_CAINFO`, Chromium and `rustls-tls-native-roots` read the Windows store. One global
> `NODE_EXTRA_CA_CERTS` replaces every launcher edit this plan proposed and costs a new service nothing.
> The service inventory and the 404 evidence here remain valid. Do not execute this plan.

**Created:** 2026-09-01
**Runner / target model:** `claude-opus-5` (profile `opus-5`; no `--for`, so target = runner)
**Project:** C-0828-buzz
**Supersedes:** `9router-scoped-zscaler-ca_2026-09-01.md` — that plan scoped only 9Router. The user
then reported Buzz also broken and required that every fix prove no service regressed, which
changes the shape of the work from a two-file edit to a fleet fix plus a repeatable proof.

---

## Investigation note — one root cause, two services, and one bug that is NOT Zscaler

All facts below were measured in this session (2026-09-01) with **Zscaler confirmed ON**
(`ZSAService` 25388, `ZSATray` 19616, `ZSATunnel` 23684 all running).

### The shared root cause

Global `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` are empty — correct per the house rule, cleared on
2026-08-29 so Antigravity's Google sign-in works (session-log Session 7). Nothing was given a scoped
replacement. Every service that makes an outbound HTTPS call from a runtime that does **not** read the
Windows certificate store therefore fails under Zscaler's MITM.

| Probe | Result |
|---|---|
| `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` | both `[<empty>]` |
| Node → GitHub Models, no CA | `FAIL UNABLE_TO_GET_ISSUER_CERT_LOCALLY` |
| Node → GitHub Models, `NODE_EXTRA_CA_CERTS=~/.certs/zscaler.pem` | `HTTP 410` (reached the server) |
| Node → Azure relay `/health`, no CA | `FAIL UNABLE_TO_GET_ISSUER_CERT_LOCALLY` |
| Node → Azure relay `/health`, with CA | `HTTP 200 ok` |

`~/.certs/zscaler.pem` (2 certificates) is sufficient — Node **appends** it to the built-in Mozilla
store rather than replacing it. The 276 KB `zscaler-combined.pem` (139 certificates) also works but is
not needed; the 2-cert bundle is the documented house convention
(`ryo-smart-provider-switcher/SKILL.md:113`).

### Service inventory — measured, not assumed

Derived from every `Startup\*.lnk` target plus each launcher's own source, not from `context.md`.

| Service | Port | Runtime | Outbound HTTPS | CA variable it needs | State now |
|---|---|---|---|---|---|
| 9Router | 20128 | Node / Next.js dev | yes — model providers | `NODE_EXTRA_CA_CERTS` | **running, upstream broken** |
| Buzz relay bridge | 3001 | Node (`azure_relay_bridge.cjs`) | yes — Azure relay | `NODE_EXTRA_CA_CERTS` | **not listening** |
| ryo-aws-dashboard | 6869 | Python (`py`) + AWS CLI | yes — AWS | `REQUESTS_CA_BUNDLE` + `AWS_CA_BUNDLE` | unverified |
| Hermes CDP Chrome | 9222 | Chrome | yes, but Chrome uses the **Windows store** | none | out of scope, unaffected |
| Ollama | 11434 | native, loopback only | no | none | listening |

**The CA variable is not one variable.** Node reads `NODE_EXTRA_CA_CERTS`; Python `requests` reads
`REQUESTS_CA_BUNDLE`; the AWS CLI reads `AWS_CA_BUNDLE`. `start-server.cmd:7` states the dashboard
"inherits ... the Zscaler CA" from the interactive session — that comment is now false, since the
global variable it relied on was cleared. A Node-only fix does not cover the fleet.

### The 404 is a real, separate bug — the CA fix will NOT bring Buzz back on its own

Running the bridge in the foreground produced two distinct failures:

```
[Bridge] Clock sync error: fetch failed                    <- the CA problem
Azure Relay Loopback Bridge listening on http://127.0.0.1:3001
[Bridge WS Upstream Error]: Unexpected server response: 404 <- NOT the CA problem
```

The bridge binds 3001 successfully. Its clock-sync `fetch` to `/health` fails on the missing CA
(line 23). But its **upstream WebSocket** already bypasses certificate validation entirely —
`rejectUnauthorized: false` at `azure_relay_bridge.cjs:139` and `:178` — so TLS was never its
blocker. A direct `wss://` handshake to `UPSTREAM_WS` (line 16, bare root path) returns
`Unexpected server response: 404` **with the CA present**, while `GET /` over HTTPS returns
`HTTP 200` with full NIP-11 metadata (`supported_nips:[1,2,10,11,16,17,23,25,29,33,38,42,50...]`).
So the relay is alive and serving HTTP; it is refusing the WebSocket upgrade.

`context.md` records the bridge as terminating "upstream TLS using system CA bundle
(`NODE_EXTRA_CA_CERTS`)" (Session 6). The shipped code does not do that — it uses
`rejectUnauthorized: false`. Treat the snapshot as historical on this point.

**Consequence for scope:** this plan fixes the CA layer fleet-wide and proves no service regressed.
It does **not** fix the 404, which needs its own investigation (relay ingress WebSocket config,
community host-binding, or a path change). Bundling an unrooted networking bug into a
certificate-hygiene change would make the regression suite unable to tell which fix did what.

---

## Brief

Every locally-hosted service reaches its upstream through Zscaler using a certificate bundle scoped to
its own process, with a single repeatable script that proves each service still works and that
Antigravity's Google sign-in path is untouched. This ends the pattern where fixing one service's TLS
silently breaks another's.

## Stack

- Node.js v25.2.1 (`C:\nvm4w\nodejs\node.exe`); global modules at `%APPDATA%\npm\node_modules`
- Next.js dev server — 9Router, `C:\repos\ryo_claude\ryo-9router\9router`, port 20128
- Node CommonJS — Buzz bridge, `C:\Users\sangm\.buzz\bridge\azure_relay_bridge.cjs`, port 3001
- Python 3.13 via the `py` launcher + AWS CLI — ryo-aws-dashboard, port 6869
- Windows batch + VBScript launchers; PowerShell 5.1 for the regression suite
- CA bundle: `C:\Users\sangm\.certs\zscaler.pem` (2 certificates)
- Reasoning effort: **`medium`**. The root cause is measured and the edits are mechanical; the only
  judgement is which services are in scope, and the inventory above settles it. Do not disable
  thinking.

## Scope — Functionality

- A single source of truth for the bundle path, read by every launcher, so the path exists in one
  place rather than being copy-pasted into four scripts.
- Each Node service launcher sets `NODE_EXTRA_CA_CERTS` for its spawned process only:
  - `9router\scripts\start-9router.bat` (the choke point for the Startup shortcut)
  - `ryo-smart-9router-startup\scripts\manage-9router.ps1` direct-`npm` branch (line 69 pre-edit),
    which currently bypasses the `.bat` and would reproduce the fault on its fallback path
  - the Buzz bridge launcher — currently `start-bridge-silent.vbs`, a bare `WshShell.Run "node ..."`
    with no environment and no working directory
- The Python/AWS service gets `REQUESTS_CA_BUNDLE` and `AWS_CA_BUNDLE` scoped the same way, and
  `start-server.cmd`'s stale "inherits the Zscaler CA" comment is corrected to describe what it
  actually does.
- Absent-bundle tolerance in every launcher: if the bundle file is missing, start with the
  environment unchanged rather than pointing a runtime at a nonexistent path.
- A regression suite, runnable in one command, that reports pass/fail per service: 9Router upstream
  reachability, Buzz bridge bind + relay HTTP reachability, dashboard responsiveness, Ollama,
  Hermes CDP, and the Antigravity guard (a plain no-CA fetch to Google must still succeed).
- The suite distinguishes **TLS failure** from **service failure**, so the known Buzz 404 reports as
  a named known-failure rather than as a regression this plan caused.
- No global environment variable is created, modified, or restored.

## Out of Scope

- **The Buzz upstream WebSocket 404.** Reproduced with the CA present and with certificate validation
  already disabled in the bridge, so it is not a TLS defect. Needs its own investigation into the
  Azure Container Apps ingress WebSocket configuration and the relay's community host-binding. File
  separately; the regression suite records it as a known failure with today's evidence.
- Hermes CDP Chrome and Ollama. Chrome uses the Windows certificate store and Ollama is
  loopback-only; neither is affected by the cleared variables.
- The Antigravity ACP adapter, avatar upload verification, and the Buzz-only launcher as a distinct
  artifact — the bridge launcher fix in this plan covers Buzz's actual CA need, so a separate
  launcher is no longer the shape of that open item.
- Any change to global `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS`, or restoring
  `C:\Users\sangm\.certs\antigravity-env-backup.json`.
- Migrating 9Router off `npm run dev`, or adding a supervisor/daemon manager for any service.
- Renewing or re-exporting the Zscaler certificate.
- Refactoring the bridge to use a real CA instead of `rejectUnauthorized: false`. It is a genuine
  weakness and should be filed, but changing certificate validation behaviour in the same pass as a
  certificate-plumbing fix makes the regression result unattributable.

## Constraints

- **Source traceability.** Every factual claim in any file or message this plan produces names its
  source — a file path with line number, a command's output, or a session-log entry. Do not present
  an inference as an asserted fact.
- **Regression proof is a deliverable, not a step.** No service fix is complete until the suite has
  been run and its output recorded. Record the suite's output for **all** services after **each**
  service's fix, not once at the end — a fix that breaks a sibling must be attributable to the fix
  that caused it.
- **Baseline first.** Run the suite and record its output **before** any edit. Without a
  pre-change baseline, a pre-existing failure is indistinguishable from one this plan introduced.
  This is the single most likely way this plan produces a false "regression".
- Never set `SSL_CERT_FILE` or `NODE_EXTRA_CA_CERTS` globally, and never restore the values from
  `antigravity-env-backup.json`. Antigravity's Google sign-in depends on both staying empty
  (`~/.claude/CLAUDE.md`, per-app CA rule; session-log Session 7).
- Every CA override travels only with the spawned process. Do not mutate the calling shell, the user
  environment, or the machine environment.
- Use `~/.certs/zscaler.pem`, not `zscaler-combined.pem` (`ryo-smart-provider-switcher/SKILL.md:113`).
- **Do not edit either `.vbs` wrapper to carry the environment inline.** `start-9router-silent.vbs`
  already delegates to a `.bat` and inherits the fix for free. The Buzz bridge VBS has no `.bat` to
  delegate to, so give it one — that keeps both services on the same pattern and the CA path in one
  place per service, rather than embedded in VBScript string literals.
- Restarting a service drops its in-flight work. Restarts are the checkpoints in this plan: confirm
  before killing 9Router (PID 16092 at time of writing) if agent work may be running.
- Pause only for a destructive or irreversible action, a real scope change, or input only the user
  can provide. Otherwise keep going.
- Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and check in
  only when different readings of the request would lead to materially different work. If the request
  seems mistaken or a better approach exists, say so in a sentence and continue with the task as
  asked rather than quietly narrowing, widening, or transforming it. Finish the whole task, and stop
  short of actions that are clearly beyond what was asked.
- Delegate to a subagent only for large tasks that are genuinely independent and parallelizable, such
  as a wide multi-file investigation. Do not delegate work you can finish yourself in a handful of
  tool calls, and do not use subagents to verify or double-check your own work. If one subagent can
  complete the task, use one rather than several, and keep spawn counts low.
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

Every Node and Python service launcher sets its runtime's CA variable to `~\.certs\zscaler.pem` for
the spawned process only, global `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` are still empty, and the
regression suite reports every service at its recorded baseline state or better — with 9Router's
upstream call and the Buzz bridge's clock sync both passing and no `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
anywhere in its output.

## Acceptance Criteria

- **AC-1** A baseline run of the regression suite was captured **before** any edit, and its output is
  recorded in the session.
- **AC-2** `9router\scripts\start-9router.bat` sets `NODE_EXTRA_CA_CERTS` to the bundle inside a
  `setlocal` scope, and skips the assignment when the bundle file is absent.
- **AC-3** `manage-9router.ps1`'s direct-`npm` start branch applies the same scoped CA, so no start
  path can produce an uncertified 9Router.
- **AC-4** The Buzz bridge starts through a `.bat` (or equivalent wrapper) that sets
  `NODE_EXTRA_CA_CERTS` scoped to the spawned `node`, and `start-bridge-silent.vbs` delegates to it.
- **AC-5** `ryo-aws-dashboard\scripts\start-server.cmd` sets `REQUESTS_CA_BUNDLE` and `AWS_CA_BUNDLE`
  scoped to its process, and its stale "inherits ... the Zscaler CA" comment (line 7) is corrected.
- **AC-6** The bundle path is defined in exactly one place per service; `grep -c` for the literal
  `zscaler.pem` across the edited launchers returns at most one hit per file.
- **AC-7** No user- or machine-level environment variable was created or modified: a fresh shell
  reports `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` as empty at both `User` and `Machine` scope.
- **AC-8** After restart, 9Router answers `POST /v1/chat/completions` for `gh/gpt-5.6-luna` with no
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` and no `502`. An upstream `401`/`403` is a pass — it proves TLS
  completed and only credentials are outstanding.
- **AC-9** After restart, the Buzz bridge logs no `Clock sync error` and binds `127.0.0.1:3001`.
- **AC-10** The regression suite exists as a single runnable script, reports one pass/fail line per
  service, exits non-zero if any service regressed against baseline, and classifies the known Buzz
  upstream 404 as a named known-failure rather than a regression.
- **AC-11** The Antigravity guard passes: a plain Node fetch to
  `https://accounts.google.com/.well-known/openid-configuration` with **no** CA variable set returns
  HTTP 200.
- **AC-12** Both `.vbs` wrappers and the `9Router.lnk` / `BuzzAzureBridge.lnk` Startup shortcuts still
  point at the same targets as before, so the next Windows login inherits every fix with no further
  action.
- **AC-13** `ryo-smart-9router-startup\SKILL.md` documents the scoped-CA behaviour and names
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` as the signature of a service started without the bundle.
- **AC-14** The Buzz upstream 404 is written up as a separate follow-up item with today's evidence
  (relay HTTP 200 + NIP-11 payload, WS handshake 404 with the CA present, `rejectUnauthorized: false`
  at `azure_relay_bridge.cjs:139,178`), and is not silently absorbed into this plan's result.

## Verification

Preconditions: Git Bash unless a block says PowerShell. Confirm the bundle exists and Zscaler is on.

```bash
ls -l /c/Users/sangm/.certs/zscaler.pem
powershell -NoProfile -Command "Get-Process ZSAService,ZSATunnel -ErrorAction SilentlyContinue | Select-Object Name,Id"
```

### AC-1 — baseline, BEFORE any edit

```bash
bash /c/repos/ryo_claude/ryo-9router/9router/scripts/check-services.sh | tee /tmp/baseline-services.txt
```

### AC-2 … AC-6 — inspect the launchers

```bash
cat /c/repos/ryo_claude/ryo-9router/9router/scripts/start-9router.bat
cat ~/.buzz/bridge/start-bridge.bat
cat ~/.buzz/bridge/start-bridge-silent.vbs
grep -n "REQUESTS_CA_BUNDLE\|AWS_CA_BUNDLE\|Zscaler" /c/repos/ryo_claude/ryo-aws-dashboard/scripts/start-server.cmd
grep -n "NODE_EXTRA_CA_CERTS\|zscaler\|npm run dev" ~/.claude/my-plugins/skills/ryo-smart-9router-startup/scripts/manage-9router.ps1

# AC-6 — one definition per file, no copy-paste drift
for f in /c/repos/ryo_claude/ryo-9router/9router/scripts/start-9router.bat \
         ~/.buzz/bridge/start-bridge.bat \
         /c/repos/ryo_claude/ryo-aws-dashboard/scripts/start-server.cmd; do
  echo "$(grep -c 'zscaler\.pem' "$f")  $f"
done
```

### AC-7 — no global variable was touched (fresh shell, both scopes)

```bash
powershell -NoProfile -Command "'User  NODE: ['+[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','User')+']'; 'User  SSL:  ['+[Environment]::GetEnvironmentVariable('SSL_CERT_FILE','User')+']'; 'Mach  NODE: ['+[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','Machine')+']'; 'Mach  SSL:  ['+[Environment]::GetEnvironmentVariable('SSL_CERT_FILE','Machine')+']'"
# Expect all four to be []
```

### Restart — the checkpoint. Confirm before killing 9Router if agent work may be in flight.

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 20128,3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force }"
powershell -NoProfile -Command "Start-Process wscript.exe -ArgumentList '\"C:\repos\ryo_claude\ryo-9router\9router\scripts\start-9router-silent.vbs\"'"
powershell -NoProfile -Command "Start-Process wscript.exe -ArgumentList '\"C:\Users\sangm\.buzz\bridge\start-bridge-silent.vbs\"'"
```

### AC-8 — 9Router upstream no longer dies in TLS

```bash
curl -s -m 45 http://127.0.0.1:20128/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gh/gpt-5.6-luna","messages":[{"role":"user","content":"reply with the single word ok"}],"max_tokens":16}' \
  | head -c 800
# PASS = a completion, or 401/403.  FAIL = 502, or any UNABLE_TO_GET_ISSUER_CERT_LOCALLY
```

### AC-9 — bridge clock sync is clean. Run in the FOREGROUND to read its output.

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force }"
cd ~/.buzz/bridge && timeout 20 cmd //c start-bridge.bat 2>&1 | head -20
# PASS = "listening on http://127.0.0.1:3001" with NO "Clock sync error"
# The "[Bridge WS Upstream Error]: Unexpected server response: 404" line is the KNOWN failure (AC-14), not a regression
```

### AC-10, AC-11 — the suite, and the Antigravity guard inside it

```bash
bash /c/repos/ryo_claude/ryo-9router/9router/scripts/check-services.sh; echo "EXIT=$?"
diff /tmp/baseline-services.txt <(bash /c/repos/ryo_claude/ryo-9router/9router/scripts/check-services.sh) || true

# AC-11 standalone — Antigravity's path must work with NO CA variable set
node -e "fetch('https://accounts.google.com/.well-known/openid-configuration').then(r=>console.log('google',r.status)).catch(e=>console.log('FAIL',e.cause?.code||e.message))"
# Expect: google 200
```

### AC-12 — Startup shortcuts and VBS wrappers unchanged

```bash
powershell -NoProfile -Command "\$w=New-Object -ComObject WScript.Shell; foreach(\$n in '9Router','BuzzAzureBridge'){ \$s=\$w.CreateShortcut(\"C:\Users\sangm\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\\\$n.lnk\"); \$n+' -> '+\$s.TargetPath+' '+\$s.Arguments }"
# Expect both still: C:\Windows\system32\wscript.exe  "...\*-silent.vbs"
git -C /c/repos/ryo_claude/ryo-9router/9router diff --stat -- scripts/start-9router-silent.vbs
# Expect: no output
```

### AC-13 — the skill documents the signature

```bash
grep -n "NODE_EXTRA_CA_CERTS\|UNABLE_TO_GET_ISSUER_CERT_LOCALLY\|zscaler" \
  ~/.claude/my-plugins/skills/ryo-smart-9router-startup/SKILL.md
```

## Turn Budget

`60 turns`

## References

- `~\.shared\ryo-projects\C-0828-buzz\session-log.md` — Session 6 (bridge built), Session 7 (global CA
  cleared for Antigravity), Session 12 (scoped-launcher precedent for Weir AWS SSO)
- `~/.claude/CLAUDE.md` — per-app CA rule: keep `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` empty globally
- `~/.claude/my-plugins/skills/ryo-smart-provider-switcher/SKILL.md:113` — the scoped-override pattern
- `~/.claude/my-plugins/skills/ryo-smart-9router-startup/scripts/manage-9router.ps1:67,69` — two start
  branches, only one of which goes through the `.bat`
- `~/.buzz/bridge/azure_relay_bridge.cjs:16,23,139,178` — upstream URL, clock-sync fetch, and the two
  `rejectUnauthorized: false` sites
- `C:\repos\ryo_claude\ryo-aws-dashboard\scripts\start-server.cmd:7` — the now-false "inherits the
  Zscaler CA" comment

## Risks / Open Questions

- **`manage-9router.ps1` and the 9Router skill live in a git-tracked shared repo with a human review
  gate.** Per `~/.claude/CLAUDE.md`, pushing `~/.claude` goes through `/lo-smart-push` to two remotes
  under different `gh` accounts. Editing is in scope; pushing is a separate user-triggered step and is
  not part of this DoD.
- **A false "regression" from the missing baseline.** ryo-aws-dashboard (6869) was never observed
  listening in this session, so it may already be down for reasons unrelated to certificates. AC-1
  exists specifically to stop that being attributed to this plan.
- **A false green from a stale process.** 9Router PID 16092 predates every fix. Any check run before
  the restart measures the old process. Restart before AC-8 and AC-9.
- **AC-8 may return 401/403** if 9Router's GitHub Models token has expired. Still a pass here — the
  TLS fix is what is being proved — but it reveals a second blocker for the Buzz agents that should be
  filed rather than fixed in this plan.
- **The Buzz 404 may make Buzz still unusable after this plan completes.** That is expected and is
  stated in the DoD, which does not claim Buzz chat works end to end. If the user's real goal is
  working Buzz chat, the 404 investigation is the next plan and this one is its prerequisite.
- Turn budget may need to increase if `manage-9router.ps1`'s two start branches share enough logic to
  warrant a small refactor rather than two local edits, or if the dashboard's Python path needs
  `SSL_CERT_FILE` in addition to `REQUESTS_CA_BUNDLE` (openssl-level verification differs by library).
