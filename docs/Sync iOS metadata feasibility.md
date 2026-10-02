# Native iOS metadata feasibility gate

Task 02 is **PARTIAL / BLOCKED**. Known-byte cache pairing was observed on native
Obsidian 1.13.7 build 365. This is not production snapshot-adapter attestation and does
not enable automatic publication.

## Observed assertions

A uniquely owned synthetic note used four distinct complete link/embed sets. The native
`metadataCache.changed(file, data, cache)` callback immediately copied exact data and the
full cache. Full UTF-8 SHA-256 was computed from callback data, not a later file read.

| Version | Expected complete tokens | Offset checks |
| --- | --- | --- |
| Baseline | `[[baseline-only]]`, `![[original.png]]` | 2/2 |
| Remote application | `[[applied-only]]`, `[[applied-unresolved]]`, `![[applied.png]]` | 3/3 |
| Immediate local edit | `[[local-only]]`, `[[local-second]]`, `![[local.png]]` | 3/3 |
| Merge | `[[merged-only]]`, `[[local-only]]`, `![[merged.png]]`, `![[applied.png]]` | 4/4 |

All token originals matched their exact source offset slices, with no additional tokens.
Resolved paths and synthetic ledger identities were recorded separately; unresolved
spellings retained null resolution.

An inspected runtime-specific worker hook paused only the exact remote bytes before parsing.
The file advanced to local bytes while remote evidence remained unknown. Releasing the hook
produced the exact remote and local events. Copied older evidence stayed unchanged across
merge and rename; the latest cache was not substituted for it.

A private hash was visible before its parsed cache existed. **Hash presence alone does not
attest correspondence.** The first paused current cache was null, so unknown evidence while a populated stale cache
exists was not demonstrated by that native run. A follow-up began with a populated baseline
cache (`old-only`) and paused the exact remote worker input. During the pause the file had
already advanced to `local-only`, remote callback evidence was absent, but `getFileCache`
contained **no links**, not the stale baseline link. In a second attempt the worker hook was
not entered before the bounded timeout. Thus the specifically populated stale-link cache
race remains **unproven**, not a pass or an inferred capability. The first attempt's remote
and local callback token offsets (0–15, 0–14) matched their own respective event bytes.

## Paste and lifecycle boundary

Synthetic PNG clipboard dispatch reached the real native editor paste handler (an untrusted
DOM event, not a physical clipboard gesture). Order was asset creation, editor change with
new embed, note save, then exact cache event. The asset-create callback did not yet see the
new link; editor-change did. Five post-paste token offsets matched.

This proves an immediate asset-create callback is not itself a pre-upload barrier. No actual
uploader/barrier was activated, and the publication-sensitive preflight remains unknown.

Home/return commands did not establish suspension: the screenshot still showed the app and
visibility stayed visible. The follow-up likewise recorded zero `visibilitychange` and
`pagehide` events while Home/return screenshots still showed the app. A cold-launch request, followed by a successful normal launch,
created a fresh page context and preserved exact saved bytes and backup evidence. Raw full
cache equality did not survive restart: a version field was added and object keys reordered.
Canonical content fields and all current token offsets matched, but raw cache hashes must not
be assumed stable across restart.

## Holds and cleanup

Still required: populated stale-cache case, proven native suspension/resume, production
version-checked adapter attestation and a real paste-before-upload integration barrier.
The installed manifest marker was verified; it was not an independently embedded code marker.
A user-agent OS string is not authoritative device inventory.

Worker hooks, listeners, attachment configuration and workspace were restored; only the owned
synthetic folder and backup key were removed. No enrollment, network switch, upload or
publication occurred. Raw phone evidence and private device/session paths stay outside git.
