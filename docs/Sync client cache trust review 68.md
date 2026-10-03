# Client, cache and trust review — task 68

## Review scope and acceptance boundary

Astra's independent review compared the supplied client diff, surrounding implementation,
existing tests and saved native probe evidence; it **did not run tests or change code**.
Findings about `nativeOwnerPublication.ts` referred to the current tree outside the supplied
diff. All six code findings were reproduced and accepted as real. None was dismissed.

The review also examined these surfaces without identifying a new violation:

- Desktop metadata probes: distinct full token sets, exact offsets and immutable callback copies.
- Desktop Electron session transport: pre-follow redirect refusal, ambient credential/cache
  suppression, native TLS controls, proxy/PAC and credential switching.
- Verified iOS transport subset: redirect refusal without sink requests, uncached `200/403/200`,
  binary round-trip and exact JSON bytes; no unsafe production `requestUrl` fallback.
- Publication reducer: prior spelling/target and individual introduction evidence;
  received/merge/rename/unknown baselines do not grant publication authority.
- Personal ledger and snapshot state loss: independent evidence of prior allocation;
  missing retained databases do not become ordinary fresh setup.
- Script execution: full current bytes, identity/SHA/device binding and final generation/context
  checks; scoped/pending descriptors independently refuse execution. No concrete bypass found.
- Plugin-code consent: exact admitted versions, filtering at apply, and readonly handler guards.
- Q2: reactions by already trusted automations to shared-note events remain the explicitly
  approved policy, not an execution trust bypass.
- Current intrinsic sponsor proof exists; the historical missing-read document was not treated
  as evidence of a current server blocker.

This is not a new blanket architecture sign-off by the implementation worker. Production
sharing flags remain false. The desktop disposable acceptance below does not substitute for
physical iOS/Android/Boox/iPad or production-host installation.

## Findings and fixes

### 1 — high: a local save became replacement authority

Cause: `ObsidianFileSystem.writeAtomic()` awaited restrictive metadata and then adopted freshly
read local bytes as the final replacement fence's base. A save during that await could disappear.
A save between the engine's decision and filesystem entry had the same problem.

Fix (`24ce1c52`): retain a digest of the last engine-visible read or absence observation, never
promote bytes merely because a later stat sees them; compare at replacement entry, capture the
preimage before the awaited hold, and pass that unchanged preimage to the existing final native
queue/swap fence. Authorized source observations follow successful moves. Binary payloads are
not retained in a vault-sized memory cache.

Evidence: five regressions cover hold-time save, pre-entry save on desktop/mobile models, and
absent-to-existing recreation. Existing adapter/write recovery assertions remain intact (87
focused tests). `1e9ec509` adds real desktop saves before entry and during the hold; both refuse
overwrite and preserve exact local text. The original queued/native-boundary test also passes.
No physical iOS overwrite-race run is claimed; mobile swap-model coverage is explicit.

### 2 — high: a partial hold skipped durable ready-image intents

Cause: returning `holdIndices` early left ready images unjournaled. The reviewed core submits
its filtered sending subset without another pre-upload hook call, so later settlement lacked
an exact unit receipt and recovery could not recreate the pre-upload decision.

Fix (`d27d69d7`): prepare the exact sending subset before returning any hold. Operation indices
are renumbered for the wire body while stable original create handles are preserved. Persist
both the subset/body metadata and actual `PublicationIntents` before upload permission returns.
Held operations remain under the core's separate immutable held request.

Evidence: a ready image, a held image and an ordinary note in one unit return only the held
image index, after the actual protected intent journal and exact two-operation sending body
exist. The remapped create handles are asserted. Original intent/replay tests pass. This is a
synthetic mixed-batch controller regression, not a claimed two-image physical fleet run.

### 3 — medium: a pulled note lacked the next paste's baseline

Cause: only owner push settlement populated snapshots; the reviewed `onPersonalNoteApplied`
hook was not installed into the host's engine options.

Fix (`cf4d26b3`): carry the reviewed personal delivery hook through the disabled host boundary.
Validate delivery identity/version/SHA/size against exact bytes and the current personal ledger;
settle a `pull` baseline only from the matching immutable native cache callback. Missing cache
remains unknown. Arrival never becomes owner-introduction or script execution consent.

