# Desktop metadata/version feasibility

## Gate and result

Task 01 is a **desktop feasibility probe**, not an enabled publisher. The live assertions
passed on Obsidian **1.13.7** (installer 1.13.7), Electron **43.3.0**, Darwin **27.0.0**.
The tested plugin baseline is `9a477a2f`.

The supported `metadataCache.on('changed', (file, data, cache) => ...)` signal supplies the
**text that was parsed**. Hashing that text and copying the cache immediately provides
source-version evidence even when the file on disk has already advanced. Looking up
`getFileCache(file)` after settlement does **not** provide that guarantee.

Automatic publication remains **blocked** until a durable adapter and engine preflight
implement the restrictions below, and the separate physical-iOS probe passes. This result
is not approval to activate sharing.

## Reproduce

Lease a pool vault using the local allocator; install this checkout's development build
on each take. Drive only that vault, and give it back afterwards. No app restart, vault
registration or global app-state mutation is needed.

```sh
cd plugin
OBSIDIAN_TEST_VAULT=<leased-pool-vault> npm run test:e2e -- tests/e2e/metadataVersion.e2e.test.ts
```

This file fails rather than skips when the required vault/native evidence is unavailable.
Its JSON output contains the full content SHA, copied cache/hash, capture generation,
link/embed spellings, resolved paths, unresolved spellings and synthetic ledger identities.
The probe uses a fresh nonce in the content so the worker really parses the delayed version
rather than reusing an earlier run's content-addressed cache.

## Observed evidence

- The worker was paused **after reading applied bytes**. An immediate local edit advanced
  the file before the worker finished. Before its matching event, the applied-version
  snapshot was unknown. After release, both applied and local generations were captured
  separately, with the expected SHA and different link sets.
- A copied applied snapshot stayed unchanged through subsequent settled-merge bytes and a
  note rename. The current cache was demonstrably not the older version's cache.
- Captures included a resolved PNG, its synthetic target identity, and an unresolved
  spelling. The unresolved spelling was retained, not omitted from the baseline.
- A PNG `File` was dispatched through Obsidian's **real editor paste handler** using a
  clipboard event. The asset's `vault.create` event preceded the note's `vault.modify`
  event. The pasted version's cache SHA matched the editor buffer. Thus an ordinary scanner
  can see/upload the asset before the corresponding note cache exists.
- With the observer detached, intermediate and latest note writes were made. A saved JSON
  baseline survived a **reload of only the leased vault's window**. After reload, current
  bytes/cache described the latest write, not the saved baseline or the missed intermediate
  version. A new observer cannot reconstruct missed evidence by reading the latest cache.

The tests assert correspondence to supplied **synthetic settlement bytes/version handles**.
They do not run a server pull/merge, persist a production IndexedDB link ledger, simulate
OS sleep, or intercept a real engine upload. Applied/merged bytes are written through the
native vault API, exercising the same metadata-indexing path; this is not an end-to-end
server-settlement claim. The restart test uses a synthetic JSON sentinel, not the future
production persistence adapter. Native iOS suspend/resume is a separate gate.

## Required implementation boundary

1. Register before reads/writes can settle. Deep-copy metadata and hash event `data`, not a
   later file read. Store the immutable result under connection/file ID/version ID/full SHA
   only when the engine's **exact** settlement bytes match that SHA. Capture generation and
   cache hash describe this observation, not a public Obsidian version number.
2. Before upload, prove candidate bytes match the event, current disk **and editor buffer**.
   If the cache lags or the buffer advanced, hold that publication-sensitive preflight.
   Keep unrelated personal sync working. A delay, mtime, latest cache or local-write marker
   is not evidence. Missing generations stay unknown; retain content and share nothing.
3. Persist new local-create identity and intent **before the asset scanner can settle the
   image**. Native paste demonstrably creates the image before saving the note. Merely
   waiting for the note's next cache event after ordinary upload is too late.
4. Link destinations from `getFirstLinkpathDest` are resolved against the **current vault
   inventory**, not an immutable source-version inventory. The supported event proves
   source bytes, not historical target identity or authorship. Freeze known ledger IDs and
   resolution evidence; hold unresolved, ambiguous, renamed/replaced or concurrently
   changing targets. Never upgrade an old unresolved spelling when a target appears.
5. Recovery uses durable copied evidence. Absent evidence cannot be replaced with current
   metadata. Received/merged baselines do not make their links owner-authored additions.

The probe temporarily intercepts private `metadataCache.work` solely to inject controlled
cache lag, restores it in `finally`, and deletes its synthetic folders/restores the layout.
It reports the private file-cache hash only diagnostically. **No private cache API is
required for the proposed source-byte evidence**, and no internal hash is treated as a
publication permission. Supporting another app version requires rerunning the native gate.
