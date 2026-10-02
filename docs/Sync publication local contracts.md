# Disabled publication local contracts

Tasks 39 and 40 implement only device-local contracts behind `PUBLICATION_ENABLED = false`.
There is no engine, UI, scanner, upload or scoped-server call site. Native cache/version and
transport holds, and reviewed scoped APIs, remain prerequisites for activation.

## Last-settled link store (39)

`LinkSnapshotStore` stores immutable link/embed facts by exact local vault, issuer, server
vault, principal, facet/grant and stable note identity. Each complete baseline names the settled
version, full-content SHA, runtime adapter/generation, raw cache SHA and completeness. An
injected version-checked attestor must accept the immutable candidate; matching callback data
alone is not a production attestor. Invalid evidence stores **unknown**, never an empty base.
Offsets are checked against the exact source. Ambiguous resolution remains unknown.

Pull, restore and merge are received baselines, not local-authorship assertions. Settlement
clears pending local-create novelty. Only a durable pending local-create handle with no prior
snapshot can seed a new-note base. Unknown received evidence cannot be relabelled as a local
create. Known renames are tracked separately without rewriting immutable old versions; bounded
rename overflow makes that evidence incomplete rather than dropping history and asserting new
links. Identity and paths remain distinct.

`snapshotDatabase` supplies IndexedDB instance/header identity checks and a thin host port for
an independent vault-local descriptor/recovery sentinel. Missing descriptor with sentinel,
missing database/header after prior enrollment or changed binding requires recovery. The
existing strict reconnect identity lifecycle is reused. No production host adapter or cache
attestor is installed yet; a failed/missing baseline cannot manufacture publication authority.

The store is pure behind metadata/attestation ports; it does not parse Markdown, infer writer
origin from event timing, scan a vault, or publish anything.

## Publication decision reducer (40)

The pure reducer compares a complete last-settled baseline against an independently attested
current observation and a durable owner-edit/create proof. Both normalized spelling and target
identity/path must be absent from the baseline. Recipient-planted unresolved spellings and
known rename rewrites remain old; received/restore/merge/linter mutations are not owner additions.
An empty new-note base requires a pending local-create identity with no ledger/incoming adoption.

A genuinely pending asset create yields an **intent proposal requiring persistence before
upload**, not a publication call. Existing private eligible files yield one target/audience
confirmation without the account password. Settled/adopted/foreign/unknown creators hold;
code/settings and renamed known code are excluded. Already-shared exact audiences can add an
eligible sponsor without a fresh exposure prompt; additional audiences require confirmation.
Independent sponsor admissions, admission/publication/withdrawal generations and active grants
are mandatory. Withdrawal requires an explicit settings re-share decision and is never undone
by an old approval.

Persistent declined/pending decisions are keyed by exact connection, target identity/version/SHA
and audiences/generations, not unrelated body resaves. Open-dialog freshness additionally binds
note SHA, cache generation/hash, target path, baseline/create handle and sponsor admissions.
Acceptance re-runs the reducer; changed identity/version/audience/cache invalidates confirmation.
Only a revalidated result can be persisted as approved. Scoped callers receive no private target
proposal; missing-reference counts use only a complete local cache/authorized availability set.

Intent persistence, receipt handle resolution, collision/adoption cancellation, CAS/list mutation,
retries, server eligibility/authority checks and native confirmation UI are **not implemented**
by these pure tasks. They belong to subsequent integration stages. The disabled fence remains
unchanged; no setting or live runtime hook can turn these proposals into automatic publication.
