# Desktop sync scale tier

This tier runs the actual plugin in two disposable desktop vaults, against a configured
real server. It is deliberately separate from the ordinary e2e pool: it quits and kills
the entire application. Never run it in a session containing personal vaults.

The machine-specific transport, resource reservation, vault registration and app guardian
belong outside this repository. They must reserve the desktop exclusively using the bench's
pool/app lock protocol, supervise the process tree, restore the original app registry,
remove generated vaults, and release resources even if the transport disappears. A live
supervisor writes a lease file containing `{"pid":12345,"exclusive":true}`. The runner
checks its liveness; this file is a contract with the supervisor, not a security boundary.

## Inputs

Build the desired branch or commit in a disposable checkout with the normal checked build.
Pass the resulting `plugin/build` directory and the **resolved commit SHA**, not a moving
branch name. Asset digests and the build's recorded revision are checked before installation.
The build can be changed independently of this driver, including to test an SDK migration.

### Building with a development SDK archive

`build.mjs` prepares a **clean detached checkout** at an explicitly resolved plugin commit.
Run it under the external supervisor's build resource reservation, before taking the app
lease. It does not acquire machine or app locks itself. Its configuration is separate from
the live credentials and vault configuration:

```json
{
  "pluginRoot": "/test-export/plugin",
  "build": "resolved 40-character plugin commit",
  "output": "/test-run/evidence",
  "sdkTarball": {
    "path": "/test-inputs/sync-sdk.tgz",
    "sha256": "SHA-256 supplied with the archive"
  }
}
```

```sh
node tests/scale/build.mjs /test-run/build-config.json
```

The archive checksum is checked before npm runs. A private snapshot of those exact bytes is
installed with scripts disabled. The export's package and lock metadata record an honest
local-file dependency and SHA-512 integrity; the SDK payload is hashed and checked again
before and after compilation. Only dependency metadata changes in the export; product source
and the production registry-pin verifier are untouched. Omit `sdkTarball` for the ordinary
registry build. `offline: true` forbids dependency downloads; otherwise npm may fetch the
archive's transitive dependencies. `npmCache` can name the supervisor's disposable cache.

The explicit archive build substitutes checksum/payload verification for the registry-only
release-pin check. It still runs the original normal and strict type checks, requires their
matching input receipt around bundling, and runs the original artifact verifier. This is a
development test artifact, not a registry release qualification. Start a fresh export after
a failed preparation rather than repairing an override in an attached branch.

`build-receipt.json` in `output` records the base plugin revision, archive path/SHA-256,
installed version, local lock resolution/SHA-512, every SDK payload hash, dependency metadata
hashes, changed metadata paths, and artifact provenance. Its manifest digest hashes canonical
`JSON.stringify` output. Keep `output` outside the export or under an ignored scratch folder.
For the live configuration, set `buildReceipt` to that receipt and carry the same
`sdkTarball` selection. The runner verifies the receipt against the selected artifact before
creating server content. An SDK override without its matching receipt fails closed.

The default shape is `smoke`: exactly 1,000 payload files and 200 MiB. `scale` is exactly
33,000 payload files and 11 GiB. Both use the same generator and seeded content algorithm.
`parameters.files` and `parameters.bytes` override these sizes. The payload has deep folders,
mostly small UTF-8 markdown, Unicode/spaces, case-only siblings, configuration and plugin
data paths, and opaque PNG/PDF attachment payloads with a bounded long tail. Attachment
payloads exercise storage and transfer, not image/document rendering. The smoke shape
includes a file exceeding 100 MiB. A case-sensitive volume is mandatory; filesystem folding
fails before generation rather than overwriting a sibling. No sparse files are generated.

The token is read at runtime from `tokenFile`. It must allow creation of a new server folder
and issuing a token for that folder. The runner creates a unique synthetic scope, never resets
the server, and revokes the issued token afterwards. Synthetic server content is retained for
diagnosis; removing that scope is a separate operator action. Its generated `.obsidian` paths
are nested inside this scope, so this tier does not approve or exercise executable plugin
installation or root settings propagation.

Example configuration (all locations are examples):

```json
{
  "leaseFile": "/test-run/lease.json",
  "app": "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
  "cli": "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli",
  "buildDir": "/test-build/plugin/build",
  "build": "resolved commit SHA",
  "vaults": ["/test-volume/scale-a", "/test-volume/scale-b"],
  "output": "/test-run/evidence",
  "tokenFile": "/test-secrets/owner-token",
  "server": "https://sync.example.test",
  "shape": "smoke",
  "seed": 42,
  "timeoutMs": 180000
}
```

