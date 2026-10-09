# Sync rebuild evidence and local state

The rebuild uses one token principal for root, folder and group connections. The registry
metadata follows the frozen v2 contract: address, a device-only key reference, stable folder
or group selector, space/token IDs, independent ledger ID, pause and availability. A selector
path is a display hint; renaming it does not change its ledger or credential.

## Live evidence runner

`plugin/tests/e2e/syncScenarios.e2e.test.ts` runs in the existing desktop/physical-phone tier.
The normal phone tier uses its existing `ABELE_PHONE_DRIVER`; this runner installs no device
driver and carries no deployment address. Run only against disposable, explicitly selected
fixture vaults. The live runner is opt-in through `ABELE_SCENARIO_EVIDENCE`.

The shared scenario provider supplied by the acceptance harness exports
`liveScenarios(host): Promise<ScenarioDriver[]>`. Each driver has its scenario number and a
`run()` returning named expected/actual behavioral checks and paths to existing evidence
artifacts. The host supplies real vault editing, reading, moving, deleting, opening, renderer
reload, asynchronous evaluation and physical-device driver calls. Backgrounding, camera input,
network switching and application relaunch use the physical driver; renderer reload alone
does not prove those actions. Never include credentials in checks or artifacts intended for
publication. Keep personal-vault evidence and deployment-specific provider modules untracked.

Example invocation from `plugin` (the paths are synthetic):

```sh
ABELE_SCENARIO_ACTIONS=/path/to/shared-live-scenarios.mjs \
ABELE_SCENARIO_EVIDENCE=/path/to/local-evidence \
ABELE_SCENARIOS=2,7,11 \
./node_modules/.bin/vitest run --config vitest.e2e.config.ts \
  tests/e2e/syncScenarios.e2e.test.ts --maxWorkers=2
```

The manager's phone batch selects the same file with `E2E_TARGET=phone` and IDs 117–124.
Each scenario is a separate test with its own timeout and writes a numbered platform JSON
record immediately. Mac evidence is required for 2–23, 35–56, 76–90, 92–107 and 111–116;
physical iPhone evidence is required for 117–124. The shared manifest covers all 001–124.
The server harness records its own `server` rows through `runEvidence`; server passes and
simulations cannot verify Mac/iPhone. Missing actions/hardware remain `unverified`; empty
assertions, mismatched observations and missing live artifacts fail. Cases 108–110 are specified acceptance: ordinary merge, edit wins over deletion, and original modification times (the latest original edit time for a merge). A missing scenario provider produces
unverified records and a failing live batch; the runner does not invent evidence.

This stage supplies the runner and host transport. The replacement feature actions and
their assertions come from the shared acceptance harness as those rebuild stages land.
No live Mac/iPhone or paired-server evidence is claimed by the unit tests.

## Fresh token state

Startup waits for the previous runtime to stop, initializes only the token registry and
discards old personal/scoped connection records, journals, ledger references and credentials.
No legacy state, checkpoint or approval is converted or imported. A verified temporary cleanup
list stores only retired credential references until deletion succeeds, so interruption cannot
lose the keys still to remove. The cleanup is restricted to known legacy namespaces; new token
credentials, unrelated provider keys, actual vault files and IndexedDB databases are untouched.
The old local registry schema and migration tests are removed.

Token provisioning persists a prepared binding, verifies the device-only keychain write, then
activates metadata. Re-pasting the same new token resumes interrupted provisioning. A bound record cannot be retargeted: a different token needs a separate local record, preserving existing pending state. Endpoints
and local IDs, rather than remote space IDs alone, separate credentials and ledgers. Generic
engine state lives under the connection-local `abele-sync-token-state:` namespace. Retired
access slots cannot be read or written through the new context. Forget removes only the
selected metadata; runtime credential/database teardown remains a separate action.

The old personal/scoped bootstrap and multi-runtime adapter wiring are removed. Until the
v2 engine adapter and token UI land in later stages, this intermediate build does not start
normal sync. It is not a deployable finished replacement. The independent engine collection
and path coordinator remain available for the replacement adapter.

## Review findings and replacement requirements

- Current script invalidation now resolves the selected/bound token identity instead of stale
  singleton storage. Retired remote provenance cannot authorize token execution; the later
  script-review stage supplies new immutable provenance/approval candidates. The old scoped execution
  prohibition is part of the deleted scoped model; it is not extended into the RW token model.
- Publication-descriptor discovery and legacy registry migration are deleted. Their synchronous
  fallback finding does not apply to the fresh token registry; no inventory or migration is
  performed.
- Retained pull/push placement downloads happen before path leases. Push settlement stages
  bounded download runs on disk before its state transaction; placement and state updates
  remain coordinated. The pinned input archives are unchanged and the bundle transform
  fails closed if their placement boundaries change.
- **Replacement requirement: uncertain settlement.** A successful commit followed by a
  failed version/blob fetch must retain its request identity, immutable bytes and receipt
  evidence. Only a proven pre-commit refusal may become an item hold. Test a lost response,
  successful replay followed by download failure, restart, and receiving unrelated items.
  The replacement removes the old scoped continuity classifier; this stage does not patch it.
- **Replacement requirement: held-item fairness.** Filter held items before the work budget,
  or continue scanning past them. Test at least 32 held early entries plus one later eligible
  entry, across cycles and restart; receiving must continue. The replacement removes the old scoped scanner; this stage does not patch it.

Executable operation review, attachment consent, conflict identity across servers, departure
versus deletion and token engine initialization still require their later-stage acceptance evidence.
