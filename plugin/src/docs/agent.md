# The agent

How an agent in this plugin is configured, and what limits it is working inside. Worth reading
when a person asks why something was refused, or why a chat behaves differently from another.

## Agents

An agent is a named configuration: which model it talks to, what its system prompt is, which
tools it may use, what part of the vault it can see, and how far it may delegate. Chats pick an
agent; a chat can override the agent's model and permissions for itself without changing the
agent.

A **utility agent** is hidden from the chat picker. It exists to be called by scripts,
delegation or interceptors rather than talked to directly.

## Models

Three model choices per agent:

- **Model** — what it talks with.
- **Fallback model** — offered as a retry when a request fails, and used automatically in a
  delegated run where nobody is there to press a button.
- **Background model** — for the plugin's own work on that agent's chats: naming them and
  compacting them. Unset, the plugin-wide Background Model setting decides; unset there too,
  the chat's own model does it.

When a request fails on something transient — 429, a 5xx, a dropped connection — the chat can
retry on its own with a growing delay, if that is switched on. A rejected key or a malformed
request is not retried.

## Interceptor

An agent can name another agent as its **interceptor**: a reviewer that reads each message the
person writes in that agent's chats before it is sent, and answers it in a side conversation.
The person then sends the draft on, edits it, or talks it over with the reviewer first. Any agent
can be one, utility agents included, except the agent itself. **Interceptor context** says how
much of the conversation the reviewer sees: the message only, the last few preceding messages,
or all preceding messages. During a holding review, Send/Edit are hidden but the chat's Stop
control cancels the reviewer and restores those actions without discarding the draft.

**Reply only** (`interceptorReplyOnly: true`) runs an agent or script review alongside the main turn:
the message is sent immediately, with no draft or Send/Edit actions. The reviewer's answer stays
in that message's side conversation, even if later turns finish first, and is never sent to the
main agent. It neither delays the main turn nor is cancelled when that turn finishes. False or
absent means the existing hold-for-review behaviour. The switch is available in the agent's
Basic settings and the chat's interceptor override, for both agents and scripts.

The interceptor can also be a **script** whose header says `// @interceptor`. It is shown the
message and the chat around it — the conversation so far, what was attached, the note open in
the editor, the agent's settings — and what it returns decides: send the message as written,
send a rewritten one, answer it itself without asking the agent, or hold it back as a draft for
the person. Beside a send it can answer for the person on the tool calls of the turn that
message starts — approve or refuse them where the person would have been asked. Such approval
reaches the actual tool, including a foreign skill and calls behind a manually approved queue
head; it applies only to that turn's decided calls, not other skills or later turns. A script that
fails, runs out of time or waits to be confirmed on this device never stops the message: it is
sent as written, and the reason is shown under it. The script API reference (`script_api_docs`)
has the whole contract under `message` and `chat`.

With **Reply only**, the script receives the same read-only inputs, but the message and its
attachments go to the main agent immediately and unchanged. Returning `{ reply: 'text' }` adds
only a side reply under that person's message; it does not replace the main agent's answer.
Returning nothing adds nothing. Rewrites (including a bare string), holds and tool-approval
answers have no effect and leave an explanatory note under the message. Failures and timeouts
also leave their reason there without affecting the main turn. Replies and notes are saved
with the message, even when scripts finish out of order.

**Only messages matching** narrows either kind to messages matching a regular expression, written
bare (`^/todo`) or as `/pattern/flags`; the rest go straight to the agent. Empty means every
message. A pattern that does not compile is refused when set and, if one arrives anyway, lets
every message through to the interceptor.

A chat follows its agent's interceptor until the person picks another one or Off in the chat's
settings; that choice is the chat's own, and switching the chat to a different agent keeps it.
A chat that never chose follows whichever agent it is on now. Interceptors never chain: the
reviewer answers as one plain reply, so the reviewer's own interceptor is never asked. Delegated
runs and scripts never use one — nobody is there to read the review. A message typed while the
agent is working waits for its own turn when a blocking script or a hold-for-review agent
interceptor would take it, rather than joining the running one past it. Reply-only review lets queued
messages join the running turn as usual, reviewing each independently.

