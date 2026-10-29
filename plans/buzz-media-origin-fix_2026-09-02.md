# Buzz — agent-posted images render broken (media origin mismatch)

**Created:** 2026-09-02
**Target model:** claude-opus-5 (runner = target; no `--for` given)
**Supersedes for this topic:** the "Option B — bridge on 443 with a trusted cert" decision recorded in the 2026-09-01 handoff. That design is refuted; see Rejected options.

---

## Brief

Relay-hosted media renders in the Buzz desktop client while chat stays connected, and the fix is
chosen from an observed measurement rather than from an inference about the origin check. This
matters because the current session produced a confident recommendation (install MSVC, rebuild the
app) whose central premise is contradicted by a live fact, and acting on it could cost a multi-GB
install and a multi-hour build for the wrong reason.

---

## Stack

- Buzz desktop — Tauri 2, Windows ARM64, installed at `C:\Users\sangm\AppData\Local\buzz\buzz-desktop.exe` (build dated 2026-08-26)
- Buzz source — `C:\repos\ryo_claude\buzz` @ HEAD `b49675894`
- Rust — cargo 1.98.0, rustc 1.98.0, target `aarch64-pc-windows-msvc` installed
- MSVC C++ toolchain — **absent** (`VC\Tools\MSVC` does not exist; no Windows SDK; only `C:\Program Files\Git\usr\bin\link.exe`)
- Bridge — `~/.buzz/bridge/azure_relay_bridge.cjs`, Node, `ws://127.0.0.1:3001`
- Relay — Azure Container Apps, `struong-relay.victoriouspebble-7d643944.eastus.azurecontainerapps.io`
- buzz CLI — `C:\Users\sangm\AppData\Local\buzz\buzz.exe`
- Effort: **high**

---

## Settled facts (each with its source)

| Fact | Source |
|---|---|
| Desktop WS fails with `invalid peer certificate: UnknownIssuer` | captured stderr, `native_relay_client.rs:441`, log `C:\Users\sangm\.buzz\.scratch\desktop-stderr.log` |
| Installed exe was built from `rustls-tls-webpki-roots` | `git show HEAD:desktop/src-tauri/Cargo.toml` line 86 |
| Working tree (uncommitted) switches to `rustls-tls-native-roots` | `git diff -- desktop/src-tauri/Cargo.toml`, line 88 |
| Relay serves a complete chain to `Zscaler Root CA`, which is in `LocalMachine\Root` and `CurrentUser\Root` | `openssl s_client -showcerts` (3 certs); `Get-ChildItem Cert:\*\Root` |
| `reqwest` (media proxy) has no TLS feature named → schannel → trusts Zscaler | `desktop/src-tauri/Cargo.toml:104` |
| Media URL = `{scheme}://{tenant_host}/media`, scheme from the relay's own configured URL | `crates/buzz-relay/src/api/media.rs:484-491`; test at `:1304` yields `http://localhost:3100/media` |
| Media reads always require auth; no public-read bypass | `crates/buzz-relay/src/api/media.rs:525` |
| `cachedRelayOrigin` is populated by a **local** Tauri call (`get_relay_http_url`), not by the network | `desktop/src/shared/lib/mediaUrl.ts:190-197` |
| Origin comparison includes the scheme (`new URL().origin`) | `desktop/src/shared/lib/mediaUrl.ts:47-53, 323-326` |
| Stored avatar URL is on the **cloud** host, same shape as the broken agent image | `buzz.exe --relay http://127.0.0.1:3001 users get` → `picture: https://struong-relay.…/media/ded7201b….jpg` |
| Only `libloading` (0.7.4, 0.8.9) is Zscaler-blocked, of 1177 desktop registry crates | `crate-probe-desktop.tsv`: 152×200, 2×403 |
| `cargo fetch` for the desktop workspace succeeds with the libloading git patch | `cargo-fetch-desktop.log` → `FETCH_EXIT=0` |
| Agents post images as markdown prose URLs with no `imeta` tag; `--file` emits one | `crates/buzz-cli/src/commands/messages.rs:650-664` (per 2026-09-01 handoff) |

---

