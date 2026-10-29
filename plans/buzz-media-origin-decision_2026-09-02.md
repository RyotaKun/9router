# Buzz media origin mismatch — decision record

**Date:** 2026-09-02
**Plan:** `buzz-media-origin-fix_2026-09-02.md` (same directory)
**Status:** observation resolved → branch (b). The rebuild is the fix.

---

## The observation that decided it

With the desktop connected to the bridge (`ws://127.0.0.1:3001`), the user confirmed:

| Asset | URL host | Renders? |
|---|---|---|
| Agent-posted image `4749873005296cad….png` | cloud (`struong-relay.…azurecontainerapps.io`) | **no** |
| Own profile avatar `ded7201b6d09….jpg` | cloud (same host) | **no** |

Chat works on the bridge; both cloud-host media assets fail. That is branch **(b)**: the origin
check is the cause, and the defect is not specific to the markdown/prose render path.

**Consequence beyond the reported bug:** the bridge has been silently breaking *every*
relay-hosted image, custom emoji, reaction and avatar for as long as it has been in use — not just
agent images. All of them route through the same function (`rewriteRelayUrl`).

---

## Critiques adjudicated

### 1. "All relay media breaks" was grep-deep, not runtime — **HELD**

The claim was drawn from `rewriteRelayUrl` call sites, not from observed behaviour, and it
contradicted a recorded fact: the operating recipe states the CLI-set avatar was verified working
and "app displays it". The avatar URL is on the cloud host
(`buzz.exe --relay http://127.0.0.1:3001 users get` → `picture: https://struong-relay.…/media/ded7201b….jpg`),
so under the origin check it must fail exactly like the agent image.

Two sub-findings closed the gap:

- `cachedRelayOrigin` is populated by a **local** Tauri call, `invoke("get_relay_http_url")`
  (`desktop/src/shared/lib/mediaUrl.ts:190-197`) — not by the network. So the "origin not cached
  yet → proxy anyway" fallback at `mediaUrl.ts:318-328` does not apply in steady state, and the
  origin check is effectively always active. This was the specific thing the critique said was
  untested.
- The observation above then showed the avatar does **not** render. So the recipe's claim was the
  error, not the model.

**Recipe corrected.** `BUZZ-OPERATING-RECIPE.md` claimed the CLI-set avatar displays in the app.
It was byte-verified via `buzz.exe media get` and never visually confirmed in the UI.

### 2. The option space was never exhausted, only the client half — **HELD**

Relay-side options were never examined before "the only fix is the rebuild" was stated. They exist:
`crates/buzz-relay/src/api/media.rs:484-491` builds every media URL as
`{scheme}://{tenant_host}/media`, where `tenant_host` is per-community and `scheme` derives from the
relay's own configured URL. The test at `media.rs:1304` asserts `http://localhost:3100/media` as a
valid output, so a loopback tenant host is representable, and `buzz-core/src/tenant.rs:121`
(`normalize_host`) keeps non-default ports.

So a relay-side fix is real. It is still rejected — see Fix 4 — but on its merits, not by omission.

### 3. An 8 GB install and a multi-hour build sold on a deduction — **HELD**

That `rustls-tls-native-roots` fixes this was inferred from a Cargo feature plus an error string.
Nothing was run. No build had ever succeeded on this machine — the MSVC toolset is absent
(`VC\Tools\MSVC` does not exist; no Windows SDK; the only `link.exe` is Git's coreutils one, which
is what produced `link: extra operand` on the first attempt). The frontend build step is also
untried.

Mitigation shipped: `tools/tls-probe` (commit `dbe1703ad`) compiles in seconds once a linker
exists and answers the question before any full rebuild starts.

The critique also noted the app was left pointed at a URL it could not reach, so chat was broken
while an install was being requested. Correct; chat is restored.

---

## Candidate fixes

