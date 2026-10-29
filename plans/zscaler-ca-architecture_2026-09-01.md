# Plan: One machine-wide TLS trust policy, so a new service needs zero certificate work

**Created:** 2026-09-01
**Runner / target model:** `claude-opus-5` (profile `opus-5`; no `--for`, so target = runner)
**Project:** C-0828-buzz
**Supersedes:** `zscaler-scoped-ca-fleet_2026-09-01.md` and `9router-scoped-zscaler-ca_2026-09-01.md`.
Both are per-launcher patch plans. Measurement (below) shows the per-launcher approach is unnecessary
and the rule forcing it rests on a refuted diagnosis. The evidence in those files is still valid; their
prescriptions are not.

---

## Investigation note — the rule we have been defending was protecting against a threat that does not exist

All facts measured this session, 2026-09-01, with Zscaler confirmed ON (`ZSAService` 25388,
`ZSATray` 19616, `ZSATunnel` 23684).

### Finding 1 — Google is not intercepted by Zscaler, so no CA variable could ever have broken Antigravity

```
accounts.google.com  -> issuer=C=US, O=Google Trust Services, CN=WR2        <-- real Google cert
models.github.ai     -> issuer=O=Zscaler Inc., CN=Zscaler Intermediate Root CA (zscalertwo.net)
struong-relay...azurecontainerapps.io -> issuer=O=Zscaler Inc., CN=Zscaler Intermediate Root CA
```

`accounts.google.com` is on Zscaler's SSL-inspection bypass list. Its traffic never passes through the
MITM. Confirmed behaviourally — a bare Node fetch with **no** CA variable set returns `google BARE: 200`.

Session 7 (2026-08-29) concluded that global `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` broke Antigravity's
Google sign-in, and cleared them. That conclusion is not supportable: Google's TLS path is untouched by
either variable. Direct tests, all returning 200:

| Variable set | Google result |
|---|---|
| none | `200` |
| `NODE_EXTRA_CA_CERTS=zscaler.pem` | `200` |
| `NODE_EXTRA_CA_CERTS=zscaler-combined.pem` (139 certs) | `200` |
| `SSL_CERT_FILE=zscaler.pem` | `200` |

Session 7's own closing note already recorded the contradiction: *"Antigravity was later observed to show
the same TLS error again. Saved variables were empty."* The error recurred with the variables gone. The
variables were never the cause, and every rule built on that conclusion — in `~/.claude/CLAUDE.md`, in
`C-0828-buzz/context.md`, and in both superseded plans — inherited a misdiagnosis.

### Finding 2 — the "keep global CA variables empty" rule is not even in force

Two global CA variables are live on this machine right now:

```
REQUESTS_CA_BUNDLE=C:\Users\sangm\.certs\zscaler.pem
CARGO_HTTP_CAINFO=C:\Users\sangm\.certs\zscaler.pem
```

Nothing is broken by them. Python and Cargo work under Zscaler with no per-service configuration
because of them. The rule was applied to exactly the two variables that Session 7 misdiagnosed, and
its own principle contradicts the two that were left in place and are working.

### Finding 3 — only Node is actually broken. Every other runtime already reads the system store or has a global variable

