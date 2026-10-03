# Owner publication — exact admitted request binding

## Follow-up review 68.2

The pre-upload owner hook is earlier than blob admission. It can persist a sending candidate
`[ready-image, ordinary-file]` after holding another image, but the reviewed core later excludes
uploads refused with `too_large`, `quota_exceeded` or `quota_waiting`. The actual durable submitted
journal and commit can therefore contain only `[ready-image]`. Comparing its successful receipt
against the earlier candidate made settlement/replay fail forever.

The original partial-hold regression did not exercise this second reduction. This component
fix changes the plugin receipt consumer only; it does not edit core, vendor inputs or the pin.
Production activation remains disabled.

## Two durable boundaries

1. Before any upload, keep the original prepared operations, captured inputs, decisions and
   stable create handles. The existing pre-upload intent barrier remains intact.
2. Immediately before `commitRaw` transport, require the core's **already durable submitted**
   journal: same request ID, exact operations, submitted phase and owner issuer/vault binding.
   Bind those exact operations and stable original handles into both owner-unit metadata and
   the publication intent ledger before allowing the request to leave the client.

Only an exact ordered subset of prepared operations is permitted. An operation's path, SHA,
base/version, size, timestamp or other request field cannot change; operations cannot be added
or reordered, and create handles cannot be reminted. The immutable original plan is retained as
checksum-bound evidence. Omitted target/sponsor operations keep their intents held, not published.
An independent verified prior sponsor settlement remains distinct from an omitted sponsor op.

Once bound, the admitted body/handles are immutable, including across reopen and lost-reply
replay. A further subset is also a different request and is refused. Failure to persist either
binding blocks transport; recovery resumes the exact existing submitted core journal. A legacy
prepared-only row may be bound from that durable journal before replay, preserving the original
intent IDs, never rebuilding authority from current content or accepting a mismatching receipt.

Receipt equality, cardinality, novelty and independently verified wire identity remain strict.
The transition happens **before transport**, not by tolerating a smaller response after success.
Missing prepared native evidence for a publication-sensitive request is recovery before send.

## Evidence and limits

Synthetic fixtures execute the actual installed core scanner/pusher/partial-hold/admission and
resume code with a controlled blob/receipt transport. For each refusal code they prove:

- candidate A + held B + ordinary C is prepared before upload;
- C is refused after preparation, and only A is committed;
- both durable plugin consumers already contain exact A at transport entry;
- normal settlement finishes without an extra version or mismatching receipt;
- successful response loss followed by a new owner adapter and `resumeJournal` uses the same
  body/key, performs no new upload and publishes once.

Additional regressions cover old prepared-only evidence, a failed final-binding write, rejection
of altered replay, changed/added/reordered operations or reminted handles, and refusal to accept
an old full-candidate receipt against the admitted unit. An omitted sponsor holds publication.
This is offline component evidence, not a native paste, clipboard, device or whole-fleet pass.

The separate retained-placement 67.4 and source-byte authorization 68.1 seams remain owned by
the core writer. The manager must review/integrate that component and authorize the later exact
repin before native gate 43 and collaboration/Books gates resume. No new core contract is needed
for this slice: the current submitted journal already exposes the exact body and original
operation-index map before `VaultClient.commitRaw` is invoked.

If all operations are refused, no commit occurs and no publication is authorized; broader cleanup
of prepared-only units/held create lifecycle remains separate from binding a committed subset.