| # | Fix | Verdict | Reason |
|---|---|---|---|
| 1 | Rebuild desktop with `rustls-tls-native-roots`; connect direct; retire the bridge | **ACCEPT** | Only fix that makes the connected origin genuinely equal the relay origin. Chain is complete to `Zscaler Root CA` (`openssl s_client -showcerts`, 3 certs) and that root is in `LocalMachine\Root` + `CurrentUser\Root`, so native roots should accept it. `buzz.exe` (Rust) already pulls the exact image direct — 84,164 bytes, sha256 match — and a WSS handshake to the relay reaches `Open` under schannel. Still gated on `tools/tls-probe` |
| 2 | Bridge impersonates the relay host on 443 with a machine-trusted certificate | **REJECT** | The shipped binary uses webpki-roots, a compiled-in Mozilla list that ignores the Windows store (`git show HEAD:desktop/src-tauri/Cargo.toml` line 86). Any certificate we install returns the same `UnknownIssuer` already measured |
| 3 | Bridge on port 80 as plain `ws://`, no certificate | **REJECT** | Origin becomes `http://struong-relay…` while relay media URLs are `https://…`. `canonicalOrigin` uses `new URL().origin`, which includes the scheme (`mediaUrl.ts:47-53`), so `mediaUrl.ts:323-326` still mismatches |
| 4 | Relay-side: bind the community's tenant host and/or the relay's configured scheme so emitted media URLs match the bridge origin | **REJECT** (viable, wrong trade) | Real per `media.rs:484-491`. But media URLs are content: pinning them to `127.0.0.1:3001` or to `http://` breaks every phone and teammate client, and the scheme is a relay-wide setting affecting all tenants. It also needs an Azure Container Apps redeploy. Rejected on blast radius, not on feasibility |
| 5 | Agent attaches via `buzz messages send --file` (emits `imeta`) instead of pasting a markdown URL | **REJECT as a fix** | Worth doing for correctness, but it cannot fix this: attachments render through the same `rewriteRelayUrl` (`ComposerAttachments.tsx:176,181,281-282`), so they fail the same origin check. Branch (b) confirmed this by showing the avatar — not a prose URL — also fails |

---

## What shipped

Branch `fix/ws-native-roots` in `C:\repos\ryo_claude\buzz`, off `main`, three commits, six files,
nothing pushed:

| Commit | Contents | Upstream-safe? |
|---|---|---|
| `c324f283a` | `tokio-tungstenite` → `rustls-tls-native-roots` in both `Cargo.toml` files, plus the root `Cargo.lock` effect (`webpki-roots` → `rustls-native-certs`) | **Yes** — this is the one-line change to send to Block |
| `7b0e3f68c` | `[patch.crates-io]` for `webview2-com-sys` and both `libloading` majors, plus the desktop `Cargo.lock` | No — local Zscaler workaround only |
| `dbe1703ad` | `tools/tls-probe` | Optional |

The repo's pre-existing uncommitted edits (`CLAUDE.md`, `package.json`, `pnpm-lock.yaml`,
`rust-toolchain.toml`) were deliberately left alone.

Rollback copy of the installed app: `C:\Users\sangm\.buzz\.scratch\buzz-desktop.exe.bak-20260902`.

---

## Zscaler crate blocking — measured, not assumed

| Metric | Value | Source |
|---|---|---|
| Registry crates in the desktop lock | 1177 | `crate-probe-desktop.tsv` |
| Already in the local cargo cache | 1023 | same |
| Probed live | 154 → 152×200, 2×403 | same |
| Blocked | `libloading` 0.7.4 and 0.8.9 only | same |
| `cargo fetch` with the patch applied | `FETCH_EXIT=0` | `cargo-fetch-desktop.log` |

The block is per-crate and deterministic (3/3 tries), spans all versions tested (0.7.4, 0.8.6,
0.8.9), and also hits mirrors. `index.crates.io` returns 200, so only the download CDN is affected.
Re-probe before trusting the patch later:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -r 0-0 \
  https://static.crates.io/crates/libloading/0.8.9/download
```

---

## Remaining steps (all human-gated)

1. Install the MSVC C++ toolchain — Visual Studio Installer → Build Tools 2022 → Modify →
   *Desktop development with C++*, plus *MSVC v143 — VS 2022 C++ ARM64/ARM64EC build tools* and
   *Windows 11 SDK*. Administrator required. 30.5 GB free; workload ~8 GB, build output ~10-15 GB.
2. `cd tools/tls-probe && cargo run --release` — expect `PROBE OK`. If `PROBE FAIL`, stop: Fix 1 is
   wrong and this record needs reopening.
3. Rebuild: `cd desktop/src-tauri && cargo build --release`. Build from a **Developer PowerShell**,
   not Git Bash — Git Bash's `/usr/bin/link.exe` shadows the MSVC linker, which is what failed the
   first attempt. Skip installer bundling (`codeload.github.com` is 403 here).
4. Install the new exe, set the community relay URL to
   `wss://struong-relay.victoriouspebble-7d643944.eastus.azurecontainerapps.io`, and confirm chat,
   the agent image, and the avatar all work at once.
5. Send commit `c324f283a` upstream to Block.
6. Re-set the avatar afterwards if desired — the current stored URL is fine, but note the CLI-set
   avatar was never actually confirmed to render.
7. Report the desktop avatar **button** bug upstream (client sends nothing to the network).
