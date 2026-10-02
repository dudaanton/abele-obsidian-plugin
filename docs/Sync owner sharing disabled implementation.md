# Disabled owner sharing implementation

The pinned core/protocol revision is `eb4844854b0a240c074fdae509ebce083ae03727`.
Archives were produced from that exact committed source in an isolated build, with per-file,
archive, lock and tree checksums. No live sibling build/hook is used or modified. The scoped
pull API is available; server capabilities, owner management and publication remain fenced.

## Task 37 — folder wizard

The owner UI reviews one canonical folder prefix and unchanged file paths, role and eligibility.
A complete generation-bound preview is refreshed after password authentication; any change
invalidates confirmation. Only a fresh vault-owner account session can create the grant/key.
The issued credential must be `absk_`, scoped, on the exact grant and role—not a personal device
credential. The password is never retained after confirmation; the secret exists only while
its review is open. Lost key issuance retries reuse the same attempt/grant rather than creating
a new whole exposure. UI components use Obsidian modal/control/theme primitives.

The management/preview HTTP adapter is a port, not an enabled live backend. Default activation
is false with no setting/environment override. No password, grant or machine credential is
requested by the production settings pane while fenced.

## Task 38 — extras/native service

Owner publication needs the current personal owner device, same-device decision, exact target
identity/version/SHA, independently in-scope intrinsic note sponsors and CAS/withdrawal generation.
Only a delta is sent; stale revisions/withdrawals hold rather than replacing another list or
resurrecting an old approval. Complete explicit sponsor departure can remove that sponsorship
and withdraw on the last sponsor; partial inventory cannot. Body link removal alone is not a
revocation signal.

Grant-native create is separate: scoped editor/current grant ceiling, fresh local handle,
intrinsic authorized sponsor and this principal's upload entitlement. It may retain the exact
root attachment path outside the prefix, but may not adopt hidden occupancy/private SHA.
Collision errors are generic and preserve local work. Local configured/state/code exclusions
apply in addition to mandatory server eligibility and authority checks. No body parser or
owner publication authority is introduced on recipients.

These are client port contracts; actual sponsored/native routes and authority fences must be
reviewed and supplied before wiring. The server stream at the pin does not claim completed
sponsored publication. No live endpoint, upload or activation is fabricated.

## Task 42 — publication settings

Settings separates owner extras from grant-native assets, shows paths/identities/sponsors and
content/scope/cache/confirmation holds. Incomplete cache evidence produces unknown reference
status, not an exact missing count. Complete no-longer-referenced evidence is informative and
never auto-withdraws. Unshare reviews exact target/version and CAS/withdrawal generations and
revalidates immediately before the delta; stale confirmation cannot re-add authority. It explains
independent intrinsic folder/group access, rename identity and replacement without inherited
approval. Scoped contexts do not render private owner rows. All mutation controls remain fenced.

## Task 41 waits for reviewed core push

The current pin exposes scoped snapshot/feed pull, not an integrated scoped push producer.
Before task 41 can wire publication it needs:

- a durable before-upload/pre-push hook able to HOLD only publication-sensitive work before
  ordinary scanning erases pending-create novelty; unrelated personal sync remains available;
- stable local create-operation handles and principal/connection binding, plus exact receipts
  resolving target/sponsor identities and versions and distinguishing new, collided/adopted,
  merged, restored and rejected results;
- a post-settlement hook for exact full-byte SHA/version baselines, including merged/restored
  content, without interpreting that result as owner-authored link additions;
- recoverable journal/intents and stable idempotent request identities across lost responses;
- current writer/authority/withdrawal fences and preserved local dirty/departed work;
- reviewed scoped/native upload and CAS list contracts, including sponsor admission generations.

The native cache attestor must preserve per-link introduction/rewrite lineage and provide the
actual paste pre-upload barrier. Pull-only data, a note-wide edit flag or a timer cannot replace
these hooks. Nothing here enables task 41 or automatic publication.