| Runtime | Under Zscaler, no per-service config | Why |
|---|---|---|
| Node | **fails** — `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | ships its own Mozilla bundle, ignores the Windows store by default |
| Python / `requests` | works — `py github 410` | global `REQUESTS_CA_BUNDLE` (Finding 2). Not certifi: its 146-cert bundle contains no `Zscaler` string |
| Rust / Cargo | works | global `CARGO_HTTP_CAINFO` |
| Rust / `buzz-desktop` | works | switched to `rustls-tls-native-roots` in Session 4 — reads the Windows store |
| Chrome / Hermes CDP | works | Chromium uses the Windows store |
| Ollama | n/a | loopback only, no outbound TLS |

The Windows `LocalMachine\Root` store already holds the Zscaler root **and** the public roots — 50
certificates total: 1 Zscaler, 13 DigiCert/Baltimore/GlobalSign/ISRG. That is why a system-store
approach works whether Zscaler is on or off, with no switching.

So the problem is not "every new service needs certificate work". It is "Node needs certificate work,
and we removed the one setting that gave it that, for a reason that turned out to be wrong."

### Finding 4 — `--use-system-ca` is the elegant answer and it is disqualified, for a concrete reason

`node --use-system-ca` works (`github 410`, `google 200`, no variable needed) and does not narrow
trust across five real hosts:

| host | bare node | `--use-system-ca` |
|---|---|---|
| `registry.npmjs.org` | 200 | 200 |
| `api.github.com` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | **200** |
| `pypi.org/simple` | 200 | 200 |
| `management.azure.com` | 400 | 400 |
| `sts.amazonaws.com` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | **200** |

But it cannot be set globally. It is a **flag**, and an unrecognised flag in `NODE_OPTIONS` makes Node
**refuse to start**:

```
NODE_OPTIONS=--use-system-ca  C:\Users\sangm\AppData\Local\nvm\v20.18.0\node.exe -e "..."
  -> --use-system-ca is not allowed in NODE_OPTIONS
