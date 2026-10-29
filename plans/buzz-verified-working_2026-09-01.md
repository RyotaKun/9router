# Plan: One verified-working Buzz — every "working" proven by read-back at the user's layer

**Created:** 2026-09-01
**Runner / target model:** `claude-opus-5` (no `--for`, target = runner)
**Project:** C-0828-buzz

---

## Why this plan exists — the failure pattern it must end

Today's session fixed real defects (CA variable, relay DB mount, community rebuild, bridge Blossom
re-sign, clock sync, owner bootstrap) but repeatedly declared "working" from a layer BELOW the one
the user experiences, and each claim was then falsified by the user's own test:

| Claim made | Layer it was verified at | What the user saw |
|---|---|---|
| "9Router is fixed" | port listening + front-door error changed | dashboard 500, agent 502 (old process, no env) |
| "avatar works now" | CLI upload → 200 | app: "couldn't finish upload" (profile event 400) |
| "avatar is saved" | kind-0 profile field on relay | user still reported failure |
| "invite works" | mint → 200 via API | app: "invalid base64 data" on claim |

**Root rule this plan enforces: a thing is "working" only when the full user journey round-trips —
write it, read it back, fetch the bytes — at the same layer the user touches, and the final word
comes from the user's one-pass checklist, not from any lower-layer proxy.**

Known-good facts (verified this session, sources in References):
- Global `NODE_EXTRA_CA_CERTS` set; clock offset now 0s; relay rebuilt with persistent mount;
  user `31a875c6…9b3632` bootstrapped as owner (`Relay owner bootstrapped` in relay logs).
- Live invite: `v2.WgwPuu9yAjG918F-73KJN1uABUq3J_-50aRBaO-MYXg` (expires ~3 days).
- Claim endpoint: `POST /api/invites/claim`, body `{"code":"…"}`, NIP-98 signed by the JOINING key,
  exempt from the membership gate (`invites.rs:352-372`, struct at `:91`).
- Open defect: claiming in the app UI reported **"invalid base64 data"** — unresolved.

## Brief

A single verification suite proves every core Buzz journey end-to-end by read-back — including a
synthetic "fake teammate" who claims the live invite with a brand-new key and chats over the direct
URL exactly as a phone would — and a one-pass human checklist confirms the same journeys at the UI,
so "working" is never again claimed from a proxy layer.

## Stack

- Bash + Node v25.2.1 (nostr signing via `C:\repos\ryo_claude\buzz\desktop\node_modules\nostr-tools`)
- `buzz.exe` CLI (`upload file --file`, `users get --name`), `buzz-acp.exe` (WS auth probe)
- Bridge `~/.buzz/bridge/azure_relay_bridge.cjs` (3 edits today — treat as changed code under test)
- Relay: `struong-relay…azurecontainerapps.io` (rev 0000006); Azure CLI with
  `REQUESTS_CA_BUNDLE=~/.certs/zscaler-combined.pem`
- Suite location: `~/.buzz/bridge/buzz-e2e.sh`; evidence dir `~/.buzz/bridge/e2e-evidence/`
- Reasoning effort: `medium`. Do not disable thinking.

## Scope — Functionality

The suite `buzz-e2e.sh` runs these journeys and exits non-zero on the first unproven read-back.
Every PASS requires the read-back, never the write status:

1. **[fake-teammate — the mobile/team journey, direct URL]** Generate a throwaway keypair →
   NIP-98-signed `POST /api/invites/claim` with the live code **direct to the Azure URL** →
   WS connect `wss://…` → complete NIP-42 AUTH → `REQ` a channel → receive `EOSE` →
   publish a test message → **read the same message back by id**. This is the exact journey the
   phone and every invited teammate performs. If module-resolution for `nostr-tools` fights the
   script, sign inside a script placed in `C:\repos\ryo_claude\buzz\desktop\` where resolution is
   proven, or reuse the bridge's own resolve lines (`azure_relay_bridge.cjs:6-8`).
2. **[same journey through the bridge]** Repeat journey 1 over `ws://127.0.0.1:3001` with a second
   throwaway key — proves the desktop path end-to-end including all three of today's bridge edits.
