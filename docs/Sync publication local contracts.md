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
