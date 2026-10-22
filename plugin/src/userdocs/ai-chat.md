# AI chat and agents

Chats with AI models that can read and change your notes, inside limits you set.

## Setting it up

1. Turn on **Settings → Abele → AI Agent**.
2. On its **General** tab, add a provider: a name, the API's base address (any OpenAI-compatible
   API works), and the key. The key is kept in the device's keychain, not in the settings.
3. Add at least one model to the provider.
4. On the **Agents** tab, open the `Default` agent and give it that model.
5. Open the chat with **Show AI chat sidebar**, or the robot in the ribbon.

### Waiting for slow models

On mobile, the **General** tab also offers **Keep running in background while agents work**
and **Keep running in background always**. Both are off by default. They play a silent loop
using a mixing-friendly audio session where available. The first stops shortly after the last
turn ends; the second continues even when idle. This may use more battery and cannot guarantee
background execution under every system policy.

If a local model connection fails while the mobile app is in the background, Abele waits for
you to return and reconnects automatically. The chat quietly shows **Reconnecting…**.
Completed work is kept; the unfinished response is requested again, without repeating
completed tool calls. **Stop** cancels reconnecting too. This works while the app keeps the
turn in memory, not after the operating system closes the app completely.

On the **General** tab, **Request timeout (seconds)** sets how long Abele waits for a model
connection or the next response chunk. It defaults to **60**; use a higher value for slow local
models. Values from **1 to 3600** seconds are accepted; clearing the field restores 60.
To give a particular model a different wait, open its card under **Providers** and set
**Request timeout (seconds)** in the model editor. The same **1 to 3600** range applies.
An empty model field follows the global timeout, including later changes to it; clearing an
override returns that model to the global value. Save to keep changes to a model.
Invalid input stays visible with an explanation instead of silently saving an earlier value;
correct it before saving a model. An invalid global value is not saved either.

It is an idle timeout, not a limit on the whole answer: a model can keep answering longer as
long as each chunk arrives in time. Each chosen model uses its own override or the global
value for chat, fallback, delegated and review responses, chat titles and compaction alike.
The global timeout travels with **AI general** settings; a model's override travels with its
**AI providers** entry. Model-list fetching, image generation and voice input keep their
separate timeouts.

A custom OpenAI-compatible base address uses streaming **chat completions**, just like a
provider's default address. SSE keep-alive comments count as connection activity. A proxy or
provider can impose its own shorter limit; increasing Abele's timeout cannot extend a
connection it has already closed. Timeouts, streamed provider errors and responses cut off
before completion are shown as chat errors with retry controls, not silently treated as an
answer. Only pressing **Stop** is treated as a cancellation.

Reasoning also consumes the model's **Max output tokens** budget, independently of time.
If that budget runs out before any answer, the chat shows a token-limit error. Increase that
model's output-token limit or lower its thinking effort before retrying; a longer timeout
alone does not increase the token budget.

## Agents needing attention

Open **Agents** from the activity icon in the ribbon, the chat header, or the command
palette. The command can be assigned to the mobile toolbar. There is no floating button.
The number counts conversations needing attention, not operations: three approvals in one
chat count as one. In the chat header, the activity button appears only when another
conversation has an approval or question waiting; otherwise **Agents** is in **More chat
actions**. The number never counts tool operations or the request already on screen.
Incomplete coverage remains explained in the agents list; an absent number is not proof that
all conversations could be checked.

The list has **Waiting for you**, **Working**, **Offline** and **Not checked** sections,
with search and ordinary keyboard-accessible buttons. Sessions on a connected node are listed
by what they do, like the vault's chats, and are asked again whenever the list opens. Only a
node whose connection is down is offline; a connected node whose sessions could not be read,
or a session that could not be read, is under **Not checked** and the rest stay listed. Opening a row returns to its existing
conversation and request; discussions remain discussions. Approvals are reviewed in the
conversation, never granted from the list. Ordinary question marks in an answer do not count
as explicit questions. An error handled by the agent while it continues is not an alert.

Stopped-run errors remain until **Mark as seen** is explicitly pressed. That mark
belongs only to that error; a later failure returns to the list. Opening or closing a tab does
not dismiss an error. The list survives restart and includes unopened local chats and
closed discussion tabs. Interrupted local work is labelled as interrupted and is never
resumed just by opening the list. Stale or uncertain approval/question/work entries offer
a cross to remove them: the dismissal is saved first, then the entry disappears; the conversation
and its history remain. An accepted tool interrupted before its result can also be dismissed,
or leaves the list when a later run of that chat completes successfully.
Existing saved approvals can be reviewed again; saved
questions retain their text and answers, but a lost local process cannot still be waiting.
Old conversations without explicit execution evidence are not guessed to be failures.
An interrupted question offers **Continue with a message**: write the answer in the composer
and explicitly send it as a new turn. It does not pretend to answer a process that no longer
exists. Interrupted work offers an explicit continuation; opening the row starts nothing.
Local work is identified as being on this device: file sync does not arbitrate simultaneous
answers to local approvals across devices.

Renaming a discussion file preserves its original note-marker identity, owner and tab closure,
including after restart, even if it had already been expanded into a chat. A copy cannot take
over the original's note marker simply by being discovered first. Renaming the note it discusses
updates its source normally.

The local list retains unresolved evidence until a saved answer/acknowledgement proves it is
resolved, or its file is confirmed deleted. Missing or unreadable data does not mean resolved:
those rows remain marked uncertain. Available safety copies are inspected without modifying
them. Opening a row is read-only. Changes arriving through file sync update open conversations'
attention state, and a stale save cannot undo a recorded acknowledgement. A tool already
accepted and executing appears as work, not another approval request.

A connected node is asked for every session's state and its open permissions and questions;
an idle session is not listed. A node that is offline, connecting, or could not be read in
full keeps the list marked incomplete, so zero known requests is never taken for zero Node
requests.

When all 20 tabs are occupied, returning from this list offers a choice of a tab to close;
nothing closes automatically. On a phone, opening the list or conversation does not focus
the composer or search and does not intentionally bring up the keyboard. No model requests
are made to populate the list.

## Node sessions

**Settings → Abele → Nodes** connects this device to a local AbeleNode daemon. Create a
separate installation token with `abele-node token create`, then paste it beside the node's
label and loopback URL. The token stays only in this device's keychain, even with the synced
key store unlocked. Local tokens are never sent to remote endpoints.

For a phone or remote desktop, the owner first enables the node's separate paired listener
and tailnet-only Tailscale Serve endpoint. The local-token listener must never be exposed.
Both devices must be on the intended tailnet, and the owner must verify its access policy
and the exact supported Obsidian WebSocket Origin (desktop policy is not proof of iOS support).
Choose **Pair remote node**, then paste an invitation from `abele-node pair invite`, or use
**Scan invitation QR** to photograph a code or select its picture. Review the full node key
fingerprint with the owner before **Pair this device**. The invitation is sensitive and expires
on the node's clock; keep it private. No access is granted until the owner compares the full
**device key fingerprint** shown here and confirms that exact key on the node.

**Waiting for owner confirmation** automatically checks while the dialog is open; **Check**
in Nodes works later. Pending invitations and non-extractable private keys live only in this
device's IndexedDB, not the vault, `data.json`, key sync or settings transfer. Another device
must pair independently. Unsupported key persistence or cross-window locks fail explicitly.
After a lost reply, retry the same retained invitation: **Resume pairing** reuses the same
persisted device key, with the node's 24-hour consumed-invitation recovery window. An old
registration does not prove a fresh re-pair claim succeeded: **Pair this device** stays available
until that exact invitation's claim is acknowledged. A newer invitation saved by another window
is never erased by an older connection's completion.