3. **[media]** Upload a PNG via `buzz.exe upload file` through the bridge → `GET` the returned URL
   **direct with CA** → assert HTTP 200, `content-type: image/*`, and byte sha256 equals the
   upload's reported sha256.
4. **[profile]** Read the owner's kind-0 (`users get --name Ryotakun`) → assert `picture` non-null →
   `GET` that URL → 200 + image bytes. (Asserts state, not a new upload — the app upload is human
   checklist item 1.)
5. **[agents]** Authenticated `POST /v1/chat/completions` to 9Router for `gh/gpt-5.6-luna` → assert
   a completion arrives (401/403 = FAIL here: agents need working credentials, unlike the TLS-only
   plan) → assert the `buzz-acp` agent for `claude-st` or `gh-luna-5-6` holds a live relay session
   (presence via CLI, or process + no terminal error in its newest
   `agents/logs/*__222da16d….log`).
6. **[invalid-base64 diagnosis]** With journey 1 proving the code valid via API, decode where the
   app fails: attempt the claim the way the UI does (paste-string variants: full URL, `v2.…` code,
   bare base64 after `v2.`) against the claim endpoint, record which variant the relay rejects with
   "invalid base64", and write the exact working paste-string into the checklist. If the defect is
   client-side parsing (likely: the app strips nothing and base64-decodes `v2.…` including the
   prefix), say so with the evidence and give the URL-open path as the working route.
7. On any FAIL: capture `tail -50` of `/tmp/bridge-live.log`, the newest relay log window, and the
   failing HTTP body into `e2e-evidence/<journey>-<timestamp>/` before exiting.
8. **Human checklist** written to `~/.buzz/bridge/CHECKLIST.md`: 5 items, each "do X → you should
   see exactly Y → if not, report the exact text on screen": app avatar upload; mobile joins via
   the invite **URL opened in the phone browser** (not pasted); mobile sends a message visible on
   desktop; desktop sends, visible on mobile; @-mention an agent, reply arrives. One pass, run
   once, results reported back in one message.

## Out of Scope

- Any new feature work, bridge refactors (incl. removing `rejectUnauthorized: false`), or doc/policy
  cleanup from the architecture plan — nothing changes unless a journey fails and the fix is
  required to make it pass.
- Rebuilding Buzz binaries with native TLS roots; teammate-machine Zscaler setups.
- The AWS dashboard profile defect (unrelated to Buzz).
- Automating the desktop/mobile UI itself (Tauri/phone — not automatable here; that is exactly what
  the human checklist covers).

## Constraints

- **The word "working" is banned from the report unless the line cites the read-back evidence**
  (file in `e2e-evidence/`, message id read back, byte hash matched). Deliver what was asked, at
  the scope intended; if a journey cannot be made to pass, report it RED with evidence — do not
  narrow the journey definition to make it pass.
- **No stale-process false greens:** every service check first asserts the process it tests started
  after today's fixes (9Router env carries `NODE_EXTRA_CA_CERTS`; bridge PID newer than the last
  edit's mtime). A check against a stale process is void.
- **Throwaway keys only** for synthetic identities; never publish as the user's key except the
  read-only profile assertion. The invite has unlimited uses, so two synthetic claims are safe;
  name the synthetic members `e2e-probe-1/2` so the user can remove them later.
- Source traceability: every claim in the final report names its evidence file or command output.
- The relay is live infrastructure the user's team is joining today: no relay restarts, no env
  changes, no DB writes beyond the two synthetic members and their test messages.
- Pause only for a destructive or irreversible action, a real scope change, or input only the user
  can provide. Otherwise keep going.
- Before your first tool call, say in one sentence what you're about to do. While working, give a
  brief update only when you find something important or change direction. When you finish, lead
  with the outcome.
- Only correct an earlier statement when the error would change the user's conclusions; fix silent
  slips without narrating them.
- Match the length of written documents to what the task needs: the checklist is five items, the
  report is one table.

## Definition of Done

`~/.buzz/bridge/buzz-e2e.sh` exits 0 with all six journeys green — each PASS line citing its
read-back evidence (claimed invite → authed WS → message id read back on both direct and bridge
paths; media bytes hash-matched; profile picture URL serving 200 image bytes; a model completion
returned; the base64 defect reproduced and the working claim path named) — and
`~/.buzz/bridge/CHECKLIST.md` exists with the five one-pass human steps and exact expected results.