Both empty vault directories must already be registered and set to open at application
startup by the supervisor. The app must be stopped before invocation. Run from `plugin/`:

```sh
node tests/scale/run.mjs /test-run/config.json
```

CLI evaluations reuse the e2e helper's nonce-framed replies and child-process cleanup, so
a completed action does not wait for an inherited output pipe to close.

Only the smoke shape should be used while developing this tool. The large shape is an
explicit later reliability gate, not a default test or an npm/CI hook.

## Observations and scenarios

Each device gets its own streaming loopback proxy. Tokens with rewritten loopback addresses
are temporary files with mode 0600, removed on exit. HTTP bodies and authorization headers
are never logged. WebSocket upgrades are forwarded and severed during network interruption.
Direct oracle downloads bypass these proxies and cannot inflate plugin download counters.

Proxy breakpoints hold a successful content commit acknowledgement, an active large upload, a comparison response and
a content response, so the driver can quit mid-batch, kill mid-large-file, quit during
comparison and pause mid-pull. It also drops/restores an active connection and disables/enables
the plugin while a request is active. The large-file kill runs first; the batch quit cuts
after a content commit is confirmed on the server and before the client sees its reply.
Missing triggers time out and fail. It then joins the
second vault, edits on both devices, settles, and restarts a synced vault. A startup observer
loaded before the plugin records each DOM notice's text and timestamp and renderer long tasks.
The controller's timestamped scenario phases assign each notice its phase in both reports.
Notice evidence is local run output and may contain sensitive text; never commit it.
It does not change the plugin's transport or engine implementation.

After the app stops, every expected file is hashed on both devices. Every server file in
the scope is downloaded through the server API and independently hashed, including size.
Missing, extra and corrupt files fail separately. This compares bytes against the generated
source and directed edits, not against the plugin ledger. Upload SHA paths and commit/manifest
metadata identify downloads of device-owned bytes; unresolvable content requests fail closed.
Ownership is ordered by request: a later upload never reclassifies an earlier remote download.
The primary's persisted connection selective settings, actual config folder and ignore file
determine the peer/server expected set. Excluded payloads are listed as "excluded by settings"
and must be absent there; the primary still must retain every generated byte. Optional
`pluginSettings` seeds the plugin's settings file before startup. Case-only siblings remain
strict unless the primary exposes a refusal for that exact path in status or its activity log;
the report retains those refusals. A similarly spelled path is never sufficient.

Each run emits `report.json`, `report.md` and `renderer.jsonl`. The JSON includes sanitized
wire events, actual interruption triggers, mismatches, files/s, MiB/s and each measured budget.
Restart timing starts at app launch; resume timing measures the next upload/commit request.
Pause timing starts before the pause CLI action and includes completion of already active
requests. New HTTP requests include endpoint/kind summaries, per-second buckets and each
request's click-relative time. Caller attribution is null unless supplied by the trace.
Response closures, including cancellations, carry timestamps. If an active request vanished
without a completion timestamp, stop latency is unknown and fails its budget; absence of new
requests alone never proves zero stop latency.
The in-renderer pause invocation timestamp is recorded separately from the controller's
earlier observation boundary. The original strict request-window budget is retained.
Startup reports retain launch totals and observe the product's existing `abele:onload-start`
performance mark, emitted at entry to its onload. The first-request and idle budgets start
from that product mark; absent marks fail the budgets. Observer load remains a separate time.
No product code is changed. Product sync-start markers are not available in the current trace;
plugin-load-to-sync-start and sync-start-to-request stay null. During pause only, the observer
captures the existing transport debug log's call stack without changing requests. Matching
device/method/path/time evidence is attached to the pause timeline; missing matches stay null.
The primary's exact refusal statuses and timestamped visible activity events are retained in
JSON at settle points; summaries and case-refusal evidence are included in Markdown.
Notice
counting covers the entire instrumented app lifecycle, including second-device join.
Throughput includes interruption downtime; it is not a raw-link benchmark. Renderer long tasks
are reported as an upper bound for all renderer activity, without attributing them to sync.
Missing measurements fail; a failed scenario never becomes an implicit pass.
Device settle failures are retained while later reachable steps and the byte oracles continue.
Byte equality cannot pass unless both device scans and every server download finished.

Targeted harness tests:

```sh
npx vitest run tests/harness/scaleHarness.test.ts --maxWorkers=2
npx vitest run tests/harness/scaleBuild.test.ts --maxWorkers=2
```