## The open contradiction this plan resolves first

The stored avatar is a **cloud-host** media URL, and the operating recipe records the app as
displaying it, while the agent's image — also a cloud-host media URL — renders broken. Under the
origin check as read (`mediaUrl.ts:323-326`), both should fail identically when the desktop is
connected via the bridge.

Exactly one of these is true, and they lead to different fixes:

- **(a)** Cloud-host media *is* being proxied on the bridge. Then the origin check is not the
  cause, the defect is specific to the markdown/prose render path, and a cheap fix exists that
  needs no rebuild.
- **(b)** The recipe's avatar claim was never really verified (byte-verified via CLI, glanced at in
  the UI). Then the origin check stands and the rebuild is the fix.

Do not assume either. The plan's first job is to make the answer observable.

---

## Scope — Functionality

1. Capture the decisive observation protocol: relaunch the desktop with stderr captured, record the
   media-proxy port, and record which of the two known hashes the app resolves — avatar
   `ded7201b6d095371c7bef5a39f5de21d32ad2f1f5f6371baae7a16df2f9f0fe9.jpg` versus agent image
   `4749873005296cadb67a24db632aa79e1820a9c8aaecca1f7987682db112ad57.png`. Ship it as a runnable
   script, since the observation itself needs the app pointed at the bridge (a human step).
2. Adjudicate the three red-team critiques in a decision doc, each with at least one `file:line`
   citation, stating plainly which held and which did not.
3. Record all four candidate fixes with an explicit accept or reject and a one-line reason.
4. Capture the upstream-shaped change on a local branch `fix/ws-native-roots`, holding the
   `tokio-tungstenite` feature switch separable from the two local-only `[patch.crates-io]` entries,
   so the one-line fix can be sent to Block without the Zscaler workarounds attached.
5. Add a minimal `tools/tls-probe` crate that, once a linker exists, compiles in seconds and proves
   or refutes that `rustls-tls-native-roots` accepts the relay's chain — before anyone commits to a
   full app build.
6. Note the latent defect found in passing: the avatar URL is pinned to one host, so it is broken
   for phone and teammate clients regardless of this bug.

---

## Out of Scope

- Installing the MSVC C++ toolchain, and the full `buzz-desktop` rebuild. Both are human-gated; see
  Human follow-ups.
- Any change to the Azure relay — its configured URL, its tenant host bindings, or a redeploy.
- Fixing the host-pinned avatar URL. Record it; do not chase it.
- Opening the upstream PR to Block.
- Re-pointing the desktop's community relay URL. Only the user can do that in the UI.
- `/lo-synthesize` for the previous session, still pending.

---

## Constraints

- Every factual claim in the decision doc names its source — a file with a line number, a command
  with its output, or a named log. An inference is labelled as one.
- Do not modify anything under `buzz/desktop/src`, `buzz/desktop/src-tauri/src`, or `buzz/crates`.
  The only source-tree edits are the two `Cargo.toml` files already carrying uncommitted changes,
  their `Cargo.lock`, and the new `tools/tls-probe` crate.
- Do not push any branch, and do not commit on `master`.
- No destructive commands. If a working tree needs clearing, review `git status --porcelain` and run
  the `-n` dry-run first; never leave a destructive command bare.
- Treat the operating recipe's avatar claim as unverified until the observation lands. Do not
  restate it as fact in the decision doc.

> Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and
> check in only when different readings of the request would lead to materially different
> work. If the request seems mistaken or a better approach exists, say so in a sentence and
> continue with the task as asked rather than quietly narrowing, widening, or transforming it.
> Finish the whole task, and stop short of actions that are clearly beyond what was asked.

> Delegate to a subagent only for large tasks that are genuinely independent and
> parallelizable, such as a wide multi-file investigation. Do not delegate work you can finish
> yourself in a handful of tool calls, and do not use subagents to verify or double-check your
> own work. If one subagent can complete the task, use one rather than several, and keep spawn
> counts low.

> Match the length of written documents to what the task needs: cover the substance, but do not
> pad with filler sections, redundant summaries, or boilerplate.

