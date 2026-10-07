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

## Node sessions

**Settings → Abele → Nodes** connects this device to a local AbeleNode daemon. Create a
separate installation token with `abele-node token create`, then paste it beside the node's
label and loopback URL. The token stays only in this device's keychain, even with the synced
key store unlocked. Remote addresses and phone connections are not available yet; the local
node can run Claude Code when its installed CLI is available.

After adding a node, the chat's **+** menu offers **Local chat** and **Session on…** for each
node. Pick an existing session, create a **fake session (non-executing)**, or open **Projects
and workspaces…**. Register an existing absolute path on the node, choose whether you trust
it for execution, and create a managed workspace from a branch or commit. Git provisioning
is a durable job: its state and phase remain visible after restarting. A coding session can
start only in a ready, unused managed workspace. Choose **Claude Code** or **Fake** and a
session title; an attached session can be reopened instead of starting another one. It uses the same
chat tabs, message renderer and composer, but never runs the plugin's agents or vault tools.
It accepts text only; local slash commands, attachments, history editing, branches and rewind
are not offered. Node file links open the workspace's retained file view, never a
coincidentally named vault file. Nested `abele-message` blocks in node replies remain plain code,
including their note links and embeds; they do not open vault-backed message cards.
Open **Projects and workspaces** from the node chat header's **…** menu. That menu also
holds reconnection, native-session resume information, and actions that explicitly explain
unsupported steering or interactive questions when chosen. The compact header shows the
session title, connection/run status, and an interrupt icon only while a turn is active.
Its read-only preview lists changed and untracked paths and shows the current unified diff
of tracked staged/unstaged changes against HEAD. Untracked contents are not included, and
the preview is not an immutable snapshot. Refresh it to review newer work.

The header's **Browse workspace files** opens a browser including dotfiles,
ignored and untracked files. Symbolic links are listed but never followed. File views use
numbered code with the same presentation as GitHub tabs; binary and oversized files show
metadata instead of text. The workspace dialog also offers browsing without attaching a session.

Choose **Edit file** to edit an existing small UTF-8 file in the same numbered code view.
Unsent text and its original version are stored only on this device, including across plugin
reloads. **Save file** checks that original version before applying the change. Saving accepts
at most 32,768 characters; larger local drafts remain stored but cannot be submitted. Binary
files, symbolic links and Git metadata stay read only. There is no file creation or Git mutation UI.

A **Conflict** keeps your draft separate from the changed workspace. **Reload current version**
loads current contents without replacing your draft. Inspect **Last loaded version**, then
choose **Use loaded version as base for this draft** only if you intend to apply the retained
draft against that version. **Discard local draft** forgets only known, local editor work; it
never restores or changes the workspace file. If the current file returns to the original
version after a conflict, the explicit base choice still lets you continue with your draft.
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

Claude assistant text renders as Markdown; tool rows show the name and a short argument
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
**×** beside a node-queued message cancels it. **Interrupt turn** in the header targets the
active run, not a later resumed run. Steering and interactive questions are explicitly not
supported yet. Ordinary follow-ups use the node's saved native session identity to resume
Claude; an interrupted/unknown input is never automatically rerun.

Claude permission cards show the tool and a short argument summary, with the original
command, arguments or edit diff expandable. **Approve** is the accent button, with **Deny**
beside it. An approaching expiry is shown as relative time; distant deadlines stay hidden.
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

## Offering tools by group

Open an agent on **Settings → Abele → AI Agent → Agents**, then its **Access** tab.
Under **Tools**, **Tool discovery** chooses between **All at once** (the default) and
**By group**. All at once gives the agent every enabled tool immediately. By group starts
with the usual core file, skill, template and reference tools, plus a short list of the groups
it can ask to reveal, such as Maps, Books or Canvas. Tools tied to a selected comment passage
also stay available immediately.

A group is listed only if at least one of its tools is enabled. Revealing it never turns on
an Off tool, and Ask tools still ask for approval. Revealed groups stay available for the rest
of the conversation, including after closing and reopening the chat. A new chat starts fresh.
The choice travels with the agent when you transfer settings. You can switch it back to
compare the two modes; neither mode changes your permissions.

