# Changelog

**Open changelog** and **Settings → Other → Changelog** open the same tab. All versions
are available, newest first, in pages of ten. A later update can offer a finite, dismissible
Notice opening all releases in `(previous version, running version]`. Nothing opens or takes
focus until the person presses **What's new**.

## Offline data and release builds

Vite generates `virtual:abele-changelog` from full Git history and bundles it into `main.js`.
No runtime request, token, Git installation or fourth release asset is needed, including on
mobile. Direct Vite builds (the size check), development builds and production builds share
this generator. `release.sh` needs no generated file staged before it tags a release.

The manifest and package versions must agree. Only stable numeric version tags reachable
from the build revision, no newer than its manifest version, enter the catalog. A matching
version-bump commit at HEAD can supply a pending boundary; attaching its tag produces the
same data. Post-tag development commits are not relabelled as the tagged release. Dates
come from commit timestamps converted to UTC, never from the build clock or GitHub's
publication time. Missing history/tags, shallow clones and non-linear boundaries fail with
instructions rather than quietly shipping incomplete data. Git-less source archives are
not supported.

`plugin/scripts/changelog-history.mjs` maps four exceptional historical boundaries: two
old tags off the current lineage and two versions recovered from version history. Recovered
dates are labelled in the view and do not claim a verified GitHub publication. No old tags
are changed by the generator.

## Historical copy

`feat`, `fix` and `perf` subjects become New features, Fixes and Improvements. Scope and type
prefixes are removed; maintenance, tests, docs, refactors and version bumps are omitted.
Exact duplicate bullets collapse within their release/category. Unrecognized subjects are
omitted and counted at build time. `node scripts/review-changelog.mjs` from `plugin/` prints
the full catalog and uncategorized subjects for review.

The reviewed full-commit-ID overrides in `changelog-copy.mjs` omit internal-only changes and
replace implementation jargon with readable behavior. Overrides and Git code never enter
the runtime bundle. New release copy still needs review: prefix filtering alone cannot tell
whether a change is user-facing. All UI bullets are inert plain text, not Markdown, links or
HTML.

## Local version tracking

The portable controller depends on a `VersionStore`, not Obsidian. The adapter stores
`{ schema: 1, lastRunVersion }` under `abele-changelog-version` in Obsidian's per-vault,
per-device local storage, not in `data.json` or settings transfer. A fresh/invalid marker
is baselined silently. An upgrade saves the new marker before offering news, so dismissal,
timeout and same-version reloads do not nag. Downgrades record the actual version silently;
a later re-upgrade may offer the range again. Failed reads/writes suppress automatic offers
without removing manual access. Layout callbacks and a live Notice are cancelled on unload.

**Migration limitation:** versions before this feature kept no such marker. The first release
with it cannot recover the previously installed version and establishes a quiet baseline.
Accurate automatic comparisons start with the following update. Synced settings are not
evidence of this device's previous version.

## Size

The initial catalog contains 122 historical version boundaries and 774 user-facing bullets;
its compact UTF-8 JSON is 90,518 bytes. No runtime dependency was added. The production
build changed from 5,580,432 to 5,677,572 JavaScript bytes (+97,140) and from 297,955 to
298,667 stylesheet bytes (+712), including the view, adapter and documentation. The budget
increase is separate from the feature; paging limits DOM work, not shipped history.

## Verification

Synthetic Git fixtures test pending/tagged equivalence, detached older builds with newer tags
present, off-line mappings, recovered boundaries, aliases, missing/shallow history, UTC dates
and clean-clone/cwd/timezone determinism. Git child environments strip every inherited
`GIT_*` variable and specify their repository explicitly. A decoy-repository test proves that
hook context cannot redirect fixture writes or generator reads.

Fast tests use a fixed virtual-module alias; the separate catalog invariant checks historical
boundaries at committed `HEAD`, reading both version metadata and history from that revision,
without copying real subjects into fixtures. This keeps the invariant meaningful during a
pre-commit hook with a higher version staged. Default production generation still checks the
working-tree version and rejects an uncommitted release bump. Component and adapter tests cover
paging, range restoration, plain text, entry points, storage and Notice lifecycle. Focused
live tests cover the view, settings action and update controls; the phone layout and focus-ring
probes include them. A Notice is not registered as a modal or required to fill a sheet.

A release check must use a complete clean clone, including tags, then `npm ci` and
`npm run build` from `plugin/`. No untracked input is needed.
`node scripts/check-changelog-build.mjs` explicitly enables the executable pre-commit hook
inside a disposable full clone (independent of npm lifecycle-script configuration), then
exercises `release.sh`. It asserts that the hook ran, the bump commit and tag succeeded and
the catalog includes the new version. It builds that synthetic tag in two clean clones
under different timezones and compares both release-file hashes. It never tags or commits in the source checkout. The wider e2e batch and final
release clean-clone gate remain separate from focused feature verification.