```

Node v20.18.0 is installed on this machine. `--use-system-ca` landed in v22.15/v23. A global
`NODE_OPTIONS` would therefore kill every Node-20 process on the box — precisely the
fix-one-thing-break-another pattern this plan exists to end. Playwright's bundled v24.11.1 is fine, but
one incompatible runtime is enough to disqualify it as a *global* setting.

### Finding 5 — `NODE_EXTRA_CA_CERTS` is the one setting that is universal and additive

It is an environment variable, not a flag, so no Node version rejects it. Verified on every Node on
this machine:

| Node | `NODE_EXTRA_CA_CERTS=zscaler.pem` → `api.github.com` |
|---|---|
| v20.18.0 | `200` |
| v24.11.1 | `200` |
| v25.2.1 | `200` |

It is **additive** — Node appends it to the bundled Mozilla store rather than replacing it, so it
narrows nothing (`registry.npmjs.org` → `200` with the 2-cert bundle applied). The 2-cert
`zscaler.pem` is sufficient; the 276 KB `zscaler-combined.pem` is redundant.

**Conclusion.** The permanent fix is one global environment variable plus the Windows root store that
is already correct — and the retraction of a rule that was never justified. Zero per-service files.
A new Node service inherits trust with no configuration at all.

---

## Brief

One machine-wide TLS trust policy under which every runtime — current and future — reaches Zscaler-
intercepted and non-intercepted hosts with no per-service certificate configuration, and the refuted
Session 7 diagnosis is corrected in every document that repeats it. This ends the pattern where each
new service costs a certificate investigation and each fix regresses a sibling.

## Stack

- Windows 11 ARM64; Zscaler client connector (`ZSAService` / `ZSATunnel`)
- Windows `LocalMachine\Root` certificate store — 50 roots, Zscaler present
- `C:\Users\sangm\.certs\zscaler.pem` (2 certificates)
- Node.js — v25.2.1 primary, v20.18.0 and Playwright's v24.11.1 also present
- Python 3.13 (`py` launcher) + `certifi` 146-cert bundle; AWS CLI 2.32.28
- Rust / Cargo; Chromium (Hermes CDP)
- Affected services: 9Router (20128), Buzz relay bridge (3001), ryo-aws-dashboard (6869)
- Documents to correct: `~/.claude/CLAUDE.md`, `~/.shared/ryo-projects/C-0828-buzz/context.md`,
  `~/.shared/ryo-projects/C-0828-buzz/session-log.md`,
  `~/.claude/my-plugins/skills/ryo-smart-provider-switcher/SKILL.md`
- Reasoning effort: **`medium`**. The architecture is settled by the measurements above; the remaining
  work is one variable, one policy document, four document corrections, and one gate script. Do not
  disable thinking.

## Scope — Functionality

- A single global `NODE_EXTRA_CA_CERTS` at **User** scope pointing at `~\.certs\zscaler.pem`,
  replacing all per-launcher certificate configuration.
- Confirmation that the Zscaler root is present in `LocalMachine\Root`, since every non-Node runtime
  depends on it and nothing currently asserts it.
- `REQUESTS_CA_BUNDLE` and `CARGO_HTTP_CAINFO` are kept as-is and documented as part of the same
  policy rather than as accidents.
- A written policy at `C:\Users\sangm\.certs\CA-POLICY.md` stating, per runtime, what makes TLS work,
  what a new service must do (for Node: nothing), and why `--use-system-ca` is not used globally.
- The refuted Session 7 diagnosis corrected in all four documents that assert it, each carrying the
  evidence (Google is signed by Google Trust Services, not Zscaler) rather than a bare reversal.
- A regression gate script that, in one command, reports per-runtime TLS reachability against both an
  intercepted and a non-intercepted host, plus per-service liveness, and exits non-zero on regression.
- No per-service launcher is edited. The superseded plans' launcher edits are explicitly dropped, and
  the two plan files record that they were dropped and why.

## Out of Scope

- **The Buzz upstream WebSocket 404.** Reproduced with the CA present and with the bridge's own
  certificate validation already disabled, so it is not a TLS defect. Separate investigation into the
  Azure Container Apps ingress WebSocket configuration and relay community host-binding. This plan
  does not claim Buzz chat works.
- **Removing `rejectUnauthorized: false` from `azure_relay_bridge.cjs:139,178`.** The policy makes it
  newly unnecessary, and it should be deleted — but changing certificate-validation behaviour inside
  the same pass that changes certificate plumbing makes any regression unattributable. File as the
  first follow-up.
- **The missing AWS profile.** `aws sts get-caller-identity --profile struong-sso-aws-bedrock` reports
  *"The config profile could not be found"*, so ryo-aws-dashboard is broken for a reason unrelated to
  certificates. Record it; do not fix it here.
- Migrating 9Router off `npm run dev`, adding a service supervisor, or removing Node v20.18.0 from the
  machine.
- Re-exporting or renewing the Zscaler certificate, and any change to `zscaler-combined.pem` (kept as
  a fallback, unused by this policy).
- Machine-scope environment variables. User scope is sufficient and does not need elevation.

## Constraints

- **Source traceability.** Every factual claim in any file this plan produces names its source — a
  file path with line number, a command's output, or a session-log entry. Do not present an inference
  as an asserted fact. This matters more than usual here: the plan's whole basis is that a previous
  session's unsourced conclusion propagated into four documents.
- **Baseline before change.** Capture the gate script's output **before** setting the variable. Two
  services are already broken for non-certificate reasons (ryo-aws-dashboard's missing AWS profile,
  Buzz's upstream 404); without a baseline they will read as regressions this plan caused.
- **Correct the record, do not erase it.** In all four documents, keep what Session 7 concluded, mark
  it refuted, and give the evidence. A silent reversal leaves the next session free to re-derive the
  same wrong rule from the same symptom.
- **Do not set `NODE_OPTIONS` globally.** Measured: Node v20.18.0 refuses to start with
  `--use-system-ca` in `NODE_OPTIONS`. Per-service `--use-system-ca` on a known-new runtime is
  acceptable and is not needed by this plan.
- Use `~\.certs\zscaler.pem`, not `zscaler-combined.pem`.
- Do not edit any service launcher, `.vbs` wrapper, or Startup shortcut. If the policy requires a
  launcher edit to work, the policy is wrong — stop and say so rather than adding the edit.
- `~/.claude` is a git-tracked shared repo with a human review gate. Editing `CLAUDE.md` and the
  provider-switcher skill is in scope; **pushing** is a separate user-triggered `/lo-smart-push` step
  and is not part of this plan's Definition of Done.
- **Antigravity's Google sign-in is the one genuine risk and cannot be proven in-session.** It needs a
  human to complete a browser flow. Automated proxies go in the Acceptance Criteria; the real sign-in
  goes in Human follow-ups and must not gate the goal.
- Pause only for a destructive or irreversible action, a real scope change, or input only the user can
  provide. Otherwise keep going.
- Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and check in
  only when different readings of the request would lead to materially different work. If the request
  seems mistaken or a better approach exists, say so in a sentence and continue with the task as asked
  rather than quietly narrowing, widening, or transforming it. Finish the whole task, and stop short
  of actions that are clearly beyond what was asked.
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

A single User-scope `NODE_EXTRA_CA_CERTS=C:\Users\sangm\.certs\zscaler.pem` is set, no service
launcher was edited, `~/.certs/CA-POLICY.md` states the per-runtime policy, all four documents that
repeat the refuted Session 7 diagnosis carry the correction with its evidence, and the gate script
reports every runtime reaching both an intercepted and a non-intercepted host with every service at or
above its recorded baseline.

## Acceptance Criteria

- **AC-1** A baseline run of the gate script was captured **before** the variable was set, and its
  output is recorded in the session.
- **AC-2** `NODE_EXTRA_CA_CERTS` is set at User scope to `C:\Users\sangm\.certs\zscaler.pem`, and
  Machine scope remains empty.
- **AC-3** No service launcher, `.vbs` wrapper, or Startup shortcut was modified — `git diff --stat`
  is empty for `9router/scripts/` and no new `.bat` exists under `~/.buzz/bridge/`.
- **AC-4** In a **new** shell, a bare `node` fetch to `https://api.github.com/` returns 200 with no
  flag and no per-command variable.
