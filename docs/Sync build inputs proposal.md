# Reproducible sync inputs: baseline and proposal

Task 03 is **blocked pending review of the packaging mechanism**. No vendor import,
dependency installation, sibling build or release is performed by this change. The build
still has the defects below; the expected-failure tests must become ordinary passing tests
when the proposal is implemented. A recorded source revision is not a provenance claim
for an existing `dist` directory.

## Inspected baseline

| Input | Commit / source tree |
| --- | --- |
| Plugin baseline, `orca/sync-engine` | `9a477a2f` |
| Sync main, hardening baseline | `68bb5bb893a98d2ec89b86cdc511805be6f7d229` |
| `packages/core/src` at that commit | `ea08ce097d33a6ef18cab3f13fac91f05b70e3b9` |
| `packages/protocol/src` at that commit | `d20af208c9918815833b4a6375b4eb235849b54e` |
| Parked phase-4 branch | `9e71789af818212cca3f206b3e907e67b7af09d9` |
| New phase-4 branch observed during inventory | `ee3925c3bb25cfef3ad99bcd7909a4aac4fac4ad` |

The installed `sync-core` and `sync-protocol` packages are **symlinks** to an external
checkout. Their exports resolve `dist/index.js` and `dist/index.d.ts`. Production's
`prebuild` and the fast tier's `pretest` run `presync`, which builds that mutable external
checkout. `build:test` has no equivalent preflight. The dependency lock records local file
references, not an immutable package payload. Thus a clean plugin checkout is neither
self-contained nor reproducible, and tests can exercise protocol sources different from
the core bundled by Vite.

`tests/unit/syncBuildInputs.test.ts` was observed red for both causes. The guarantees remain
as `it.fails` with `BUG:` comments, not removed/loosened expectations. The proposed artifact
path is intentionally specified so the decision is reviewable.

## Proposed bounded mechanism

1. Export **committed** source with `git archive <exact-commit>` into a disposable directory
   in the plugin checkout. Verify the commit and source-tree IDs above. Never copy live
   `dist` or use the sibling's `tsbuildinfo`. Build only core/protocol from that archive with
   locked dependencies and a clean TypeScript build.
2. Produce two npm tarballs under `plugin/vendor/sync/`. Use distinct package build versions
   derived from the revision and make core depend on that exact protocol version. Record a
   manifest containing upstream commit, package tree IDs, lockfile hash, toolchain versions
   and each tarball's SHA-256/SHA-512. The vendor content is an intentional third-party input,
   with explicit narrow repository-guard exceptions, not a generic permission to commit
   archives/build output.
3. Replace only the **existing** two dependencies with `file:vendor/sync/<pinned-name>.tgz`
   and regenerate the lock. No new product dependency is proposed. `npm ci --ignore-scripts`
   must install actual directories, not links to a checkout. Remove sibling-mutating
   lifecycle hooks. A preflight verifies tarball checksums and installed package provenance
   before types, tests and both builds. Updating inputs is a separate reviewed artifact diff.
4. Remove the fast-tier protocol alias that currently points at mutable external source.
   Give the server integration harness an **explicit** `ABELE_SYNC_DIR` and verify its clean
   revision against the recorded baseline. Server-backed tests fail clearly if that input
   is unavailable; they do not silently use another branch or skip a security gate. Pure
   plugin tests and production builds must not need a server checkout at all.
5. Verify in an isolated clean plugin copy with no sibling present: install from lock,
   types, lint, full fast tests with the explicit server fixture, development and production
   builds, and reproducible package/checksum comparisons. Tampered/missing tarballs, a linked
   installed package, wrong fixture revision, and implicit sibling resolution must fail.

This is a packaging proposal, **not yet the chosen implementation**. The manager/architect
should approve it before a vendor drop; source vendoring is an alternative but imports a
larger upstream source surface and complicates update ownership. A revision-only environment
variable or checking the final bundle does not close the mutable-dist hole.

## Parked-module map

At the preserved phase-4 commit, retain but do not activate:

- `packages/scope/src/{noteLinks,markdownTokens,attachments,referenceIndex}.ts`: server body
  reference/attachment parsing; no v4 authorization dependency.
- `packages/protocol/src/{observations,dispositions}.ts`: obsolete proof/disposition contracts.
- `packages/server/src/db/migrations/010_scoped_transactions.ts`: old transaction-service
  schema; never splice it into hardening's migration ancestry.
- `packages/server/src/scope/{commitIndex,readiness}.ts`: replace the synchronous/global path.

`packages/scope/src/linkBindings.ts` is keep/adapt, not parked: preserve identity and add
first-introducer evidence. The proposed main-core/protocol artifacts do not import scope or
server code, but that needs an export/import-graph check when producing the artifacts.

## Recovery evidence

Local complete-history Git bundles of plugin and sync repositories were created and
`git bundle verify` passed for both. They are session scratch evidence, not public files or
an off-machine disaster-recovery claim. Their locations/checksums are in the developer's
report. Never commit the bundles or `.scratch/`. The parked branch remains unchanged.