## Saved keys in requests

When the agent substitutes a saved key into a request, it always asks first, including in
Auto mode and discussions in the margin. The confirmation names the keys and the destination;
**Allow this address for these keys** adds a recipient, then **Approve** sends the request.
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
Mermaid diagrams in replies still render, and internet images still load as before. Mermaid
output is cleaned before it joins the page. External links open only HTTP(S) or email addresses;
links to notes remain available.

Type your message and press **Shift+Enter** or **Cmd/Ctrl+Enter** to send it; **Enter** starts a
new line. The paperclip attaches files from the vault or from disk, pictures included, and other
agent chats; files can also be dropped or pasted onto the message box.

Attached pictures show a thumbnail before sending. Tap it, or a picture in a sent message,
to open Abele's preview. **Draw** opens the picture to draw on; **Send back to the chat** in
the drawing tab's menu replaces an unsent attachment with the edited picture, leaving your
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

Commands typed in the message box:

| Command         | What it does                                        |
| --------------- | --------------------------------------------------- |
| `/new`          | Start a new chat                                    |
| `/load`         | Open the chat history                               |
| `/compact`      | Replace older messages with a summary, to make room |
| `/scope`        | Choose which notes the chat may open                |
| `/prompt`       | Insert a saved prompt                               |
| `/<skill name>` | Run a skill                                         |

Chats working at the same time keep their access separate: each tool uses the scope and agent
of the chat that called it, not whichever tab is selected or started most recently.

Up to 20 chats can be open at once, as tabs. Every chat is saved as a file in the chat folder
(`AI/Chats` by default), so it survives a restart and can be found again in the history. When a
chat approaches 90% of the model's configured context window, older messages are summarized
automatically. This is checked before each model request, including between tool steps in one
long run. The latest tool calls, their results and any newly queued message stay intact so the
agent can continue, including after an earlier reply has been corrected. A reviewed correction
does not count as a new model reply that has read your latest message or tool results.
Results not yet included in reported usage are estimated; if the provider
returns no usage, the text of the context is estimated instead.

## Message actions and a new chat from here

Click or tap the icon beside a message to open its actions and details. The icon buttons
copy the message, edit your own message or retry an answer, insert it into a note, and
**Ask here** where discussions are available. Each has a tooltip and a keyboard focus target.
**More message actions** opens Obsidian's own menu, grouped by message, conversation and
file changes. Repeat, **Branch from here**, **Rewind** and **Undo changes** remain there.
Selection scripts, highlights, revision review and draft Send/Edit keep their existing places.

**Branch from here** continues inside the same chat. **New chat from here**, next to it in
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

**Navigation** (the list button beside the magnifier) opens a table of contents in a standard
Obsidian dialog, on desktop and phone. Your sent messages are the main rows, oldest first,
with day separators and times. Titles come from the beginning of your text; textless messages
show an image, file or attachment count. Drafts and queued messages are not listed.

Choose a question to close the dialog and jump to it. **Answers** and **Agent work** expand
only the contents list, never the chat feed. Each answer and tool call can be opened directly;
tool details open when needed. Work waiting for approval or rejected is marked **Needs attention**.
An answer before the first question remains reachable too.

A question's **Discussions** lists direct discussions attached to it or the answers and work
that followed it. Each shows its quoted passage and first question. Choose one to open its
existing comment chat. **Nested discussions** reads the next level only when expanded;
missing or unreadable discussions are labelled, not silently hidden. Reading the contents does
not migrate discussion files or repair their safety copies; only opening a discussion uses its
ordinary chat-loading path. The comment's existing
trail and **Back to place** in Navigation provide ways back.

**To start**, **To latest** and **Back to place** move within the conversation without sending
anything, rewinding files or changing the selected branch. Back returns to the reading place
saved before the navigation jump, including from a discussion; if that place is no longer
available, the dialog says so rather than switching branches. Typed text is kept.
Expanded contents rows and the list's scroll position are remembered while the conversation
stays open, not across a plugin reload.