- **AC-5** In a new shell, a bare `node` fetch to `https://accounts.google.com/.well-known/openid-configuration`
  returns 200 — the non-intercepted control.
- **AC-6** Node v20.18.0 still starts and completes a fetch under the new global variable, proving the
  policy did not break the older runtime that `NODE_OPTIONS` would have.
- **AC-7** 9Router, restarted with no launcher change, answers `POST /v1/chat/completions` for
  `gh/gpt-5.6-luna` with no `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` and no `502`. An upstream `401`/`403`
  is a pass — TLS completed and only credentials are outstanding.
- **AC-8** The Buzz bridge, restarted with no launcher change, logs no `Clock sync error` and binds
  `127.0.0.1:3001`. Its upstream `404` is recorded as the named known-failure, not a regression.
- **AC-9** `~/.certs/CA-POLICY.md` exists and states, per runtime, what provides trust; what a new Node
  service must configure (nothing); and why `--use-system-ca` is not set globally, citing the Node
  v20.18.0 rejection.
- **AC-10** `~/.claude/CLAUDE.md`, `C-0828-buzz/context.md`, `C-0828-buzz/session-log.md`, and
  `ryo-smart-provider-switcher/SKILL.md` each carry the correction, and each cites that
  `accounts.google.com` is issued by Google Trust Services rather than Zscaler.
- **AC-11** The gate script exists, runs in one command, tests each runtime against one intercepted and
  one non-intercepted host, reports per-service liveness, and exits non-zero on regression against
  baseline.
- **AC-12** The gate script's Python and Cargo checks pass, confirming `REQUESTS_CA_BUNDLE` and
  `CARGO_HTTP_CAINFO` were left intact.
- **AC-13** Both superseded plan files carry a note that their per-launcher edits were deliberately
  dropped, with the reason.
- **AC-14** The two known non-certificate failures — Buzz's upstream 404 and the missing
  `struong-sso-aws-bedrock` AWS profile — are written up as separate follow-ups with today's evidence,
  and are not absorbed into this plan's result.

## Verification

Preconditions:

```bash
ls -l /c/Users/sangm/.certs/zscaler.pem
powershell -NoProfile -Command "Get-Process ZSAService,ZSATunnel -ErrorAction SilentlyContinue | Select-Object Name,Id"
powershell -NoProfile -Command "\$r=Get-ChildItem Cert:\LocalMachine\Root; 'roots: '+\$r.Count+'  zscaler: '+(\$r|Where-Object {\$_.Subject -match 'Zscaler'}).Count"
# Expect roots: 50  zscaler: 1
```

### AC-1 — baseline, BEFORE setting the variable

```bash
bash ~/.certs/check-tls-fleet.sh | tee /tmp/baseline-tls.txt
```

