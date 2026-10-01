# Desktop metadata/version feasibility

## Gate and result

Task 01 is a **desktop feasibility probe**, not an enabled publisher. The strengthened native
gate passed on Obsidian **1.13.7** (installer 1.13.7), Electron **43.3.0**, Darwin **27.0.0**.

The original probe was **not sufficient evidence of cache/data correspondence**: original
and applied bytes had identical links; only applied facts were partially asserted. Matching
a SHA to event `data` did not establish that the accompanying `cache` belonged to that text.
That earlier conclusion is superseded by the exact assertions below.

The supported `metadataCache.on('changed', (file, data, cache) => ...)` signal was observed
with cache link/embed facts matching the independently specified source fixtures, even while
disk bytes advanced. This is evidence for those native fixtures, not a universal cache-version
attestation or proof that a publication adapter is already sound. Automatic publication
remains **blocked** pending durable settlement/preflight integration and physical-iOS proof.

## Reproduce

Lease a pool vault, install this checkout's development build on each take, drive only that
vault, and release it afterwards. No global app restart or vault registration is needed.

```sh
cd plugin
OBSIDIAN_TEST_VAULT=<leased-pool-vault> npm run test:e2e -- tests/e2e/metadataVersion.e2e.test.ts
```

The native file fails rather than skips when its vault/evidence is unavailable. Its JSON
output includes source bytes, event data/SHA, copied cache/hash, capture generation, exact
link/embed spellings, resolved paths, synthetic ledger IDs and unresolved spellings.

## Exact fixture oracle

Each version has a distinct independently declared link set:

| Version | Links | Embeds |
| --- | --- | --- |
| Original remote baseline | `original-only` | `original.png` |
| Applied remote bytes | `applied-only`, `applied-unresolved` | `applied.png` |
| Immediate local edit | `local-only`, `local-second` | `local.png` |
| Settled merge-result fixture | `merged-only`, `local-only` | `merged.png`, `applied.png` |
| Native paste result | Exact merged links | Exact merged embeds plus the newly created PNG |

For **every** version, `metadataVersionAssertions.ts` asserts:

- event data equals the supplied version's exact bytes and both SHAs agree;
- raw cache link and embed tables equal the complete expected sets, with no foreign entries;
- copied/resolved facts equal exact kind/spelling/original/path/identity tuples;
- every cache token's offsets slice the corresponding original token from event data;
- the cache hash agrees with the immutable copied cache.

No `arrayContaining` subset success is used. Expected tokens are fixture literals, not
inferred from the observed cache. The paste filename comes from the independent native
asset-create event; its expected set is the merged set plus exactly that one embed.

Executable mutant tests substitute original cache for applied data, applied cache for local,
local cache for merged, and merged cache for paste. All substitutions are rejected, as are
foreign facts and wrong token positions. This closes the earlier false-positive scenarios.

## Native observations

- The real worker was paused **after reading applied bytes**, then a local edit advanced the
  file. Applied evidence was unknown until its matching event. After release, the distinct
  applied and local sets were captured and exactly verified separately.
- The copied applied facts stayed unchanged through a distinct merged set and source rename.
  The current cache was not treated as the old snapshot.
- Real editor PNG paste created the asset before note-save/cache. Pasted event data matched
  the editor buffer, and its complete set contained precisely the merged facts plus the new
  asset. A scanner may therefore upload the asset before note cache evidence is available.
- A detached observer missed intermediate writes. A copied JSON baseline survived a reload
  of only the leased window; both that baseline and the latest cache were checked against
  their separate exact sets/offsets. Latest metadata did not reconstruct missed evidence.

The fresh source nonce forces real parsing instead of content-cache reuse. Private `work`
interception injects lag only; it is restored. Private file-cache hashes are diagnostic only,
not accepted as publication authority. No timer/mtime/local-write marker proves success.

## Not proven / required implementation

1. Version/file handles and target ledger IDs are **synthetic**. Applied and merged bytes are
   native vault writes, not real server pull/merge receipts. Full publication requires exact
   server settlement hooks, durable IndexedDB baselines/intents and pre-upload create evidence.
2. The assertions prove this fixture's link/embed cache facts correspond to its bytes. They
   do not independently validate every metadata field, arbitrary Markdown/canvas syntax,
   completeness on every supported app version, or a general runtime stale-cache detector.
3. Resolution uses the **current vault inventory**, not a historical target inventory. Freeze
   known identity/rename evidence; ambiguous, unresolved, replaced or changing targets remain
   holds. A spelling that was unresolved in the baseline must never become a new owner link.
4. Event correspondence proves neither authorship nor an authorization facet. Received and
   merged baselines must not be rescanned as owner-authored additions.
5. The normal paste order requires durable create/intent preflight **before the image scanner
   settles the create**. Waiting for the next note-cache event after upload is too late. Disk
   and editor-buffer advancement, absent generations or lost baseline mean no publication.
6. The restart fixture is a JSON sentinel, not production IDB recovery. OS sleep and native
   iOS suspend/resume were not exercised. Physical iOS remains a separate activation gate.

Keep content on uncertainty and publish nothing. Do not replace missing evidence with latest
cache reads, a server Markdown parser, timers or prompts for every paste.
