# Opt-in agent disposable gate harness

`plugin/scripts/run-agent-stand.mjs` acquires only an exclusively leased pool vault, copies the
current development build, invokes `agentStand.e2e.test.ts`, restores the exact original plugin
bytes and reloads them, then drops the lease. No app-wide operation or real stand/cutover is used.

Prepare a committed server/daemon archive with `vendor-sync.mjs <read-only-repo> <exact-commit>
fixture`. Set `ABELE_AGENT_STAND_STAGE=disposable`, `ABELE_AGENT_STAND_FIXTURE=<archive-source>`
and `ABELE_AGENT_STAND_COMMIT=<full-commit>`. Missing stage skips the test and the script takes
no resource. An invalid present stage, wrong archive/checksum or non-owned pool lease fails.
The current harness was exercised on exact `689779f7aa5315954d3a313fc5b17ce1d2178ebe`.

The backend is an **explicit disposable test assembly**, not production activation. It first
checks the unchanged committed buildApp still advertises disabled scoped capabilities and
rejects management with 503. It then copies the exact committed HTTP assembly into its owned
temp folder, omitting only the early activation hook and supplying the synthetic negotiated
contract required by the actual daemon. Imports still target the checksum-verified archive;
no server-worktree or archive file is changed. Contract advertisement alone is not credited as
extras/native implementation. Folder preparation invokes the actual owner-authorized service
through an owned loopback-only fixture operator route, because the dormant server has no active
preparation worker. This distinction stays explicit in acceptance reports.

Working portion uses the real desktop owner plugin, actual owner-password grant/key HTTP
handlers and the same archive's `abele-sync agent setup/run --once`. It verifies exact
`<agent-root>/Agents/` paths, create/push/pull, in-prefix move, displayed exact-version history,
confirmed delete, restore, scoped secret/descriptor permissions, exclusion of unrelated local
files/scripts, revocation refusal and retained local bytes/ledger. No personal/account token is
given to the daemon. Original owner state is isolated/restored through the protected fixture
context, with cleanup armed before preparation writes a hold.

The full opt-in gate intentionally **fails** the mandatory owner-extras/paste and native
root-image/private-collision steps with `PENDING` diagnostics. A focused `-t 'folder lifecycle'`
run provides working-subset evidence only. When reviewed APIs/owner hooks/cache barriers land,
replace those pending bodies with the actual scenario assertions—not a skip or success flag.
Current native subset passed; the whole opt-in run had exactly the two expected pending failures.
The broader scenario-A concurrency/history/revoke-race and operational cutover inventory remain
separate required checks; this harness does not claim their complete sign-off.