Only the owner can revoke access (`abele-node pair revoke INSTALLATION_ID`). **Remove**
forgets the registration, not the node grant or history. To re-pair a revoked device, request
an invitation bound to its existing installation ID; this preserves receipts and sessions.
For a rotated node key, pairing displays both old and new fingerprints and requires explicit
independent verification of the new pin. Failed connections never authorize a pin change.
If the owner changes the endpoint hostname or port without changing the node key, pairing shows
both old and new addresses and requires separate independent verification of the new endpoint.
It never silently moves an existing binding after a connection failure. A lost private key needs
owner re-enrollment, not a copied key or transferable configuration.
Foreground reconnect/replay is supported; background socket survival on a phone is not promised.

After adding a node, **+** still opens an ordinary new chat; while it is empty, its agent list
ends with **On <node>…** for each node. Pick an existing session, create a **fake session (non-executing)**, or open
**Folders and worktrees in the node panel…**.

The **Node** panel in the left sidebar is where a node's folders, worktrees and files are. The
row under its header names the place shown, a branch with its folder under it; press it to
search every folder, worktree and node chat, and its **…** menu for everything done with that
place: a new chat, switching or comparing branches, new and attached worktrees, giving a chat
access, opening a folder, refreshing, and the node itself. The header's four buttons switch
between the place's **files**, its **changes** (not staged, staged, and committed on the branch
but not in its base), its **history** and its **pull requests**. Under the branch name, codes say
what it is compared with and how far ahead and behind it is; **Compare with…** picks another
branch or tag, and the cross beside «vs …» goes back to the default. Opening a file shows it in
its own tab, where the pencil edits it in place.
Choose **Claude Code**, **pi** or **Fake** and a
session title; an attached session can be reopened instead of starting another one. It uses the same
chat tabs, message renderer and composer, but never runs the plugin's agents or vault tools.
It accepts text only; local slash commands, attachments, history editing, branches and rewind
are not offered. Node file links open the workspace's retained file view, never a
coincidentally named vault file. Nested `abele-message` blocks in node replies remain plain code,
including their note links and embeds; they do not open vault-backed message cards.
**Folders and worktrees** in the node chat header's **…** menu opens the Node panel. That menu also
holds reconnection and native-session resume information. Unavailable providers are disabled;
provider details list supported, unsupported and unverified capabilities with the node's reasons.
Gated steering and question-initiation actions are disabled. Model login and endpoint availability
are not established by an installed provider. pi compaction, extension UI and native child evidence
are not offered as verified features. The compact header shows the
session title, connection/run status, and an interrupt icon only while a turn is active.
Its read-only preview lists changed and untracked paths and shows the current unified diff
of tracked staged/unstaged changes against HEAD. Untracked contents are not included, and
the preview is not an immutable snapshot. Refresh it to review newer work.

The header's **Browse workspace files** opens a browser including dotfiles,
ignored and untracked files. Symbolic links are listed but never followed. File views use
numbered code with the same presentation as GitHub tabs; binary and oversized files show
metadata instead of text. The Node panel also offers browsing without attaching a session.

Choose **Edit file** (in a Node panel file's tab, the pencil in the tab's header) to edit an
existing small UTF-8 file in the same numbered code view; the header then saves (also with
⌘ S), discards the edits, or stops editing with the edits kept.
Unsent text and its original version are stored only on this device, including across plugin
reloads. **Save file** checks that original version before applying the change. Saving accepts
at most 32,768 characters; larger local drafts remain stored but cannot be submitted. Binary
files, symbolic links and Git metadata stay read only. There is no file creation or Git mutation UI.

A **Conflict** or **Changed on disk** keeps your draft separate from the changed workspace and
offers two choices. **Reload** re-reads the file from the node and discards your local draft,
asking for confirmation if you have changes. **Keep mine** re-reads disk and keeps your text,
explicitly adopting the current content identity as the next Save's precondition. It does not
write the file; a later external change can still conflict. **Discard local draft** forgets
only known, local editor work and never restores or changes the workspace file. If disk
returns to the original version after a conflict, **Keep mine** still lets you continue.
Your retained text remains readable and copyable even if the current file becomes binary or
exceeds the viewing limit.

Drafts of the same workspace file are shared by views on this device. If another view changes
one, an older editor cannot silently replace it or save the newer text without showing it.
Copy any private text you want to keep, then explicitly reload the shared draft. Ordinary
reopening refreshes shared work; a visible copy that could not be stored stays visible instead.
Reload cannot roll back text entered while its read was pending. If local validation or storage
fails, saving/reloading is blocked and the copy warning remains until the text can be stored.

A **Save outcome unknown** is not success or a safe reason to save again. Reconnect and
choose **Check save**: the original operation is retried, never a newly allocated edit. The
editor is locked until a known result arrives. A node-confirmed uncertain write stays locked for inspection; its receipt names a recovery
copy in node storage, never a temporary file in the workspace. **Read retained predecessor**
uses the same code presentation. Copies, including uncertain writes, are bounded to 32 files
and 16 MiB per workspace; oldest copies expire when another copy needs that quota. The node
also exposes an explicit, version-checked restore action through its client API. Recovery
never guesses success from matching bytes or automatically restores/repeats the original save.

Node API writes are serialized, but external editors and agent shell writes are not. Existing
files are written in place: the inode, permissions, owner/group, ACLs and attributes are kept,
and an already-open external editor still writes the live file. Read-only files are refused
cleanly. Concurrent writers can interleave, as with any editor; verification reports observed
disagreement and the next save checks its base again. A saved receipt confirms the accepted
version, not that no external edit happened later. No recovery filenames enter Git staging.

After save/check completion, a revision is accepted only with its matching visible text/base.
An intervening shared draft produces a local conflict rather than silently replacing metadata
behind the editor.

In **Diffs**, choose HEAD/worktree, staged, unstaged, committed branch/base, or a commit
change. Branch/base explicitly compares the merge-base with HEAD, not uncommitted files.
**History** lists commits and opens their change. **Open new snapshot** captures newer work;
an already open snapshot remains unchanged even when an agent edits the workspace.
Reopening restores that snapshot's comparison mode and commit. The controls describe the
next snapshot request; **Current comparison** describes the retained diff actually shown,
including when a new capture fails.
Select line numbers (including ranges) in the shared GitHub-style diff, choose **Comment**,
and **Add to review**. One comment may cover at most 200 lines and contain at most 2000
characters; a batch holds at most 32 comments. Invalid additions are refused before the
editor is cleared. Comments across files or snapshots collect in one batch; remove a
comment before sending if needed. **Send review** submits exactly one session input, including
retained selections and their comments. If the workspace has changed, or its current diff cannot be rechecked, acceptance marks
retained selections stale rather than silently moving them onto different lines. Failure
to re-capture a large or unavailable current patch does not discard valid saved context. A selection keeps
its snapshot identity and original text even if another snapshot is opened while a comment
is being composed. Add or clear that comment before choosing a different target. Closing
this browser discards pending read results, so they cannot replace a reopened view.
Comments in a submitting or queued batch are read-only until its outcome is known.
Node links ending in `#L12` or `#L12-L20` open the file at the marked line or range;
the fragment is navigation, not part of its filesystem path. File-link reads and refreshes
of the previously browsed folder are independent: a removed folder may show an error,
but it does not prevent opening an existing linked file.

A disconnected review is stored in the same device-local queue as messages. **Check queued
review** checks the original receipt; it never sends a second batch. A terminal rejection
keeps comments editable. Unsent comments and open views survive closing/reopening the dialog
while its chat tab remains alive, but are not saved across plugin reload or tab disposal.
Submitted batches and receipts are durable. Browse-only workspaces cannot submit reviews;
open the browser from a workspace session to send one.