## Acceptance Criteria

- **AC-1** A throwaway key claims the live invite via `POST /api/invites/claim` on the **direct**
  URL and the response confirms membership (evidence file saved).
- **AC-2** That key completes NIP-42 over `wss://` direct, receives `EOSE`, publishes a message,
  and **reads the same message id back**.
- **AC-3** A second throwaway key completes the same claim→auth→post→read-back over
  `ws://127.0.0.1:3001`.
- **AC-4** A PNG uploaded through the bridge is fetched back from its returned URL with HTTP 200,
  image content-type, and matching sha256.
- **AC-5** The owner profile's `picture` URL returns HTTP 200 with image bytes.
- **AC-6** 9Router returns a model completion for `gh/gpt-5.6-luna` on an authenticated request,
  and the process serving :20128 has `NODE_EXTRA_CA_CERTS` in its environment.
- **AC-7** A `buzz-acp` agent session is live: agent process running AND its newest log contains a
  successful relay connect with no terminal error after it.
- **AC-8** The "invalid base64 data" failure is reproduced against the claim endpoint with the
  paste-variant that triggers it, and the checklist names the variant that works.
- **AC-9** `buzz-e2e.sh` exits non-zero when any journey fails and writes the evidence bundle;
  proven once by running it with a deliberately wrong invite code before the real run.
- **AC-10** `CHECKLIST.md` exists: five steps, each with the exact expected on-screen result.

## Verification

```bash
# The suite is the verification. Mutation-prove it first (AC-9):
BUZZ_E2E_INVITE="v2.WRONGCODE" bash ~/.buzz/bridge/buzz-e2e.sh; echo "EXIT=$? (expect non-zero)"
ls ~/.buzz/bridge/e2e-evidence/ | tail -3

# Real run:
bash ~/.buzz/bridge/buzz-e2e.sh; echo "EXIT=$?"

# Stale-process guards, standalone:
powershell -NoProfile -Command "\$p=(Get-NetTCPConnection -LocalPort 20128 -State Listen).OwningProcess; (Get-CimInstance Win32_Process -Filter \"ProcessId=\$p\").CommandLine"
ls -l ~/.buzz/bridge/azure_relay_bridge.cjs /tmp/bridge-live.log   # log mtime > cjs mtime

cat ~/.buzz/bridge/CHECKLIST.md
```

## Human / pilot follow-ups (outside the DoD — the final word)

1. Run `CHECKLIST.md` once, top to bottom, and reply with the five results in one message.
2. Remove the two `e2e-probe-*` synthetic members from the community afterwards (owner UI or
   moderation CLI).

## Turn Budget

`50 turns`

## References

- `crates/buzz-relay/src/api/invites.rs:91` (ClaimInviteRequest), `:352-372` (claim, membership-gate
  exempt), `:276-300` (mint, owner/admin)
- `crates/buzz-media/src/auth.rs:43,122` (kind 24242, BUD-11 server tag) — today's bridge fix
- `~/.buzz/bridge/azure_relay_bridge.cjs:6-8` (module resolution), Blossom re-sign + nonce blocks
- Bridge log `/tmp/bridge-live.log`; relay logs via
  `REQUESTS_CA_BUNDLE=~/.certs/zscaler-combined.pem az containerapp logs show -n struong-relay -g Panviva_Dev_RG_struong`
- Live invite + owner bootstrap: this session, 2026-09-01

## Risks / Open Questions

- **The base64 defect may be inside the desktop/mobile app binary** — then no local fix exists; the
  deliverable becomes the proven working claim path (open the invite URL) plus an upstream bug note
  with the reproduced evidence. That still satisfies AC-8.
- **NIP-42 over raw `ws` from a script** needs correct challenge signing; if the handshake fights,
  `buzz-acp.exe --private-key <throwaway> --relay-url ws://127.0.0.1:3001` with a dummy agent is an
  acceptable auth-layer probe for AC-3's connect step, but the post→read-back must still happen
  (CLI `messages` commands may serve it).
- The invite expires ~3 days from mint; if expired at execution time, mint a fresh one first (owner
  key + bridge, as done this session).