> Only correct an earlier statement when the error would change the user's code, conclusions,
> or decisions. State corrections plainly and briefly, then continue the task. For slips that
> change nothing for the user, make the fix and move on without noting it.

> Before your first tool call, say in one sentence what you're about to do. While working, give
> a brief update only when you find something important or change direction. When you finish,
> lead with the outcome: your first sentence should answer "what happened" or "what did you
> find," with supporting detail after it for readers who want it.

---

## Candidate fixes to adjudicate

| # | Fix | Status going in |
|---|---|---|
| 1 | Rebuild desktop with `rustls-tls-native-roots`; desktop connects direct; bridge retires | Blocked on MSVC; premise unproven until `tls-probe` runs |
| 2 | Bridge impersonates the relay host on 443 with a machine-trusted cert | **Reject** — webpki-roots ignores the Windows store, so the cert is `UnknownIssuer` too |
| 3 | Bridge on port 80 as plain `ws://`, no cert | **Reject** — origin becomes `http://…` while media URLs are `https://…`; `mediaUrl.ts:47` compares scheme |
| 4 | Relay-side: bind the community's tenant host, and/or the relay's configured scheme, so emitted media URLs match the bridge origin | Real (`media.rs:484-491`), but pins media to one host/scheme and breaks phone/teammate clients; out of scope here, record the reasoning |

Fix 1 is the presumed answer only if the observation lands as **(b)**. If it lands as **(a)**, the
decision doc records a fifth option scoped to the markdown render path and Fix 1 drops to
"correct but not required".

---

## Definition of Done

The decision doc exists at `C:\repos\ryo_claude\ryo-9router\9router\plans\buzz-media-origin-decision_2026-09-02.md` adjudicating all three critiques and all four candidate fixes with `file:line` sources, and the buzz repo carries a local `fix/ws-native-roots` branch, a `tools/tls-probe` crate, and a runnable stderr-observation script, with no edits outside the allowed file list.

---

## Acceptance Criteria

- **AC-1** The decision doc exists at the path named in the Definition of Done.
- **AC-2** The doc adjudicates each of the three red-team critiques, each carrying at least one `file:line` citation, and states for each whether it held.
- **AC-3** The doc lists all four candidate fixes with an explicit `accept` or `reject` and a one-line reason for each.
- **AC-4** The doc records the stored avatar URL verbatim and names it as the fact that falsifies the earlier "all relay media breaks on the bridge" claim.
- **AC-5** The doc states both branches of the unresolved observation — (a) and (b) — and which fix each one selects.
- **AC-6** Branch `fix/ws-native-roots` exists in `C:\repos\ryo_claude\buzz` and is not `master`.
- **AC-7** The branch's diff against `master` touches only: `Cargo.toml`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/Cargo.lock`, and files under `tools/tls-probe/`.
- **AC-8** The `tokio-tungstenite` feature change is in its own commit, separate from the commit carrying the `[patch.crates-io]` entries.
- **AC-9** `tools/tls-probe/Cargo.toml` declares `tokio-tungstenite` with `features = ["rustls-tls-native-roots"]`, and `tools/tls-probe/src/main.rs` connects to the relay `wss://` URL and prints either the negotiated result or the TLS error.
- **AC-10** An executable script exists at `C:\Users\sangm\.buzz\.scratch\observe-media.sh` that relaunches the desktop with stderr captured and greps that log for `connect failed`, `media proxy listening`, and both known media hashes.

---

## Verification