Claude and pi assistant text renders as Markdown; tool rows show the name and a short argument
summary. Click the tool icon to expand arguments, results and file previews. Successful Edit calls show
before/after snippets, Write calls show supplied content, nested work is grouped and thinking
is collapsed. Tool previews are collapsed initially; automatically authorized calls have a quiet
**Claude settings** note with the full authorization label on hover. These are provider-reported operations, not immutable file snapshots; review
the workspace diff too. Empty thinking is labelled honestly. Large normalized output is
loaded through authorized artifact reads and cached locally. Interrupted or timed-out reads retry
when the connection returns or the history refreshes. A successful manual read also restores
the rendered reply. Invalid payloads are not retried automatically. **Read stored output** exposes
other retained content; raw provider evidence stays collapsed under **Other journal records
and provider evidence**, with **Read stored record** for each artifact. Individual outputs
above 1 MiB are not rendered inline.

The status distinguishes **Offline**, **Queued**, **Accepted**, **Running** and **Needs
attention**. After connecting once, messages sent offline are kept on this device and replayed
with the same operation identity on reconnect. Unknown acceptance stays queued rather than
silently being resent as a new message. Queue state appears on the message itself, changing
from device-queued to node-queued using receipt identity rather than matching text. The small
**×** beside a node-queued message cancels it. **Stop** (the square in the message field) targets the
active run, not a later resumed run. Steering is not supported. Provider-issued permission,
confirm and trust requests have exact one-time approve/deny actions; select/input questions show
the supplied options or a text field (up to 32,768 characters). Deny cancels the question. Answers
retain the same immutable prompt/operation identity across disconnects and reloads, never a blanket
permission or a retargeted response. Ordinary follow-ups use the node's saved native session identity
to resume Claude or pi; an interrupted/unknown input is never automatically rerun. pi final messages
replace partial text, and parallel tool results remain correlated to their own calls and runtime.

Claude permission cards show the tool and a short argument summary, with the original
command, arguments or edit diff expandable. **Approve** is the accent button, with **Deny**
beside it, and **Stop** to deny all pending requests and interrupt that run without another
provider turn. Stop remains available while an answer is waiting for confirmation.
An approaching expiry is shown as relative time; distant deadlines stay hidden.
Approvals apply only to that exact action; no argument editing or permanent allow is offered.
Cards survive reopening/reload from the journal, including resolved/expired decisions.
After choosing an answer, the card shows **Answer sent** without another Approve/Deny choice,
even across tab switches or reload while confirmation is pending. Reconnection retries the
same durable operation, never a second UI answer; a terminal rejection stays visible.
A saved decision and its delivery to the provider are separate facts. Answer only while
connected. User Claude settings may allow a tool without asking the node: such calls are
labelled **Allowed by your Claude settings**, not as node approvals. Repository Claude
permissions are off by default; a trusted project can explicitly enable them in the workspace
dialog. The effective provider configuration and availability are shown there.
The header menu's **Ask for permission** pauses only a fake turn for a sample Allow/Deny
decision; nothing executes.
Closing a tab does not stop the node session; reopening or reloading the plugin restores its
history. Daemon journals own the history; the plugin keeps a device-local transactional cache,
not a Markdown chat file. Removing a connection does not delete node history or revoke its
token, and reconnecting with another token uses a fresh local cache.
**Detach session** releases an idle workspace lease without deleting history; it refuses
running/queued work. **Remove unused workspace** requires a clean managed worktree (including
untracked/ignored files) and retains its branch. The workspace dialog uses human progress labels and shortens long paths from the middle;
hover or expand a path to read it in full. Removal and detachment live in **Detach or remove**,
apart from creation and refresh, with confirmation. **Unregister project** retains the original
checkout and requires removing its managed workspaces first. Git initialization, merging,
pushing, editing files and automatic repair of jobs needing attention are not offered here.

### Long-lived sessions

A Claude Code chat on a node that keeps one process for the whole session shows how it runs at
the foot of the message field: a glyph for its permission mode (a red crossed shield when it asks
about nothing), the model's family, and how much of the context is taken. More than 80% turns the
share orange, more than 95% red. Pressing it opens one menu: **Compact the context…** first, then
the model, the effort, the subscription and the permission mode. Bypass can be chosen only when
the node was started to allow it. A change made while it answers applies from the next message.

The square in the message field stops what runs now, an answer, a turn the session started by
itself or a compaction, and keeps the session. **Stop the session…** in **⋯** also stops what it
runs in the background and its process; the conversation stays and the next message starts it
again. **Rename…** in **⋯** or `/rename` with the new name renames it everywhere.

Over the field a line says how many tasks it keeps running in the background; it opens to the
list. When one ends, a quiet line says what woke the session, and it answers by itself.
Compacting draws a line across the conversation; pressed, a finished one shows the retelling.
The compact dialog takes what to keep in focus and what to send once it is done. A message
another session on the node wrote to this one names that session over its words; pressed, it
opens that session's chat.

After `/` a session offers its own commands: `/compact`, `/model`, `/effort`, `/mode`, `/rename`
and `/stop`. `/compact` with words compacts at once and keeps those words in focus.

The node panel's fifth mode, **Sessions**, lists the sessions at the chosen place, each with a
dot for what it does (working, waiting for you, stopped with an error) and a red shield when it
asks about nothing. The mode counts the sessions waiting for you in orange.

## Saved requests

**Open requests** shows a project's saved HTTP requests in the left sidebar, beside the file
explorer. The first row picks the project and the node it is on; the requests are files in that
project, in `.abele/requests/`, so they are there only while the node is online. The row under
it is the environment the requests go out in: its menu switches between them, makes a new one
and edits the one in use. Collections are folders, and each request shows its method as a code
and, faintly, the status it got the last time, red when that was an error or it did not get
through.

Opening requests selects the project of the active node tab, or the debugger's project.
When the first request has no environment, it asks for the server address and creates a local
environment. A local HTTP address printed in the debugger output is offered when available;
otherwise enter the address and port of the running service.

A request opens in a tab: the method, the address and **Send** on one line, what the address
comes to in this environment under it, then **Params**, **Headers**, **Body**, **Scripts** and
**Checks**. Write `{{name}}` for a value of the environment and `${abele_key:name}` for a saved
key: the key's value is never shown or written anywhere, and the first time a key goes to an
address you are asked to allow it, the same as for a script. A key that is not on this device
keeps **Send** off and says which where the answer would be, with **Open keys** beside it.
The tab's header copies the request as curl (keys still by name), duplicates it and reveals it in
its collection; **Rename** and **Delete** are in its **⋯**.

The node sends the request, so a service running on the node's machine answers. The answer is
beside the request on a wide tab and under it on a narrow one or a phone: the status, the time,
the size, the body, the headers and how the checks went. **History** lists every send with its
environment and time; pick one to see its answer again, or press the compare icon on one to see
how its body differs from the answer shown. A request that gets no answer in 30 seconds may still
have reached the service, and it is never sent again by itself.

