# Node debugger

Debug opens a right-sidebar view for a node chat's debugger sessions. The program runs
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
policy. It has exactly Ask and Allow all; without an authoritative live grant
binding the switch is disabled. No model receives the human owner's RPC client.

## Shared controls

F5 continues, F6 pauses, F10 steps over, F11 steps into, Shift+F11 steps out,
and Shift+F5 stops (detaching from externally owned targets rather than terminating
them). Text fields, editable content and modified shortcuts retain
their ordinary keys. Controls require a fresh observation; unknown/mixed execution
is not labelled paused.

An Ask card exposes the expression or value change and expandable exact normalized
arguments. Allow supplies the node's exact proposal hash, principal key and operation
ID. A pending or uncertain receipt is never presented as a completed action.
A human move expires pending cards and retires exact outstanding proposals before
sending a mutation or switching mode. An expired card cannot dispatch an approval.

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
