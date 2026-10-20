# Node debugger

Debug is offered only when the node advertises `debugger_v1` support. It opens a
right-sidebar view for that node chat's debugger sessions. The program runs
on the node, not inside Obsidian. The view has one set of controls, with Variables,
Call stack, Breakpoints, Watch and Output underneath. Agent proposals and their
results appear as action cards between chat messages.

## Agent access

Approving a provider's tool prompt does not grant debugger access. When an agent needs
a debugger grant, its chat shows a request naming the folder, program and requested access.
Allow grants access to that run and target; Deny refuses it. The agent then explicitly retries
the rejected call. Allow does not replay it or approve an expression: expressions and value
changes still use the separate exact-operation approval.

In Settings → Nodes, open the node's menu → Agent debugger access to see retained grants
you issued on this device. Revoke stops access; Delete revokes and removes the grant from
the list while retaining operation history. Other owners' grants are hidden, and the node
enforces issuer-only management. Grants also end when their run ends or their deadline passes.
A node without `debugger.access.v1` support shows an update message instead of these controls.

## Availability

This UI uses the gated `debugger.v1` infrastructure. The node must advertise and
explicitly enable it. *Run a program* in the node chat's menu searches the folder's JavaScript
and TypeScript entry files, with package scripts and built entries before searchable source aliases,
and starts the selected file on the node under the debugger.
The node runs it with its own Node, an empty environment and no shell. On supporting nodes,
**Stop at start** defaults off; turn it on to hold the first line. Older nodes retain their startup
hold. Arguments are remembered separately for each program and folder. Its session opens in the
view and its file opens in a node tab with the margin. Enable Stop at start to place record
points and breakpoints before the program continues; other JavaScript files open from the same
folder take breakpoints too, and so do TypeScript files open from it when a source map of the build
lists them and is not older than they are (the node maps their lines onto the JavaScript that
runs). Opening another source file while the session runs asks the node to admit it, then adds
its breakpoint margin. A refused file explains whether it needs source maps, changed since
attach, or lies outside the folder. An older node keeps the original files' margins and asks
for an update in newly opened files. Admitted files travel with Restart, including files with
no points yet. The folder must be one the node may run code in. A node without its JavaScript debugger
installed (`abele-node debugger install js`) refuses and says so. An empty session list does not
start a process by itself.

Supporting nodes provide admitted caller-frame paths and enriched exception text. Selecting a
caller opens its source; runtime and library frames without admitted source say so. Exit codes
appear when the node has observed them; an unknown code is never treated as success. Restart
installs carried points before releasing an entry hold. A supporting node restores attachment
breakpoints itself, including disabled state; the plugin does not overwrite them with an older copy.

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

## Recording a run

A [saved request](Requests.md) can be sent into the run being recorded: it heads the steps the
code took while it was out.

Where the node advertises `trace_v1`, a breakpoint can be a **record point**: right-click a
line's margin and choose *Add record point*, then name what to take under the line (names in
scope, offered from the line, or expressions written `expression as name`), an optional
condition and a note. A record point is a diamond in the margin; pressing it opens its setup
again, and its right-click menu turns it back into a breakpoint or removes it. Only what is named
is taken; with nothing named each pass is a step with its place and stack and no values.

There is no record button. Whenever a session has a record point, the program is recorded: each
time it passes a record point the node takes the named values **whole**, writes a step and lets
the program go on. Ordinary breakpoints still stop. Stopping the program keeps the run. Before
the first record point of a project the plugin asks where runs go on the node's disk (by
default `.abele/runs` in the project); the folder row in the panel's *Recording* group changes
it later.

The panel shows a *Recording* group while a run is written (how long, how many steps, the
folder) and a *Runs* group with the project's runs; a breakpoint row says how often its record
point fired in the newest run. When a run ends (the program stops, or its last record point is
removed) it opens by itself as a tab of the main area; the *Runs* group opens any other. The count
at the end of a record point's line opens the newest run at the last step that point gave. A run's
tab shows steps on the left by time,
the picked step on the right with its place in the code, its stack and each value by shape,
with what changed since the last time. *Open whole* opens a value in a tab of its own, as its
shape, its whole text or its changes. A value can be followed through the run and anything can
be marked. A run's menu renames or deletes it; deleting asks first.

On nodes that capture program HTTP traffic, *Only the requests* shows incoming served requests
and outgoing requests with their method, path, host, status and duration. Correlated code steps
stay under each request; the clock icon identifies links made by time. Older nodes keep the
browser-only explanation when no HTTP steps are available. Each run belongs to one debug session.

A run never writes a note by itself. *Write a note about this run* in a run's tab writes one into
the folder set in Settings →
Nodes (*Notes about recorded runs*): a vault folder, or on a computer any folder, outside the vault
too, picked with the folder button. A device where that folder does not exist says so and writes
nothing. Its links open the values on the node. The agent reads runs
with the `trace_*` tools, each answer bounded, and can write the same note.

Not yet: recording without stopping the program, the browser's requests on the same timeline,
links the node suggests between steps, comparing runs, and marks written in a note going back
into the run.