The settings on the agent are `interceptorAgentId` (an agent id, or empty for none),
`interceptorContextDepth` (0 the draft, -1 everything, N the last N messages; an agent reviewer
only), `interceptorReplyOnly` (boolean, false by default; agents and scripts),
`interceptorScript` (a script's `@name`, or empty; set, it wins over the agent) and
`interceptorPattern` (the regular expression, or empty).

## Permissions

`confirm-all` asks before every action. `allow-edit` lets file edits through and asks about the
rest. `allow-all` asks about nothing. Each tool can additionally be set to `off`, `ask` or
`auto`, which is how a person switches off, say, web access for one agent.

Each tool call carries its own chat's scope and agent, even while other chats run tools at the
same time. Switching tabs or another chat finishing cannot change that access.

Being refused is not a failure to work around. Say what was refused and why; do not look for
another tool that does the same thing unwatched.

## Scope

Scope is the part of the vault an agent can read and write. It is built from entries of four
kinds: a **file**, a **folder**, a **pattern**, or a **group**.

A group entry is the powerful one: it grants everything linked to that group through `groups`,
and everything under those, at any depth. In a flat vault this is how a person grants "this
project and all its notes" without a folder for it. Membership follows the link destination
Obsidian resolves from the note containing `groups`: a short or partial link works even with
namesakes elsewhere when it resolves to this group. A link resolved elsewhere or nowhere grants
no membership in this group. Only links in `groups` count, not body mentions or other properties.
The same rule applies to the scope editor's group preview.

`fullVaultAccess` turns the scope off entirely. If a path is outside the scope, the tools will
refuse it — that is the plugin working, not a bug to report.

A chat can reach one file more than its agent: the person attaches it, or starts the chat with
**Chat about this** on a note the agent cannot see. That note is added to this chat's scope as a
file entry and saved with the chat; the agent's own scope is not changed.

A message that links to notes arrives with a line at its end saying which path each link
resolves to (`"Budget" is Projects/Budget.md`), for the notes the chat can reach. The person did
not type that line and does not see it; use the path, not the name, with the tools.

Chat files (`.abchat`) are never in a scope, whatever the entries say: a chat file holds every
note its own agent read and everything its tools returned. With the whole vault open, `read` on
one gives only what was said in it, the same as an attached chat.

## Image attachments

An attached picture arrives as both model image input and a text label `[Image: <vault path>]`.
Use that exact path, relative to the vault root, with image tools; do not invent a temporary
path or treat the image input as the only copy. The picture is a real vault file and is added
to this chat's scope. `read_image` shows it again; `edit_image` takes its path in `source` and
saves a new image. The result appears as a clickable preview under the tool call. To include
an existing image in your reply, use `![[Attachments/sample-image.png]]` with its actual path.
Text `read`/`write`/`edit` tools are not binary image editors. Pending imports belong to the
conversation that started them, not its tab: loading or resetting the conversation cancels
its pending attachments. Drawing returns and draft edits preserve unrelated imports. Send
waits until the current draft's imports finish, including after viewing a delegated run,
receiving new composer text, or closing and reopening the whole chat panel. Draft text,
attachments and pending imports belong to the conversation session, not either UI component.

HEIC/HEIF imports become PNG only when the platform decodes them natively (iPhone/iPad).
Then only the PNG is attached and sent to the model; refer to its labeled path. External
converted imports keep only PNG; an existing vault HEIC stays beside its PNG copy. On a
platform without native decoding, such as desktop, HEIC stays an ordinary binary file, with
a `[File attachment: <path> (HEIC/HEIF; not converted)]` label and no model image input.
Do not claim to see its pixels or use text tools to edit its bytes; conversion is available
on iPhone/iPad. Its original file is never deleted. Pending pictures open in the plugin's preview; Draw opens a drawing tab, whose
**Send back to the chat** replaces the pending original with the saved drawing, keeping the
rest of the draft. Drawing from a sent message attaches a new picture instead.

## Skills

Skills are notes with `type: abele-skill` describing how to do something. Offered skills come
from `ai.skillsFolder` or this chat's scope, narrowed by the agent's all/none/selected choice.
Other skill notes do not inject descriptions into the tool list. Loading one not offered asks
for approval of that call, even under allow-all; unattended runs cannot approve it. Load a
skill with the `skill` tool when the task matches; do not paste its text into a prompt by hand.

## Delegation

An agent can hand a self-contained piece of work to another agent with the `delegate` tool. The
sub-run has its own agent and conversation, but never more access than its parent: its scope
is the intersection (an empty target scope inherits), permissions and tool modes take the
stricter value captured at the start of the branch, and GitHub connection rights and skill
selection are bounded too. Changing the executor's settings while a branch runs does not
raise that branch's captured permission mode. Scope snapshots keep the granted entries fixed,
but refresh their file inventory: a file the branch creates inside an allowed folder remains
readable and editable; creating a file outside the parent grants no extra read access. Only its
result comes back. `maxDelegateDepth` counts from the root; the narrowest chain limit wins,
and 0 forbids delegation. Hard limits are 3 levels, 20 items per call and 50 branch runs per
root conversation while it is open, shared across concurrent and nested calls.

Delegate when the work is genuinely separate — a long search, a second opinion, a job needing
different expertise within the same access. Do not delegate what is one tool call away.

## Chats

Chats live in the vault as `.abchat` files, so they survive a restart and can be searched. A
long chat can be compacted: the older turns are replaced by a summary and the conversation
carries on. Compaction uses the background model.

The person can attach another agent chat to a message, the way a note or an image is attached.
What arrives is the conversation only: what the person and that chat's agent wrote to each
other, under a line naming the chat. Its tool calls, what they returned and its reasoning are
left out, so a note the other agent read is not shown to this one. What that agent quoted in
its own replies is part of what it wrote, and does come through.

A chat can also be a **comment chat**: one anchored to a passage in a note. It starts on the
agent named by `commentAgentId` and the person can point it at another from the chat's own
header, so each comment runs on the agent it was given. It is scoped to the note it is anchored
in on top of that agent's own scope, and is told at the start of every turn where it is — the
note, the quoted passage, the paragraph around it. Its file lives in the comments folder rather
than the chat folder.

A comment is read where every chat is read: as a tab in the AI sidebar, opened by pressing the
marker's icon in the note. One at a time — a second marker pressed replaces the tab rather than
adding one. Everything an ordinary chat can do it can do, and one thing more: what the person
types can be *kept as a note* instead of sent, so not every user turn in a comment was a
question. Opening one as a full chat keeps the anchor and the file where they are, moves it
into the chat history and takes `edit_selection` away, because from then on it is an ordinary
chat: the marker stays in the note and leads to it.

A comment can also be asked about a message inside a chat — an agent's answer or the person's
own message: the person selects words in it and picks **Ask here**, or picks it with nothing
selected to ask about the whole message. It opens the same way, as a tab, but it runs on the
**chat's own agent** with that agent's scope, not on `commentAgentId`. It is told the chat's
title, the selected words, the message they are in and what was said before it in that chat —
only what the person and the agent wrote, like an attached chat, never tool calls, their
results or reasoning. The chat file itself is not in its scope and it has no `edit_selection`:
a message in a chat is not something to rewrite.

The same works inside a comment: a message in one can be asked about in turn, and so on to any
depth. The new comment runs on the agent of the comment it came from and is told that comment's
messages the same way. The levels above that are named, not carried: the words each one was asked
about and where — so the chain costs a line per level, however deep it goes.

Writing to a note links this chat to it: the note shows a card for every chat that changed it,
so what you do here is visible from there afterwards. Reading a note links nothing.

## Rewind

Everything a chat's tools change in the vault is remembered, so the person can take it back —
there is no tool for it, and nothing an agent has to do. While any of the chat's tool calls runs,
every change to a file is recorded under the user message whose turn it was: notes written,
edited, created, deleted, renamed or moved, frontmatter changed, folders made or removed, and
what other tools write on the way — highlights and bookmarks from the book tools, files a script
run by the agent writes, tasks and transactions created, pictures and downloads, and the links
Obsidian rewrites in other notes after a rename. A delegated run's changes are recorded in the
chat that delegated it. Not recorded: the plugin's own settings, the trash and chat files.

From a user message the person can **rewind**: every change made since that message, by any
turn, is put back — files the agent made go to the trash, deleted ones come back, moved ones
move back — and, if they choose, the conversation goes back to that message as well, with the
message in the box to send again. **Undo changes** takes back one turn's changes alone. A file
somebody changed after the agent last did is shown as such and left alone unless the person says
to overwrite it. What the person types into a note *while* a tool is running cannot be told from
the agent's change and is recorded with it.

The copies live on this device only — see *Chats* in the vault section — so a chat opened on
another device can be read but not rewound there.