The dialog's search finds snippets in the current branch's available display text, including
folded reasoning and tool details. Picking a result opens the existing find bar at that part.
It does not search other branches or nested discussions. On desktop, **Up/Down** moves through
rows, **Left/Right** folds and unfolds a focused heading, **Enter** chooses, and **Escape** closes.
On a phone, opening Navigation does not open the keyboard; tap its search field to type.
No model calls, new settings or chat-file changes are involved.

## Finding words in chats

**Cmd/Ctrl+F** inside a chat, the magnifier over it, or **Find in the current chat** from the
command palette opens a find bar: every match in the
conversation is marked, the counter says which one is shown, and **Enter** and **Shift+Enter**
(or the arrows) go to the next and the previous one. It finds words in the whole conversation —
the older messages not shown yet, the agent's reasoning and what its tools returned — and opens
whatever they are folded away in. **Esc** closes it.

The chat history lists the chats newest first, by when each was last written in, under a date
for each day; the list beside its search orders them by when each was started instead, and the
choice stays on that device. Renaming a chat, a summary written later, tool records and system
dividers do not move it. If no sent message has a date, its creation date stands in, never the
file's modification time.

To look through every chat, type into the search of the chat history (the clock over the chat),
or run **Search all chats** from the command palette. By default, it searches the title and the
description under it. Turn on **Content** beside the field to also find what you and the agent
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
the message's icon to see its highlights and their **Remove** buttons.

You can add, recolour and remove highlights on earlier replies while the agent is working.
The answer still being streamed becomes available for highlighting once it finishes.
Highlights stay with the chat when it is reopened or synced. They are visual annotations;
they do not alter what the model reads.

To ask for a revision, select the passage and choose **Ask here**. In that side discussion,
explicitly ask the agent to rewrite or clarify those words. Its proposal has a **Review reply
revision** button: you see the old passage and the proposed replacement before choosing
**Accept**, **Reject**, or **Later**. Nothing changes just because the agent proposes it, even
when tools are allowed to run automatically.

Accept changes that passage in the parent reply and marks it with the editing agent and time.
The parent agent reads the revised wording from then on. **View original** shows the original
reply; **Undo last revision** restores the previous version. The original and undo history travel
with the chat, unlike file rewind. Highlights stay with the old version and return on undo;
mark the revised version afresh.

If applying an accepted revision is interrupted, **Finish accepted revision** resumes it.
Your Accept is kept before the parent is changed; it cannot turn into Reject afterward. Once
applied, use the parent reply's undo to put it back.

Wait for both chats to finish working before accepting. If the parent changed elsewhere, reopen
it and ask for a fresh proposal. A selection crossing complex or partial markdown syntax may
not map safely; select a complete passage or words within one formatted span instead. To revise
an accepted replacement again, select its new words and start a new comment.

## Rewind

Everything an agent changes in your vault from a chat is remembered, so you can take it back.
Press the icon beside one of your messages, open **More message actions**, and pick:

- **Rewind** — shows every file the agent changed from that message on, each with what will
  happen to it: put back as it was, sent to the trash (a file the agent made), made again (one it
  deleted) or moved back. Tap a file to see the difference. Then choose **Files only**, **Files
  and conversation** — the chat goes back to that message too, with it in the box to send again,
  and the rest of the conversation kept as a branch — or **Conversation only**.
- **Undo changes** — takes back what that one message's turn changed and nothing else. Offered
  only where the turn changed something.

A file you changed yourself after the agent did is marked _changed since_ and left alone, unless
you choose to put it back anyway. The copies that make this possible are kept on this device
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
agent. When a change needs your approval, the chat shows exactly what would change, and you can
approve it, edit it or refuse with a reason.

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
a recorded tool and destination identity; **Always allow** never grants a replacement server or
changed destination permission.

## Skills and prompts

A **skill** is a note with `type: abele-skill` that teaches an agent how to do something. The
agent loads it when a task needs it. Set **Skills folder** on the AI **General** tab for skills
offered to all agents, or keep a skill inside the agent's scope. Each agent may use all of
those skills, none, or a chosen few. Other skill notes do not appear in its tool instructions;
loading one asks you first, even with automatic permissions. Choosing a skill yourself from
the picker or typing its slash command still works.

