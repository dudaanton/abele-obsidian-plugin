# Stand execution policy and current reviewed input

Core/protocol now use exactly `ac0df5090f7e754cda76296fbf3c8081d1076115`. The vendoring process
exports committed source, installs its exact lockfile in owned scratch, builds there and verifies
archive/installed payload checksums. The stand server and CLI fixture is from that same archive;
no live sibling checkout build is consumed. Historical API fixtures remain explicit and separate.

## Native app is shared, never automatically recovered

An unattended worker must **never start, relaunch, restart or quit the Obsidian app**, even with
an app lock. There is no `osascript quit`, `open -a`, `killall`, forced app kill or URI-launch
fallback. The manager owns that decision because other sessions' pool vaults live in the app.

The stand runner requires an already running app and a valid nonce-framed reply proving the
leased vault is the requested vault, before installing a build. A missing/closed/unresponsive
owned-vault CLI is a reported blocker, not permission to open another window or retry through
an app recovery procedure. Only the owned CLI/proxy process groups may be reaped at their
existing deadlines; the app process is never killed. Pool build/style/manifest bytes are restored
where installed; an unavailable restoration reload is left explicitly for the manager.

No native timeout, mandatory assertion or enabled-stage requirement is relaxed. The allocator
still leases one pool vault, and the clipboard helper still needs the short shared app gate and
other leases drained before touching global clipboard state. It restores all items/formats
exactly. Production feature flags remain false.

## Current checkpoint

- Exact archive and installed payload verification pass.
- Full offline suite: **420 files / 4,933 tests passed** with explicit immutable fixtures.
- Types, development/production builds and production testing-module graph guard pass.
- Lint: **0 errors / 311 existing warnings**; testing/fixture artifact markers: **0**.
- The one gate 43 rerun attempt on the new pin stopped before build installation because the
  leased vault supplied no valid CLI reply. Its lease was released and the app was left untouched.
- Native gate 43 on this new pin is therefore **blocked**, not green. Earlier green results on
  another input are preserved as historical evidence and are not transferred to this pin.
- Collaboration scenario C (task 56) and Books desktop simulation B (task 58) have not started;
  their ordered prerequisite is this native rerun. No real Boox/Android validation is implied.

The manager must supply a healthy, already open/routable pool before the ordered native work
continues. An unavailable CLI's cause is not inferred from a missing reply.