Evidence: received-baseline and wrong-version regressions pass. Gate 43 additionally uses the
real scoped daemon to edit a Cyrillic note, pulls it into the native owner, then immediately
performs a trusted clipboard paste. Automatic owner-extra publication and exact daemon bytes
pass. A previous-version baseline or absent hook cannot satisfy that scenario.

### 4 — medium: Books ownership changed during the final inventory await

Cause: the last awaited `localPaths()` had only an instance-generation check afterward, not a
cold personal/scoped ownership check. Separate setup instances could overwrite the first claim.

Fix (`5c8f3e74`): after that final await, recheck personal connection and both scoped ownership
slots with no intervening await before the synchronous descriptor claim.

Evidence: a personal connection appearing in the last await allocates no secret/ledger. Two
independently awaited setup instances share one storage: the first descriptor remains unchanged
and the second performs no ledger allocation/pull. Eleven setup and five component tests pass.
This does not claim native Android transport or a production cross-process placement adapter.

### 5 — medium: several relation approvals reused the first ACL revision

Cause: every approval sent the original grant revision; the real approval transaction advances
ACL revision exactly once on success. There was also no acknowledged per-relation progress.

Fix (`6e440983`): the real HTTP port validates the strict `approval_id` response and returns a
request-bound acknowledgement of the reviewed transaction's N-to-N+1 transition. The controller
validates that acknowledgement, advances its grant revision and remembers confirmed relations;
concurrent confirmation/approval is refused. Closed/superseded generations cannot update a new
review. Retry starts at the unacknowledged relation, not the first already confirmed relation.

Evidence: two relations use revisions 0 then 1. A definite pre-send failure on the second retries
revision 1 without repeating the first. Real archived HTTP services approve two separate notes
and the stored ACL becomes 2. Original one-relation/root/stale-preview assertions remain.
An ambiguous/lost approval reply remains a restrictive recovery/conflict hold: the pinned API
has no idempotent approval receipt read, and no new revision is guessed after an uncertain reply.

### 6 — medium: a vanished initial batch minted a replacement publication

Cause: missing journal always meant first send, even after persistence or successful resume.
New operation IDs could replace a previously applied request after a lost response.

Fix (`41e034ab`): remember reviews that require retained evidence, including uncertain initial
persistence attempts and successful resumes. Missing retained rows stop with recovery instead
of creating new IDs. Writes cannot silently recreate vanished retained rows, and an exact durable
journal is checked again after asynchronous preflight before each add effect.

Evidence: loss after an applied/lost reply, loss after resume, and loss during resumed lookup all
hold without another add. Original stable-body lost-response and multi-target CAS tests remain.

## Verified implementation result

- Full suite with explicit immutable reviewed fixtures: **419 files / 4,931 tests passed**.
- Types passed; lint has **0 errors / 311 pre-existing warnings**; development/production builds pass.
- Exact archive and installed core/protocol payload verification passes for
  `3b82b27ef378b33a7edf1bced02332612960c4b2`.
- Production rendered-module graph guard passes; fixture/testing markers in the artifact: **0**.
- Native disposable desktop/real-daemon gate: **3/3**, including Cyrillic root attachment folder,
  Cyrillic note/asset names, sponsor out/re-entry with admission generation greater than one,
  received-note-then-paste, owner-extra bytes, scoped native-create replay and private collision.
- With native replacement supplements included: **2 native files / 5 tests passed**.
- Staged privacy, repository and whitespace guards pass for each implementation commit.

## Native evidence still held

The independent review correctly distinguishes these from code exploits:

- iOS populated-stale-cache, real suspend/resume, and production pre-upload paste barrier are
  still unproven. Earlier synthetic untrusted paste evidence cannot prove the trusted path.
- Trusted HTTPS-to-HTTP downgrade refusal and genuinely different-hostname native handling
  remain unverified; different loopback ports are not substitutes.

These holds remain documented and activation fences stay closed. No additional native device,
whole-fleet acceptance, release, tag, push or server-stream change is claimed.