A **prompt** is a note with `type: abele-prompt`: text you insert into a chat with `/prompt`. Its
`{{ placeholders }}` become fields to fill in first.

## Memory

An agent can remember short facts you ask it to keep, and sees them in every later chat. Edit or
remove them in the agent's settings, under **Memory**. New agents ask before saving or changing
memory; choose **Auto** if you want automatic memory. Saved modes on existing agents stay as
set, because older settings did not distinguish defaults from choices. Check **Remember** in
the agent's **Access** tab if an older agent should ask too. The model sees remembered items
as its own notes for context, not as your standing instructions. Custom memory templates stay
as written; saved copies of the former default use the new wording.

## Interceptor

An agent can name another agent as its interceptor: a reviewer that reads each message you write
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
message, where you would otherwise be asked. If the script breaks or takes too long, your message
is sent as you wrote it and the reason is shown under it. Stop it from the chat and the message
waits as a draft.

With **Reply only** on, the script runs in parallel while your message goes straight to the main
agent unchanged. If the script returns a reply, it appears under your message; if it says nothing,
nothing appears. It cannot rewrite or hold the message, replace the main agent's answer, or
approve or refuse its actions in this mode. An attempted rewrite, hold or approval leaves a
small explanation under the message, as does a failure or timeout. Neither stops the main turn.

**Only messages matching** limits the interceptor to messages that match a regular expression,
such as `^/todo`. Everything else goes straight to the agent. Leave it empty for every message.

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
- **Attach to a chat** picks an existing chat and inserts a wikilink to the note in its input,
  without sending it or replacing its draft.
- **Attach a chat to note** puts an existing chat in the note's **Chats** list (see below).
- **Copy wikilink** copies a wikilink to the note, even when the vault uses Markdown links.
  This action also works with the AI switched off.

- **Ask here** asks about a passage and keeps the chat tied to it. See [Comments](comments).

If the agent cannot see the note, this one chat is given access to it.

## Chat artifacts

The **Artifacts** button (boxes) in a local chat’s header opens one view of its **Notes**,
**Images** and **Scripts**, with counts, paths and available dates. It updates while the chat
runs and includes saved messages from every retained branch, not unsent drafts or queued messages.

Notes and scripts are the chat’s current links, whether attached by hand or linked by a
successful write. **Open** opens the note or the script’s code view; it never runs or approves
code. **Reveal** shows the file in Obsidian’s explorer. **Unlink** removes only the chat’s link,
not the file. Old calls do not restore an unlinked card; a later successful write links it again.
Scripts remain listed when script execution is disabled.

Images include sent uploads and completed image-tool results: generated and edited pictures,
screenshots, downloads, viewed pictures and drawings, each labelled by origin. Tap a thumbnail
to preview it. Images have **Open** and **Reveal**, but no unlink or delete action. **Show in chat**
returns to a source message, switching branches and revealing earlier messages when necessary.
It is also offered for notes and scripts where saved results prove the source, and closes an
expanded message editor so the conversation is visible.

**Attach to current note** and **Attach to a note…** keep the existing attachment choices.
Only link changes need a saved chat in the history. Missing files remain visible as
**Unavailable**, with any source navigation and unlink action still available. Moved images
are not guessed from filenames. Absolute or parent-traversing paths are unavailable, not
rewritten to another file. Older chats work with the links and evidence they actually saved;
no missing links are reconstructed. Generated and edited pictures require a saved-file
confirmation from the tool; older results that saved only text cannot prove creation and are
not included, even if the text says an image was saved. Delegated sub-agent outputs are not aggregated into
this view. Switching to another chat closes the view.

## Chats under a note

A chat that changes a note is listed under that note, in the **Chats** list of its footer. You can
also put one there yourself: **Attach a chat to note** in the command palette or a note's
context menu, or the attachment controls in the chat’s **Artifacts** view. The unlink button on a chat's card
takes it away again. Scripts can have chats attached the same way.