### AC-2 — the one setting, and nothing at Machine scope

```bash
powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS','C:\Users\sangm\.certs\zscaler.pem','User')"
powershell -NoProfile -Command "'User:    ['+[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','User')+']'; 'Machine: ['+[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','Machine')+']'"
# Expect User: [C:\Users\sangm\.certs\zscaler.pem]   Machine: []
```

### AC-3 — no launcher was touched

```bash
git -C /c/repos/ryo_claude/ryo-9router/9router diff --stat -- scripts/
ls ~/.buzz/bridge/
# Expect: no diff output; bridge dir still exactly azure_relay_bridge.cjs, load_vault_keys.py, start-bridge-silent.vbs
```

### AC-4, AC-5, AC-6 — in a NEW shell, so the variable is actually inherited

```bash
powershell -NoProfile -Command "node -e \"fetch('https://api.github.com/').then(r=>console.log('github',r.status)).catch(e=>console.log('FAIL',e.cause?.code))\""
powershell -NoProfile -Command "node -e \"fetch('https://accounts.google.com/.well-known/openid-configuration').then(r=>console.log('google',r.status)).catch(e=>console.log('FAIL',e.cause?.code))\""
powershell -NoProfile -Command "& 'C:\Users\sangm\AppData\Local\nvm\v20.18.0\node.exe' -e \"fetch('https://api.github.com/').then(r=>console.log('v20 github',r.status)).catch(e=>console.log('FAIL',e.cause?.code))\""
# Expect: github 200 / google 200 / v20 github 200
```

### AC-7, AC-8 — services, restarted through their UNCHANGED launchers. This is the checkpoint: confirm before killing 9Router if agent work may be in flight.

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 20128,3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force }"
powershell -NoProfile -Command "Start-Process wscript.exe -ArgumentList '\"C:\repos\ryo_claude\ryo-9router\9router\scripts\start-9router-silent.vbs\"'"

curl -s -m 45 http://127.0.0.1:20128/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gh/gpt-5.6-luna","messages":[{"role":"user","content":"reply with the single word ok"}],"max_tokens":16}' \
  | head -c 800
# PASS = a completion, or 401/403.  FAIL = 502, or any UNABLE_TO_GET_ISSUER_CERT_LOCALLY

# Bridge in the FOREGROUND so its output is readable
cd ~/.buzz/bridge && timeout 20 node azure_relay_bridge.cjs 2>&1 | head -12
# PASS = "listening on http://127.0.0.1:3001" with NO "Clock sync error"
# "[Bridge WS Upstream Error]: Unexpected server response: 404" is the KNOWN failure (AC-14)
```

### AC-9, AC-10, AC-13 — the written record

```bash
cat ~/.certs/CA-POLICY.md
grep -n "use-system-ca\|v20.18.0" ~/.certs/CA-POLICY.md

for f in ~/.claude/CLAUDE.md \
         ~/.shared/ryo-projects/C-0828-buzz/context.md \
         ~/.shared/ryo-projects/C-0828-buzz/session-log.md \
         ~/.claude/my-plugins/skills/ryo-smart-provider-switcher/SKILL.md; do
  echo "=== $f"; grep -n "Google Trust Services\|refuted" "$f" | head -4
done

grep -n "dropped" /c/repos/ryo_claude/ryo-9router/9router/plans/zscaler-scoped-ca-fleet_2026-09-01.md \
                  /c/repos/ryo_claude/ryo-9router/9router/plans/9router-scoped-zscaler-ca_2026-09-01.md | head -4
```

### AC-11, AC-12 — the gate

```bash
bash ~/.certs/check-tls-fleet.sh; echo "EXIT=$?"
diff /tmp/baseline-tls.txt <(bash ~/.certs/check-tls-fleet.sh) || true

