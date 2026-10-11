# Node debugger

Debug is offered only when the node advertises `debugger_v1` support. It opens a
right-sidebar view for that node chat's debugger sessions. The program runs
on the node, not inside Obsidian. The view has one set of controls, with Variables,
Call stack, Breakpoints, Watch and Output underneath. Agent proposals and their
results appear as action cards between chat messages.

## Availability

This UI uses the gated `debugger.v1` infrastructure. The node must advertise and
explicitly enable it. Native JS/TS target launch is still blocked until an audited
adapter is available. Selecting a host-created session is supported; the declared
launch, attach, restart and source-export methods are not treated as available.
Restart remains disabled. An empty session list does not start a process.

The session-mode switch changes a bound live agent grant, never the node's default
policy. Its permissions are exactly Ask and Allow all. Before authoritative live
grant binding, or while disconnected, it displays Unknown and explains why it is
disabled. On opening a session, a typed client's optional `liveGrant(sessionId)`
reader is used if exposed; the current SDK/node have no such read API, so no grant
RPC is guessed. Grants are schema-validated and checked against session, incarnation,
target, conversation and expiry before showing a mode. No model receives the human
owner's RPC client.

## Shared controls

F5 continues, F6 pauses, F10 steps over, F11 steps into, Shift+F11 steps out,
and Shift+F5 stops (detaching from externally owned targets rather than terminating
them). Text fields, editable content and modified shortcuts retain
their ordinary keys. Controls require a fresh observation; unknown/mixed execution
is not labelled paused.

An Ask card exposes the expression or value change and expandable exact normalized
arguments. Allow supplies the node's exact proposal hash, principal key and operation
ID. A pending or uncertain receipt is never presented as a completed action. Deny is
successful only with confirmed no-execution denial evidence; a completed action
remains completed, pending remains awaiting its result, and uncertainty stays Unknown.
Cards update as new receipts/history arrive.

Each control retains its invocation's session, incarnation and execution precondition;
replacement abandons queued work rather than retargeting it. Owner moves use a lane
independent of approval RPCs. Unsubmitted exact asks are retired first and expired
cards cannot approve. Already submitted approvals are not falsely called cancelled.
The current node cannot invalidate an approved-but-not-dispatched action across owner
channels: deny may join its original in-flight operation. Full cross-window retirement
requires a node admission/physical-dispatch fence; the UI does not claim that guarantee.
An already completed retirement race aborts the stale owner intent and requires fresh
observation, rather than presenting execution as successful retirement.

Disconnect retains the last observation and time, fades values, disables mutations
and expires pending asks. Reconnect requires a fresh snapshot; it does not replay
controls. Output is bounded retained observation text, not process recording.
Unavailable earlier output is explicitly reported.

Stack and scopes use typed inspection. Variables and watched expressions are
explicit requests, not automatic getter/formatter evaluation or recursive export.
Human expressions and conservatively effectful variable inspection may themselves
require an exact node approval. Returned values are bounded history observations,
not refreshed automatically after each stop. Unsupported or evicted data remains
unavailable, rather than being evaluated through a fallback.

## Source-tab extension

The debugger does not own another file editor or duplicate its controls.
`mountDebugSource(host, context)` in the plugin's debugger extension module mounts
the shared source viewer and returns `update(text)` and `destroy()`.
The file-tab adapter supplies registration, conversation, debugger session,
incarnation, source ID, path and source text from its verified source/build mapping.
Paths must not be guessed from opaque source IDs. Session/incarnation replacement
invalidates the old mapping and disables the old margin.

`registerDebugSourceRevealer(handler)` connects automatic stop/frame/breakpoint
reveals to the file tab. The handler receives the mapped node source and line,
returns whether it handled the request, and its registration returns a disposer.
Unknown source mappings produce an unavailable-source message, never an arbitrary
filesystem read. Dispose both registrations when the host closes.