Values that must not be written, a token taken from an answer most often, go under **Kept in
memory** in the environment's dialog: they are blanked wherever they show and forgotten when
Obsidian closes. A token a script takes from an answer is kept that way and goes back only to
the address it came from. **Scripts** runs a script of yours before the request goes or after
its answer comes, when its header says `// @request` (see [Scripts around a request](scripts#scripts-around-a-request)).
Checks are lines in the request file, such as `status == 201` or `body.items[0].qty == 2`.

While a program of the project is recorded under the debugger, the view says so at the top and
**Send** gets a switch beside it, enabled by default. The send goes into the recording: its answer says
how many steps the code took while the request was out, and pressing that opens the run with the
request heading those steps. **Only the requests** keeps those code steps under their request;
pick a step to read its values. A clock beside a step means it was put there by time. When the
environment has **Say the step** on, the request carries an `X-Abele-Step` header a record point
can take.

On a phone the view is in the left drawer and a request opens on the whole screen; it is sent
from the node all the same.

**Import requests from the clipboard** brings in what you copied: a `.http` file, a curl line, a
Postman, Insomnia or Bruno export, a HAR file a browser saved or an OpenAPI description. The view
opens on the collection they went into, the new rows in sight; a name already taken gets a number
after it and nothing is overwritten. A request that cannot be carried over (a file upload, a
GraphQL body) is skipped and counted in the message. They go into the project the view shows, values they name are added to the environment in use where it lacks them, and
anything that carried a credential (a cookie, an `Authorization` header, `-u user:password`) is
left out and named, so you can put it back as a saved key.

## Debugging a program on a node

You can debug a Node.js program in a node folder without opening a chat. Choose the folder in
the node panel, then use the node's **⋯** menu, the folder or file menu, or **Run a program**,
**Attach to a running program** and **Debug** in the command palette. A selected node file
supplies the command's folder; otherwise the node panel's selected folder is used.
Unavailable menu actions say whether to reconnect, update the node, enable `--debugger`, or
install its JavaScript debugger (`abele-node debugger install js`). Running code requires
trusting the registered project and allowing execution in the selected folder or worktree.
Existing chats keep the same actions in their **⋯** menu:

- **Run a program** starts a JavaScript file of the selected folder under the debugger. Pick one of
  the files open from that folder or type its path. It waits on its first line, so you can set
  breakpoints before it goes on.
- **Attach to a running program** connects to a program that is already running with its
  debugger port open, for example a server you started with `node --inspect app.js` (or
  `--inspect-brk` to hold it on its first line). The list shows each Node.js program on the
  node's machine that waits for a debugger: its command, the folder it runs from, its process and
  port. Nothing in the list means no program was started with `--inspect`: start one and open the
  list again. A program that runs outside the selected folder is attached only after you confirm it.
- **Debug** opens that folder's debug sessions again. Chat-menu actions keep their chat scope.

The session opens in the **Debug** panel on the right: Continue, step, pause, the call stack,
variables and watches. The program's own file opens with a margin beside its lines: click it to
set a breakpoint, or make it a **record point**, which takes the values you name each time the
program passes and lets it go on, so a run can be read afterwards without stopping it. For an
attached program, lines take breakpoints only while its file is unchanged since the program
started; edit it and restart the program to debug the new code.

The last button of the panel is **Stop** for a program the debugger started and **Detach** for
one it attached to: detaching takes the debugger and its breakpoints away and the program runs
on. **Restart** runs a started program again with its breakpoints; an attached one is restarted
by whoever started it.

## Offering tools by section

Open an agent on **Settings → Abele → AI Agent → Agents**, then its **Access** tab.
Under **Tools**, **Offer tools** chooses between **By section** (the default) and
**All at once**. By section starts with the file tools, skills, the reference and questions,
plus one entry per tool group — Nodes, Tasks, Finance, Canvas, Maps and so on — that says what
the group is for. When the conversation needs one, the agent opens it and gets its tools, how
to use them and, for Nodes, what this chat may reach on your computers right now. All at once
gives the agent every enabled tool immediately, which costs more on every message.

A section is listed only if at least one of its tools is enabled. Opening it never turns on an
Off tool, and Ask tools still ask for approval. Open sections stay with the branch of the
conversation: going back to before the agent opened one closes it again. A chat with node scope
has Nodes open from the start. Beside each section's name, **Always open** gives the agent its
tools from the first message and **On request** (the default) waits for the agent to open it.
Under the name is what the section tells the agent; the pencil puts it in this agent's own
words, and **Reset to default** brings back the original. The words can also be changed for
every agent under **Tool descriptions**; an agent's own words win. All of this travels with the
agent when you transfer settings.

Nodes shows actions instead of a row per tool: **Read files and search**, **Edit files**,
**Worktrees**, **Hand work to a node agent** and **Debugger runs**, each with Off, Ask or Auto;
**Debugger runs** holds the saved requests' tools too. Allowing reading never allows handing work
to an agent, reading the debugger's runs or sending a saved request. The count
under an action opens its tools, each with its own choice; **Mixed** means they differ. These say
what the agent may do at all; where it may do it is each chat's node access. Old names of the
repository tools that do what a file tool does are not listed or offered; an agent that still
calls one is answered under **Read files and search**.

Files and Basics are always open, which their headings say instead of offering the choice.

When a node call is refused because the chat cannot reach that place, a line under the call
says what was missing by name. **Give this chat access** opens the chat's node access with the
node, folder and worktree already chosen; **Approve on this device** confirms access that
arrived from another device; **Open the Node panel** is for a node that is not connected. After
access is given the line says so; ask the agent to try again, it does not retry by itself. In
the Node panel, open the place's **…** menu and choose **Give a chat access…** to pick a
chat: the open one first, then the rest by when they were last used, each with its agent and
last question.

## Saved keys in requests

When the agent substitutes a saved key into a request, it always asks first, including in
Auto mode and discussions in the margin. The confirmation names the keys and the destination;
**Allow this address for these keys** adds a recipient, then **Allow** sends the request.
Allowing an address does not stop future requests asking. This also covers MCP headers that
substitute saved named keys. Agent policies and delegated runs cannot approve these requests
silently. Requests without saved keys keep their existing permissions.

## JavaScript calculations

**Evaluate JavaScript** is for calculations, not downloads. It runs for at most 10 seconds
without network, files, storage or other workers. Imports, `eval`, `Function` and string timers
are unavailable. Network requests belong in the Fetch tool or a script instead.

## Chatting

Other plugins' executable blocks (for example `dataviewjs`) and inline queries in replies,
thinking, run output and script markdown are shown as code, not executed. The same applies to
GitHub text. Your notes still use installed plugins normally. Abele charts, maps, galleries and
pele diagrams (Mermaid source) in replies still render, and internet images still load as before. Pele
output is cleaned before it joins the page. External links open only HTTP(S) or email addresses;
links to notes remain available.

Type your message and press **Shift+Enter** or **Cmd/Ctrl+Enter** to send it; **Enter** starts a
new line. The paperclip attaches files from the vault or from disk, pictures included, and other
agent chats; files can also be dropped or pasted onto the message box.

The agent's tool calls in a row show as one line saying what it did, such as
"Searched 2 · Read", with the number of calls. Its glyph turns while the work is going on, and a
dot marks a run where something waits for you or was refused or failed. Click the line to see
the calls one by one.

Attached pictures show a thumbnail before sending. Tap it, or a picture in a sent message,
to open Abele's preview. **Draw** opens the picture to draw on; **Send back to the chat** in
the picture editor's Save menu replaces an unsent attachment with the edited picture, leaving your
message and other attachments alone. From a sent message it adds a new picture to your draft.
The agent sees the picture and knows its file path, so you can ask it to edit the file and
show the result. HEIC/HEIF photos become PNG automatically on iPhone/iPad, where the platform
can read them, in chats and other Abele image imports. Converted external imports keep only
PNG; a HEIC already in the vault stays beside its new PNG copy. On desktop without native
HEIC support, a short message explains that conversion is available on iPhone/iPad. The
original is kept and attached as a file, not a picture the model can see. Sending waits until
imports finish, even if you view a delegated run, receive text from **Use in AI agent**, return
a drawing, or close and reopen the whole chat panel while they are pending. Your draft and
its pending attachments stay with the conversation.
Opening another conversation in the same tab cancels the old conversation's pending imports;
they never appear in the new conversation.

While the agent is answering, the paperclip and microphone remain available. Sending puts
your message, with its attachments and any dictated words, in the waiting queue. The agent
receives it at its next step, or on a new turn when the current answer ends. The clock row
shows the text and attachment names; its pencil returns them to the composer for editing,
and its cross cancels that message without deleting any files. **Stop** returns queued text
and attachments to your draft. Waiting messages are saved with the chat, using references
to files in the vault. After a reload they stay visible: use the pencil and send again when
you are ready; opening the chat does not start them automatically.

Type `/` at the start of the message box to see what it can be: the chat's own commands first,
then your skills, then your prompts, each with a line of description. Keep typing to narrow the
list; the arrows and Enter choose, Esc closes it.

| Command         | What it does                                        |
| --------------- | --------------------------------------------------- |
| `/new`          | Start a new chat                                    |
| `/load`         | Open the chat history                               |
| `/compact`      | Replace older messages with a summary, to make room |
| `/scope`        | Choose which notes the chat may open                |
| `/prompt`       | Show the saved prompts                              |
| `/<skill name>` | Run a skill                                         |

Chats working at the same time keep their access separate: each tool uses the scope and agent
of the chat that called it, not whichever tab is selected or started most recently.

Up to 20 chats can be open at once, as tabs. When all 20 are open and another chat has to open,
a list asks which one to close, like the quick switcher: quiet chats first, the ones waiting for
you or working last, with a dot and the time of the last message. Esc closes nothing. Every chat is saved as a file in the chat folder
(`AI/Chats` by default), so it survives a restart and can be found again in the history. When a
chat approaches 90% of the model's configured context window, older messages are summarized
automatically. This is checked before each model request, including between tool steps in one
long run. The latest tool calls, their results and any newly queued message stay intact so the
agent can continue, including after an earlier reply has been corrected. A reviewed correction
does not count as a new model reply that has read your latest message or tool results.
Results not yet included in reported usage are estimated; if the provider
returns no usage, the text of the context is estimated instead.

### Keyboard shortcuts for chat tabs

While the cursor is in the chat (in the message box or on the conversation), the keys work the
chat's tabs the way they work a browser's. **Cmd** is **Ctrl** on Windows and Linux; an iPad
with a keyboard uses **Cmd**.

| Keys                                                       | What they do                                   |
| ---------------------------------------------------------- | ---------------------------------------------- |
| **Cmd+W**                                                  | Close the chat tab in front                    |
| **Cmd+T**                                                  | Start a new chat in a new tab                  |
| **Cmd+Shift+T**                                            | Reopen the chat tab closed last                |
| **Cmd+Alt+→** / **Ctrl+Tab** / **Cmd+Shift+]** / **Ctrl+PageDown** | Next chat tab                          |
| **Cmd+Alt+←** / **Ctrl+Shift+Tab** / **Cmd+Shift+[** / **Ctrl+PageUp** | Previous chat tab                  |
| **Cmd+1** … **Cmd+8**                                      | Go to that chat tab; **Cmd+9** goes to the last |
| **Ctrl+C**                                                 | Stop the agent while it is working             |

Closing a tab never deletes the chat: it is saved, stays in the history, and **Cmd+Shift+T**
brings it back. On the last tab, **Cmd+W** leaves a fresh empty chat; once that tab is already
empty the key does nothing, rather than closing the chat pane. **Ctrl+C** is the Control key
on a Mac too, so **Cmd+C** still copies. While text is selected, in the message box or in the
conversation, **Ctrl+C** copies it and the agent carries on; it does not stop the agent either
while the cursor is in another field, such as find, and does what it always did when the agent
is not working. **Esc** does not stop the agent. **Alt+arrows**
still move by word in the message box. Outside the chat these keys do what Obsidian makes
them do.

Closing, reopening and switching tabs are also commands (**Close the current chat tab**,
**Reopen the last closed chat tab**, **Go to the next chat tab**,
**Go to the previous chat tab**), which can be given keys of your own in **Settings → Hotkeys**.

## Reading the conversation

The header keeps the agent, find, outline, history, new chat and **More chat actions** together.
On a phone, find and outline are in More so the agent's name keeps its room. Settings,
artifacts and agents are there too. A new empty conversation names the agent, describes its
purpose and offers access settings from its scope summary.

Reasoning is **Thinking** while it is arriving and **Thought** afterwards. It opens during
the turn and folds when the work finishes, unless you chose its disclosure yourself.
Consecutive tool calls form one work line such as **Searched 2 · Read**; press it to see the
individual calls, then a call's glyph for its parameters and result. A running glyph moves;
a status dot names waiting, refused or failed work in its tooltip.

Questions are cards with answer rows. Choose a row, use its numbered key while the card
has keyboard focus, or press **Your own answer** and type in the message field. The cross
skips the pending questions. An error retains your question and offers **Retry** and, when
configured, **Retry on** the fallback model. Automatic retry shows its countdown and attempt
number. Background chat tabs distinguish working and waiting with labelled dots.

The input's access button shows a vault glyph for full access, or a locked folder and the
number of selected places, including node grants. Its tooltip names all those places; press
it to edit the existing access settings. An empty access set remains available as zero places.
Only access errors, not a second list of node grants, appear over the messages.

## Message actions and a new chat from here

Each sent question and answer has a quiet action line below its words. On desktop its
buttons appear on hover or keyboard focus: copy, edit your message or retry an answer,
insert into a note, and **Ask here** where discussions are available. On a phone those
actions are in **More message actions**. The time is always visible; press it for details,
including the full date, token usage and highlights. Each action is keyboard accessible.
**More message actions** opens Obsidian's own menu, grouped by message, conversation and
file changes. Repeat, **Branch from here**, **Rewind** and **Undo changes** remain there.
Selection scripts, highlights, revision review and draft Send/Edit keep their existing places.

**Branch from here** continues inside the same chat: the chat stops at that message and a
line above the input says the next message starts a new branch after it. Finished calls also
offer a fork glyph on desktop or the same menu in their details on phone. A cut after a call
includes only the assistant's prefix through that call and its real results, never later
calls or placeholder results. It waits for your message or explicit **Continue**; nothing is
re-executed and files stay in their current state. Busy turns and node histories do not offer
local cuts. Its cross goes back
to where the chat went on. Where a chat went more than one way, the message that differs
carries the branch switch at its end: arrows to the neighbouring branches and **2/3**, which
lists every branch from that place with how it begins, how many questions it holds, its time
and a dot when something there waits for approval or was refused.

**New chat from here**, next to **Branch from here** in
the menu, creates a separate chat file and opens it in a new chat tab. It copies the current
branch from the beginning through that message, including its reasoning, tool results,
pictures and other attachments, but not sibling branches or later messages. Its title is
**<original title> (копия)**. The original conversation and its draft stay unchanged.
Wait for the current turn to finish or stop it before making the copy; unsent drafts cannot
be copied this way. While copying, the new tab shows **Creating chat copy…** and has no
editable controls. Any draft delivered to that tab is kept when the copy finishes. Text and
pictures sent there from elsewhere appear as soon as its editor returns, without switching tabs. Opening
another conversation in that tab cancels the unfinished copy without replacing that conversation.

The new chat keeps the source agent, model, per-chat settings and reviewer choices. It starts
idle: nothing is sent, tools are not rerun, and no provider session is resumed. Attached vault
files are referenced, not duplicated. Delegated transcripts are copied independently, so
deleting either chat does not remove the other's copied transcripts. Returning from a nested
run opens its parent as a read-only run, not as an editable chat. Deleting a chat removes
its delegated transcripts, including nested ones. Existing side discussions
and saved selection links belong to the original and are not copied. Reply highlights and
accepted edit history are retained. Note links are carried only where a write is recorded on
the copied path; manual links and older links without that evidence are not carried.

This action is for local chats, including side discussions, not node sessions or read-only
delegated-run tabs. Node histories still expose their read-only message details.

## Asking the agent to find notes

The agent can search by name, folder path, properties or words in a note's body. Name, path
and property checks use Obsidian's index without opening note bodies. Combining them with a
content search narrows how many notes need reading, even if the agent lists the content check
first.

Content searches read several notes at a time, with a fixed bound, and give the interface time
to respond between chunks. **Stop** cancels a search in progress. The result limit shortens the
list, not the search: the total number of matches still counts every accessible candidate.
Searching all bodies can therefore take longer on slow storage than searching names or
properties. Property text is not part of a body search.

## Navigating a conversation

**Outline of this chat** (the list button beside the magnifier, or in More on a phone) opens a table of contents in a standard
Obsidian dialog, on desktop and phone. Your sent messages are the main rows, oldest first,
with day separators and times. Titles come from the beginning of your text; textless messages
show an image, file or attachment count. Drafts and queued messages are not listed.

Choose a question to close the dialog and jump to it. **Answers** and **Agent work** expand
only the contents list, never the chat feed. Each answer and tool call can be opened directly;
tool details open when needed. Work waiting for approval or rejected is marked **Needs attention**.
An answer before the first question remains reachable too.

**Continuations · N** appears at each fork, even inside folded agent work. Open it to see the
beginning and time of each continuation, with **Selected** on the current one. Several starts
appear as **Conversation starts** above the questions. **Show continuation** reads the next
stretch of the contents; later forks expand one at a time. The shared prefix is not repeated
before every alternative, and the selected continuation is already listed in the main path.
Expanding a heading does not change the conversation.

Choosing a message on another continuation selects that branch for the next send and jumps
to the message. Later forks use their earliest continuation, as the chat's existing branch
arrows do. A shared message already on the selected path keeps that path. In the chat the
message where the ways part carries the branch switch, **2/3**, so the chosen way is marked
where it starts. This changes the conversation the agent will receive; it never rolls back files.

If the agent is answering, executing an action, compacting, retrying, waiting for an approval
or waiting for your answer, an off-path selection waits until the turn finishes. The pending
choice is one line above the input, naming the branch, with **Cancel branch switch**. The
branch arrows under a message wait the same way. Reading
messages on the current branch remains available. Choosing another message, switching chats
or replacing the conversation invalidates the old pending choice.

A question's **Discussions** lists direct discussions attached to it or the answers and work
that followed it. Each shows its quoted passage and first question. Choose one to open its
existing comment chat. **Nested discussions** lists only discussions on the sub-chat's current
branch and reads the next level only when expanded. Missing or unreadable discussions are
labelled, not silently hidden. Reading the contents does not migrate discussion files or
repair their safety copies; only opening a discussion uses its ordinary chat-loading path.
The comment's existing trail and **Back to where you were** in the outline provide ways back.

**To the start** and **To the latest** move within the current conversation without sending anything.
**Back to where you were** restores the exact branch and reading position saved before the navigation
jump, including from a discussion. A branch restore waits while that conversation is busy;
if the saved message no longer exists, you are told rather than taken to a different message.
Typed text stays in its conversation's draft through branch changes and returns. Expanded
contents rows and the list's scroll position are remembered while the conversation stays open,
not across a plugin reload.

Search starts on **Current branch**. Choose **All branches of this chat** to find other
continuations too. Shared messages appear once, and results name their continuation. Search
uses available display text, including folded reasoning and tool details, not the technical
journal. Picking a result opens the existing find bar at that message part.

**Search discussions (including nested)** explicitly adds related discussion files. They are
read only after this option is enabled with a nonempty query, with a running file count and
**Cancel search**. Missing, unreadable or not-yet-synced files remain visible as unavailable.
Cancel retains the partial results but publishes no late matches or descendants. A changed
query, scope or closed dialog invalidates the previous search. The selected search scope also
applies inside discussions; choosing a match opens that discussion at its message and part.

On desktop, **Up/Down** moves through rows, **Left/Right** folds and unfolds a focused heading,
**Enter** chooses, and **Escape** closes. The scope selector keeps its native arrow keys. On a
phone, opening Navigation does not open the keyboard; tap its search field to type. No model
calls, new settings or chat-format changes are involved; branch choices use the existing
selected-path metadata.

## Finding words in chats

**Cmd/Ctrl+F** inside a chat, the magnifier over it, or **Find in the current chat** from the
command palette opens a find bar: every match in the
conversation is marked, the counter says which one is shown, and **Enter** and **Shift+Enter**
(or the arrows) go to the next and the previous one. It finds words in the whole conversation —
the older messages not shown yet, the agent's reasoning and what its tools returned — and opens
whatever they are folded away in. **Esc** closes it.

The chat history lists the chats newest first, by when each was last written in, under a date
for each day; the sort glyph's menu offers **Last message** and **Date created**, and the
choice stays on that device. Renaming a chat, a summary written later, tool records and system
dividers do not move it. If no sent message has a date, its creation date stands in, never the
file's modification time.

To look through every chat, type into the search of the chat history (the clock over the chat),
or run **Search all chats** from the command palette. By default, it searches the title and the
description under it. Press the **Search in messages too** glyph beside the field to find what you and the agent
said in the chats. This switch starts off and remembers your choice on this device only; it
does not affect finding words inside a single chat.

A chat found by its words shows them with a few either side and the date they were written.
Opening it takes you to that message, with the find bar open on the same words. The first
content search reads every chat once, which takes a moment in a large history; after that only
the chats that changed are read again. Searching titles and descriptions does not build that
message index.

An answer is drawn the way a note is: an agent can show you a gallery of pictures, a diagram, a
chart, a map, callouts, formulas and coloured highlights, or embed one of your notes, right in its
reply. Links in it open the note they name. The same goes for what a script shows you and for the
views scripts open.

The chat's settings button opens one dialog with everything about this chat: its scope, skills,
prompts, permissions, model and tools.

## Links back to selected words

Select words in a saved user message or finished reply, including messages in a side discussion.
On a computer, right-click and choose **Copy link to selection**. On a phone, lift your finger,
wait for the selection bar, and tap **Copy link to selection**. Native Copy, **Ask here**, and
**Highlight** remain available. Drafts and replies still being streamed are not link targets.

Paste the copied link into a note. Opening it returns to the conversation and briefly marks
that exact selection without opening the phone keyboard. Your current branch is kept if it
contains the message; otherwise a branch containing it is opened. The message text is not
changed, and no card or note is created automatically.

Links survive closing the chat, reloading, moving, and renaming its file. They identify the
conversation, not just its filename. If you have duplicate copies, **Choose selection source**
asks which copy to open. If the source is gone, a notice explains that instead of opening a
different conversation at the old path. Returning also checks the saved file when the chat is
already open, so selections and edits arriving from another device are not resolved against an
old on-screen copy. A newer return takes priority over an earlier link still loading. Your draft
is kept; if a changed file conflicts with local work still in progress, a notice explains why
return cannot safely refresh the conversation yet. If you edit the chat or change its settings
while return is loading, that older snapshot is not applied: open the link again to return from
the updated conversation.

After a reply is edited, a selection that has no verified placement in the new version opens
**Saved selection**: the retained earlier version, read-only, with the selected words. If an
exact placement cannot be verified, the original quote is shown without guessing another
occurrence. Copying waits for the selection to be saved; a failed save reports an error and
does not put a new link on the clipboard. Keep compatible plugin versions on all devices:
older writers can discard this optional selection data when saving a chat.

## Highlighting and revising replies

Select words in a finished model reply. On a computer, right-click and choose **Highlight**;
on a phone, lift your finger and wait for the selection bar, then tap **Highlight**. New
highlights are yellow. Click or tap an existing highlight to change its colour or remove it.
The six colours are the same as in books, using the note highlight styling. You can also press
the message's time to see its highlights and their **Remove** buttons.

You can add, recolour and remove highlights on earlier replies while the agent is working.
The answer still being streamed becomes available for highlighting once it finishes.
Highlights stay with the chat when it is reopened or synced. They are visual annotations;
they do not alter what the model reads.

To ask for a revision, select the passage and choose **Ask here**. In that side discussion,
explicitly ask the agent to rewrite or clarify those words. Its proposal stays visible as a
**Proposed change to a reply** tree line with a waiting dot. Press it to compare the old passage
and replacement, then choose **Reject** or **Accept**. Close the dialog to decide later. Nothing changes just because the agent proposes it, even
when tools are allowed to run automatically.

Accept changes that passage in the parent reply and marks it with the editing agent and time.
The parent agent reads the revised wording from then on. The pencil beside its time opens
**Original reply**, starting on **Changes**; **Original** shows the retained reply.
**Undo last change** restores the previous version. The original and undo history travel
with the chat, unlike file rewind. Highlights stay with the old version and return on undo;
mark the revised version afresh.

If applying an accepted revision is interrupted, reopen its visible change line and choose
**Finish applying**.
Your Accept is kept before the parent is changed; it cannot turn into Reject afterward. Once
applied, use the parent reply's undo to put it back.

Wait for both chats to finish working before accepting. If the parent changed elsewhere, reopen
it and ask for a fresh proposal. A selection crossing complex or partial markdown syntax may
not map safely; select a complete passage or words within one formatted span instead. To revise
an accepted replacement again, select its new words and start a new comment.

## Rewind

Everything an agent changes in your vault from a chat is remembered, so you can take it back.
Open **More message actions** under one of your messages and pick:

- **Rewind** — shows every file the agent changed from that message on, each with what will
  happen to it: put back as it was, sent to the trash (a file the agent made), made again (one it
  deleted) or moved back. Tap a file to see the difference. **Put files back** starts off;
  **Go back in chat** returns to that message with its text in the composer, keeping later
  messages as another branch. Choose the switches explicitly, then press the button named for
  that action. The file-restoration button is a warning action; **Cancel** changes nothing.
- **Undo changes** — takes back what that one message's turn changed and nothing else. Offered
  only where the turn changed something.

A file changed after the agent, or whose ownership cannot be verified, is marked and left
untouched. The expanded row explains why; conflicts are not overwritten. Reading the dialog,
branching, switching branches and conversation-only navigation never restore files. The copies that make this possible are kept on this device
only, in the plugin's folder, not in the chat — a chat opened on another device cannot be
rewound there. How much room they may take is **Rewind space** in the AI settings, under Chat
Storage; the least recently used chats lose theirs first, and 0 turns it off. Something you
type into a note while the agent's tool is running is recorded along with the agent's change.

## Agents

An agent is a named setup: a model and a fallback model, instructions built from text blocks and
notes, which tools it may use, what it may see, and whether it may hand work to other agents.
Each chat picks an agent from the list in its header. Changing the model, scope or permissions
inside a chat changes them for that chat only.

A **utility agent** is hidden from that list. Scripts, other agents and interceptors call it.

## What an agent may see

The **scope** is the part of the vault a chat can open. It is built from files, folders, patterns
such as `Journal/**/*.md`, and groups. A group grants every note that belongs to it through
`groups`, at any depth. This is how you give an agent "this project" in a vault without folders.
If two notes answer to a short group link, it no longer grants membership in an agent's scope.
Write the full path, for example `[[Projects/Hub]]`, to say which group you mean.

**Full vault access** turns the scope off. Anything outside the scope is refused.

## Permissions

An agent's permission mode decides what it may change without asking:

- **Ask before every change**
- **Edit files without asking**: edits go through, deleting and moving still ask.
- **Everything without asking**

Every tool can also be set to off, ask or automatic, for example to keep web access off for one
agent. When a change needs your approval, the chat shows a card with what the agent would do,
the command, path or change itself, and **Deny** and **Allow**. **Deny** refuses only that call
and lets the agent continue. **Stop** on the left of the card refuses every pending call in the
run and stops the agent; queued messages return to the draft instead of starting another turn.
The card's **⋯** menu has the rarer answers: always allow that tool, always allow writes in
scope, and edit before allowing.

## Tools

Agents can read, write, search and move notes; follow the plugin's own links (a note's logs,
backlinks, tasks and transactions); search the web and read pages; look up addresses and routes
on a map; read your books; read GitHub; make and edit pictures; ask you questions with a form;
run your scripts; and delegate work to other agents.

**Current location**, under **Maps** in an agent's **Access** tab, asks your device where it is.
It starts on **Ask**: in an interactive chat, each request needs your approval unless you choose
**Auto**; **Off** removes the tool. Script `ctx.agent()` runs refuse **Ask**, since nobody can
confirm it there; **Auto** still permits it.
Delegated chat runs still refuse **Ask** because nobody can approve the request; choose **Auto**
if that agent should be allowed to request location there.
Your device may also ask for location permission. The answer includes the position,
accuracy, time and which platform answered — always the device running the chat, not another
synced device. It is sent to the model and kept in the conversation like any other tool answer.
When a helper model prepares a recap or shortens the history, the location tool's answer is
replaced with a redacted placeholder; the original answer stays in the chat.
The agent should request it only for questions that depend on where you are. There is no
automatic address lookup; looking up the address separately sends the coordinates to the map's
existing lookup service.

They can also work out numbers from your vault rather than guess them: totals and averages,
spending per category or per month, trends, how two things move together, rough forecasts and
unusual values — over your finances, over notes such as daily notes with `weight` or `sleep`, or
over the rows of a base. Ask "how has my spending on food changed this year?" or "does my sleep
go with my weight?", and the agent answers from the computed figures, with a chart if you ask.

## Delegated subtasks

A subtask never gets more access than the chat that starts it. It uses the stricter permissions
and tools of the parent and worker, with both scopes intersected; a worker with no scope
inherits the parent's. This also bounds selected skills and GitHub connections. A subtask
cannot read a note the parent cannot read. Delegation stops at the narrowest depth setting
in the chain, with a hard maximum of 3 levels, 20 items per call and 50 branch runs in a root
conversation while it is open. Concurrent and nested subtasks share that budget.

## MCP servers

**Settings → Abele → AI Agent → MCP** connects MCP servers reached over HTTP; nothing is started on
your device, so they work on a phone too. Give each a name, its address, and a token or headers if
it needs them. **Fetch tools** reads its list of tools, and that saved list is what agents are
told until you fetch again. You can fetch before saving the server, including after pressing
the tick beside a newly entered token. **Save** keeps the address and fetched list. An existing
saved token stays bound to its configured address; changing that address alone does not allow
a trial fetch to send the token there. Stored keys used in headers keep their allowed-address
checks too.

A server's tools are off for every agent until you switch the server on in the agent's
**Access** tab or a chat's permissions. They then ask before each call, unless you set a tool to
automatic. Every tool description costs tokens in each request, so give a large server only to
the agents that need it.

Renaming a server keeps its permissions, separate from every other server. When upgrading
older permissions, Abele keeps a choice only if it can identify exactly one tool. If a saved
name could mean several tools, those tools ask before running, and one notice lists what to
set again in **Access**. Abele remembers which servers owned the old names at upgrade, so
opening an old chat after a rename cannot give its permissions to a newly connected server.
Choices that cannot be matched safely are kept at Ask and listed in the notice, not made
automatic. These choices travel with settings transfer.

A pending tool call belongs to the exact server and tool it originally requested. If a
rename, changed tool list or changed server address makes it point somewhere else, approving it is refused
with a message asking for a fresh call. This also applies to older pending calls without
a recorded tool and destination identity; **Always allow** in the card's menu never grants a replacement server or
changed destination permission.

## Skills and prompts

A **skill** is a note with `type: abele-skill` that teaches an agent how to do something. The
agent loads it when a task needs it. Set **Skills folder** on the AI **General** tab for skills
offered to all agents, or keep a skill inside the agent's scope. Each agent may use all of
those skills, none, or a chosen few. Other skill notes do not appear in its tool instructions;
loading one asks you first, even with automatic permissions. Choosing a skill yourself from
the `/` list or typing its slash command still works.

A **prompt** is a note with `type: abele-prompt`: text you insert into a chat by choosing it from
the `/` list. Its `{{ placeholders }}` become fields to fill in first.

## Setting up a chat

The access button beside the send button, or **Access, tools and chat settings** in the chat's
**⋯**, opens the chat's settings, named after the chat. **Access** is what the agent may read and
write. **Tools** lists the tools by group: the glyph at a tool's end says whether it asks first,
runs on its own or is off, and opens the choice; a group's glyph sets all its tools at once. Tools
that are always on are folded under **Always on**. **Chat** holds the model, the system prompt,
the interceptor and whether to hide reasoning; a setting changed for this chat alone shows a
reset glyph that returns it to the agent's.

Things done to a chat once in a while are in its **⋯**: **Reload from file**, **Copy debug data**
and **Delete chat**, which asks first.

## Memory

An agent can remember short facts you ask it to keep, and sees them in every later chat. Edit or
remove them in the agent's settings, under **Memory**. New agents ask before saving or changing
memory; choose **Auto** if you want automatic memory. Saved modes on existing agents stay as
set, because older settings did not distinguish defaults from choices. Check **Remember** in
the agent's **Access** tab if an older agent should ask too. The model sees remembered items
as its own notes for context, not as your standing instructions. Custom memory templates stay
as written; saved copies of the former default use the new wording.

## Interceptors

An agent can have several interceptors, listed in its **Basic** settings in the order they run.
Each has the settings below. Your message goes through them one after another: the first reads
what you typed, the second what the first returned, and the agent reads what the last one
returned. The agent's answer goes through them the same way. One that is switched off, does not
check that side or whose pattern does not match is skipped. Add one with **Add interceptor**,
open its settings with the pencil (or by pressing its name on a phone), and move or remove it
from its **…** menu; on a computer you can also drag it.

While several read an answer, a small count by the turning icon says which one is reading
("2/3"). A held message says which one it waits at. If one of them fails, your message waits
with the reason and the work of the ones before it kept: **Retry** asks that one again and goes
on with the rest, **Send as is** sends it without the rest. An answer replaced by several has one
mark by its time; it opens a tab per interceptor, each showing what that one changed.

A chat's **Settings** tab says whose list the chat uses: the agent's, its own (which starts as a
copy of the agent's and is edited the same way), or none.

An agent can name another agent as an interceptor: a reviewer that reads each message you write
in that agent's chats before it is sent, and answers it on the side. You then send the draft,
change it, or talk it over first. While the reviewer is thinking, Send/Edit stay hidden;
**Stop** cancels the review and makes them available again without discarding your draft.

Turn on **Reply only** beside the interceptor in the agent's **Basic** settings to send your
message to the main agent immediately. The reviewer answers beside that same message in
parallel, with the chosen context, without Send or Edit buttons. You can carry on chatting
while it reviews; its reply does not become part of the main agent's conversation. It is off
by default, so existing interceptors still hold drafts for review. A chat's **Settings** tab
can override this choice along with its interceptor; choose **Agent default** to follow the
agent again. The switch works for both agent reviewers and scripts.

The interceptor can also be one of your [scripts](scripts#chat-interceptors). With **Reply only**
off, a script decides by itself: it lets the message through, rewrites it, answers it without asking the agent, or holds
it back for you. It can also approve or refuse the actions the agent takes while answering that
message, where you would otherwise be asked. If the script breaks or takes too long, or you stop
it from the chat, your message waits as a draft with the reason under it: **Retry** asks it again,
**Send as is** sends it as it is.

With **Reply only** on, the script runs in parallel while your message goes straight to the main
agent unchanged. If the script returns a reply, it appears under your message; if it says nothing,
nothing appears. It cannot rewrite or hold the message, replace the main agent's answer, or
approve or refuse its actions in this mode. An attempted rewrite, hold or approval leaves a
small explanation under the message, as does a failure or timeout. Neither stops the main turn.

**Checks**, under the interceptor, says what it reads: your messages (as above), the agent's
answers, or both. An answer is checked by itself when the agent finishes, without asking you:
the text stays a little muted with a turning icon by its time, and if the interceptor writes
something else, that takes the answer's place. A mark by the time says who replaced it; press
it to see the agent's own answer and the difference, and **Undo last change** to put it back.
The agent's next turn reads whichever text is there. What the agent did with its tools stays
done. If the check fails or you press **Stop**, the answer stays as it was and the reason is shown
under it. A message you send while the check runs waits for it. A reviewing agent's reply
becomes the new answer; a script returns the new text, or nothing to keep it. Checks work for
the plugin's own agents; chats with Claude Code, Codex or pi on a node have no interceptor.

**Only messages matching** limits the interceptor to text that matches a regular expression,
such as `^/todo`, whether a message or an answer. Everything else passes unchecked. Leave it
empty for everything.

## Delegation

An agent with a delegation depth above zero can hand a task to another agent, or the same task to
one agent per item of a list. Each run keeps its whole conversation, which you can open from the
chat.

## Voice

The microphone in the message box records you and types what you said. **Dictate into the note**
does the same in a note, at the cursor. The speech model and its key are set on the
**General** tab.

## Asking about a note

The note's context menus and mobile quick menu offer these actions in this order. The command
palette uses the same names:

- **Add to agent context** on a file, a folder or selected text adds it to the chat in front.
- **Chat about this** starts a chat with a link to the note already typed. With text selected,
  the link points at those lines and the text is quoted.
- **Attach to a chat** inserts a wikilink to the note into the input of the chat in front and
  shows that chat, without sending it or replacing its draft. With no chat open, a new chat
  opens with the link. With text selected, the link points at the selected lines, using the
  same format as **Copy link to selected lines**. Reading-mode selections also link to their
  lines when the passage can be resolved to the source.
- **Attach a chat to note** puts an existing chat in the note's **Chats** list (see below).
- **Copy wikilink** copies a wikilink to the note, even when the vault uses Markdown links.
  This action also works with the AI switched off.

- **Ask here** asks about a passage and keeps the chat tied to it. See [Comments](comments).

If the agent cannot see the note, this one chat is given access to it.

## Chat artifacts

**Files from this chat** in a local chat's **More chat actions** opens one view of its **Notes**,
**Images** and **Scripts**, with counts, paths and available dates. It updates while the chat
runs and includes saved messages from every retained branch, not unsent drafts or queued messages.

The changes section shows saved write diffs from the current branch, grouped by file.
Successive diffs join only when their contents form an exact chain; edits to separate passages
stay separate. Files disappear from the list when they no longer exist, while their saved
links and source messages remain in the chat history. Hidden files remain visible while they exist.

Notes and scripts are the chat’s current links, whether attached by hand or linked by a
successful write. Click a tree row to open the note or script's code view; this never runs or
approves code. Its glyph shows created, changed or linked work. **More** or a right click offers
**Show in chat**, **Reveal in explorer**, and **Unlink from chat**. Unlink removes only this
chat's link, never the file. Old calls do not restore an unlinked row; a later write links it again.
Scripts remain listed when script execution is disabled.

Images include sent uploads and completed image-tool results: generated and edited pictures,
screenshots, downloads, viewed pictures and drawings, each labelled by origin. Tap a thumbnail
to preview it. Their context menu offers reveal and source navigation, but no unlink or delete.
**Show in chat**
returns to a source message, switching branches and revealing earlier messages when necessary.
It is also offered for notes and scripts where saved results prove the source, and closes an
expanded message editor so the conversation is visible.

**Attach current note** and **Attach a note…** in the footer keep the existing attachment choices.
Only link changes need a saved chat in the history. Missing files leave this view without changing
the saved chat. Invalid paths retain a **File missing** dot. Moved images
are not guessed from filenames. Absolute or parent-traversing paths are unavailable, not
rewritten to another file. Older chats work with the links and evidence they actually saved;
no missing links are reconstructed. Generated and edited pictures require a saved-file
confirmation from the tool; older results that saved only text cannot prove creation and are
not included, even if the text says an image was saved. Delegated sub-agent outputs are not aggregated into
this view. Switching to another chat closes the view.

## Chats under a note

A chat that changes a note is listed under that note, in the **Chats** list of its footer. You can
also put one there yourself: **Attach a chat to note** in the command palette or a note's
context menu, or the attachment controls in **Files from this chat**. The unlink button on a chat's card
takes it away again. Scripts can have chats attached the same way.