```bash
# AC-1..AC-5 — doc present and populated
D="/c/repos/ryo_claude/ryo-9router/9router/plans/buzz-media-origin-decision_2026-09-02.md"
test -f "$D" && echo "AC-1 ok"
grep -cE 'mediaUrl\.ts:|media\.rs:|Cargo\.toml:|native_relay_client\.rs:' "$D"   # expect >= 4
grep -icE 'accept|reject' "$D"                                                    # expect >= 4
grep -c 'ded7201b6d095371c7bef5a39f5de21d32ad2f1f5f6371baae7a16df2f9f0fe9' "$D"   # expect >= 1

# AC-6..AC-8 — branch exists, diff is scoped, commits are separated
cd /c/repos/ryo_claude/buzz
git rev-parse --abbrev-ref HEAD                     # expect fix/ws-native-roots
git diff --name-only master..fix/ws-native-roots    # expect only the 3 files + tools/tls-probe/*
git log --oneline master..fix/ws-native-roots        # expect >= 2 commits
git show --stat --oneline HEAD~1 | grep -c 'tokio-tungstenite' || true

# AC-9 — probe crate shape
grep -n 'rustls-tls-native-roots' tools/tls-probe/Cargo.toml
grep -nE 'connect_async|wss://' tools/tls-probe/src/main.rs

# AC-10 — observation script
test -x /c/Users/sangm/.buzz/.scratch/observe-media.sh && echo "AC-10 ok"
grep -cE 'connect failed|media proxy listening|4749873005296cad|ded7201b6d095371' \
  /c/Users/sangm/.buzz/.scratch/observe-media.sh    # expect >= 3
```

Negative check — nothing else in the source tree moved (anchor on the status code, so untracked
files do not read as modified):

```bash
cd /c/repos/ryo_claude/buzz
git status --porcelain | grep -E '^ ?M' | grep -vE 'Cargo\.(toml|lock)$' | grep -vE 'tools/tls-probe/'
# expect no output
```

---

## Human / pilot follow-ups (deliberately outside the Definition of Done)

1. **Run the observation.** Set the community relay URL back to `ws://127.0.0.1:3001` (this also
   restores chat, which is currently down because of my test), run
   `bash ~/.buzz/.scratch/observe-media.sh`, then say whether the **avatar** shows and whether the
   **agent image** shows. That single answer picks branch (a) or (b).
2. **Install the MSVC C++ toolchain** — Visual Studio Installer → Build Tools 2022 → Modify →
   *Desktop development with C++*, plus *MSVC v143 — VS 2022 C++ ARM64/ARM64EC build tools* and
   *Windows 11 SDK*. Needs Administrator. Free a few GB first: 30.5 GB free, workload ~8 GB, build
   output ~10-15 GB.
3. **Run `tools/tls-probe`** once a linker exists — seconds, and it decides whether the full rebuild
   is worth starting.
4. **Rebuild and install** `buzz-desktop.exe` only if the probe passes. Rollback copy is at
   `C:\Users\sangm\.buzz\.scratch\buzz-desktop.exe.bak-20260902`.
5. **Send the one-line `native-roots` change upstream to Block**, so an official build fixes this
   for every corporate-proxy user and the bridge can retire.
6. **Report the desktop avatar button bug upstream** (client sends nothing to the network).

---

## Turn Budget

`40 turns`

---

## Risks / Open Questions

- If the observation lands as **(a)**, Fix 1 stops being required and this plan's branch becomes an
  upstream contribution rather than a local remedy. That is a good outcome, not a failure.
- `tools/tls-probe` is a new crate in a repo whose workspace root **excludes** `desktop/src-tauri`
  (`Cargo.toml:35`). Place it so it does not silently join either workspace, or the desktop's own
  dependency resolution changes.
- The `libloading` block is a live Zscaler policy, not a fixed fact. Re-probe before trusting the
  patch: `curl -s -o /dev/null -w '%{http_code}' -r 0-0 https://static.crates.io/crates/libloading/0.8.9/download`.
- `rustls-native-certs` accepting this chain is still an inference from "the root is in the Windows
  store". Only `tools/tls-probe` converts it to a fact.

---

## References

- Prior plan: `buzz-verified-working_2026-09-01.md` (same directory)
- Operating recipe: `C:\Users\sangm\.claude\.shared\ryo-projects\C-0828-buzz\BUZZ-OPERATING-RECIPE.md`
- Captured logs: `desktop-stderr.log`, `cargo-fetch-desktop.log`, `crate-probe-desktop.tsv` under `C:\Users\sangm\.buzz\.scratch\`
- Broken message: channel `0fa35636-43fc-51c9-b23b-93d5e88f5bf6`, event `f13e5cade6b6a7788ef9e6bc9ace0930e476a0dbaacb7de7d3b7393f893139f1`