# AC-12 — the two pre-existing global variables must be untouched
powershell -NoProfile -Command "'REQUESTS_CA_BUNDLE: ['+[Environment]::GetEnvironmentVariable('REQUESTS_CA_BUNDLE','User')+']'; 'CARGO_HTTP_CAINFO:  ['+[Environment]::GetEnvironmentVariable('CARGO_HTTP_CAINFO','User')+']'"
py -c "import requests;print('py intercepted:',requests.post('https://models.github.ai/inference/chat/completions',json={},timeout=20).status_code)"
# Expect both variables populated, py intercepted: 410
```

### Rollback, if anything regresses

```bash
powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('NODE_EXTRA_CA_CERTS',\$null,'User')"
# Then re-open shells and re-run the gate. No launcher was edited, so there is nothing else to undo.
```

## Human / pilot follow-ups

These are outside the Definition of Done — a coding session cannot produce them.

1. **Open Antigravity and complete a Google sign-in.** This plan reverses the Session 7 decision on
   evidence, and the automated proxies (AC-5, AC-6) cannot exercise Antigravity's own TLS stack. If it
   fails, the rollback above is one command, and the failure is then a genuine data point rather than
   the assumption Session 7 shipped.
2. **Reboot or log out and back in once**, then re-run the gate script. This confirms the variable
   survives a session boundary and that the Startup shortcuts inherit it, which is the whole point of
   choosing a User-scope variable over launcher edits.
3. **Decide whether Node v20.18.0 is still needed.** If it can be removed, a global
   `NODE_OPTIONS=--use-system-ca` becomes available and the certificate file stops being load-bearing
   at all. Not required; a strictly better end state.

## Turn Budget

`45 turns`

## References

- Measured this session: host issuers via `openssl s_client`; per-Node-version
  `NODE_EXTRA_CA_CERTS` results; `NODE_OPTIONS` rejection on v20.18.0; the five-host
  `--use-system-ca` trust-narrowing matrix; `LocalMachine\Root` composition
- `~/.shared/ryo-projects/C-0828-buzz/session-log.md` — Session 7 (the refuted diagnosis, and its own
  closing note recording the contradiction), Session 12 (Weir scoped launcher)
- `~/.claude/CLAUDE.md` — the per-app CA rule this plan retires
- `~/.claude/my-plugins/skills/ryo-smart-provider-switcher/SKILL.md:113` — the scoped-override pattern,
  which stays valid for AWS SSO but stops being the general answer
- `~/.buzz/bridge/azure_relay_bridge.cjs:16,23,139,178` — upstream URL, clock-sync fetch, and the two
  `rejectUnauthorized: false` sites
- Superseded: `zscaler-scoped-ca-fleet_2026-09-01.md`, `9router-scoped-zscaler-ca_2026-09-01.md`

## Risks / Open Questions

- **Antigravity is the one unfalsifiable-in-session risk.** Google is demonstrably not intercepted, so
  there is no mechanism by which `NODE_EXTRA_CA_CERTS` reaches its sign-in TLS — but Antigravity is an
  Electron-class app and may consume `NODE_EXTRA_CA_CERTS` in a main-process path this plan cannot
  observe. Mitigated by a one-command rollback and by Human follow-up 1, not by an assumption.
- **A global variable has a wider blast radius than a launcher edit.** That is the trade being made
  deliberately: the launcher approach has a narrower radius per change and an unbounded number of
  changes. The mitigation is that `NODE_EXTRA_CA_CERTS` is additive and was proven not to narrow trust
  on `registry.npmjs.org`, and that the gate script makes the radius measurable.
- **A false "regression" from the missing baseline.** ryo-aws-dashboard (6869) was never observed
  listening, and its AWS profile does not exist. AC-1 exists to stop that being attributed here.
- **A false green from a stale process.** 9Router's current process predates the variable and will not
  inherit it. Restart before AC-7, and run AC-4/AC-5 in a genuinely new shell — an existing shell will
  not see a variable set after it started.
- **Buzz will probably still not chat after this plan completes,** because of the upstream 404. The DoD
  does not claim otherwise. If working Buzz chat is the real goal, the 404 is the next plan and this
  one is its prerequisite.
- Turn budget may need to increase if the four document corrections surface further copies of the
  refuted rule beyond the ones enumerated in the Stack section.
