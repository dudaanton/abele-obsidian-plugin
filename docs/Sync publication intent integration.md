# Disabled publication intent and push integration

Core/protocol are pinned to the exact reviewed `fc1e82dc36050ddc1b12f3005ff32899cca24c73`
archive. Source exports and checksums, not a live sibling `dist`, supply the build. Runtime
publication remains disabled; neither integration class is installed into an active engine.

## Owner intent journal

`PublicationIntents` is a portable host-owned writer contract using the protected snapshot
metadata adapter. Explicit first allocation initializes its ledger; a missing record on reopen
is recovery, not an empty candidate set. The aggregate is checksum-verified and capped at
128 request units, 16 observations per unit and 1 MiB. Budget exhaustion holds work; it does
not evict a pending intent or reconstruct one from a current note.

Preparation is awaited **before** any relevant upload/commit. It captures the immutable normal
commit request ID/body, pending target/sponsor handles, exact baseline/current cache and
individual introduction evidence, proposal and grant/admission/publication/withdrawal
versions. It invokes the existing reducer and durable approval store rather than trusting an
input's claimed approval. Native cache/create-origin attestation and exclusive writer ownership
are mandatory ports. Unknown paste ordering/cache is sealed as a hold for that unit and cannot
be upgraded after upload/settlement by a later scan.

Settlement requires a verified receipt for the same request/body and exact operation indexes.
Pending target and sponsor handles resolve only from genuinely novel create outcomes. Adopted,
merged, conflicting, restored, rejected or ordinary `applied` creates do not prove novelty.
Changed sponsor bytes hold; a merged body is never rescanned into owner additions. Existing
private targets require the exact persisted, revalidated exposure approval.

Resolved per-audience CAS deltas and stable intent IDs are persisted before sending. Recovery
first looks up the **exact authorized stored delta receipt**, so a lost successful response does
not become a new mutation after a revision advance or later Unshare. Without that receipt,
current target/sponsor versions, admission and withdrawal generations must still match.
A real CAS conflict/authority change is a durable hold, never whole-list replacement. Success
is persisted per audience and then as the intent's historical completion, not a claim that the
asset is still currently shared.

These are port-tested owner contracts, not a live publication HTTP adapter. The reviewed wire
receipt's ordinary `applied` status is deliberately not upgraded to the contract's stronger
`created` proof.

## Actual reviewed scoped push hooks

`ScopedPushIntegration` calls the pinned `pushScoped` implementation. It checks exact
issuer/vault/grant/principal and snapshot-store binding plus the host writer claim. The real
core's `beforeUpload` persists request/body/immutable-outbox fingerprints before any upload.
A staged replay with lost integration evidence is refused before commit. No new request ID or
fresh cache candidate is manufactured.

The core's exact-version `onSettled` bytes are copied before adapter awaits and validated for
SHA/length. A note cache adapter must attest those bytes and that actual file/version, not the
latest edited path cache. Missing evidence stores an unknown baseline. Any supplied scoped
link lineage is conservatively received; it cannot confer personal owner publication authority.
Repeated hooks after completed placement remain idempotent. Core journal retirement follows
successful known/native metadata and hooks; completed integration-unit metadata is cleaned
only after retirement, so historic units do not grow without bound.

Disposable SQLite integration exercises death before upload, death after real file placement,
replay of the same actual commit receipt without another version, exact settled snapshots and
missing-unit recovery. Production HTTP activation remains closed.

## Remaining activation contracts

The scoped push hooks are implemented and tested, but the personal pusher at this reviewed
revision still has no matching durable pre-upload/exact-version settlement hooks. The plugin
cannot attach scoped authority to the owner reducer: those facets are deliberately disjoint.
A production personal adapter must supply the owner journal before scanning loses pending-create
facts, independently attested image-created-before-note-save barriers, exact novel/adopted
receipt distinctions, exact post-settlement snapshots, and the forthcoming sponsored HTTP/CAS
receipt endpoints. No body parser, timer, latest cache, personal-token fallback or fabricated
endpoint is used to fill those gaps.

Task 41 therefore has disabled intent/recovery contracts and real scoped hook integration;
full active owner publication and the native/agent end-to-end gate are not passed.
