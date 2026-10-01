# AI chat and agents

Chats with AI models that can read and change your notes, inside limits you set.

## Setting it up

1. Turn on **Settings → Abele → AI Agent**.
2. On its **General** tab, add a provider: a name, the API's base address (any OpenAI-compatible
   API works), and the key. The key is kept in the device's keychain, not in the settings.
3. Add at least one model to the provider.
4. On the **Agents** tab, open the `Default` agent and give it that model.
5. Open the chat with **Show AI chat sidebar**, or the robot in the ribbon.

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
chat grows too long for the model, it is compacted by itself.

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

## Highlighting and revising replies

Select words in a finished model reply. On a computer, right-click and choose **Highlight in…**;
on a phone, lift your finger and wait for the selection bar, then tap a colour. The six colours
are the same as in books, using the note highlight styling. Tap a highlight to remove it, or
press the message's icon to see its highlights and their **Remove** buttons. Selecting the same
words again lets you change their colour. Highlights stay with the chat when it is reopened or
synced. They are visual annotations; they do not alter what the model reads.

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
Press the icon beside one of your messages and pick:

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
**Auto**; **Off** removes the tool. Script `ctx.agent()` runs allow both **Ask** and **Auto**
without confirmation, just like other enabled tools — you control access to the scripts.
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

## MCP servers

**Settings → Abele → AI Agent → MCP** connects MCP servers reached over HTTP; nothing is started on
your device, so they work on a phone too. Give each a name, its address, and a token or headers if
it needs them. **Fetch tools** reads its list of tools, and that saved list is what agents are
told until you fetch again.

A server's tools are off for every agent until you switch the server on in the agent's
**Access** tab or a chat's permissions. They then ask before each call, unless you set a tool to
automatic. Every tool description costs tokens in each request, so give a large server only to
the agents that need it.

## Skills and prompts

A **skill** is a note with `type: abele-skill` that teaches an agent how to do something. The
agent loads it when a task needs it. Each agent may use all skills, none, or a chosen few.

A **prompt** is a note with `type: abele-prompt`: text you insert into a chat with `/prompt`. Its
`{{ placeholders }}` become fields to fill in first.

## Memory

An agent can remember short facts you ask it to keep, and sees them in every later chat. Edit or
remove them in the agent's settings, under **Memory**.

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

## Chats under a note

A chat that changes a note is listed under that note, in the **Chats** list of its footer. You can
also put one there yourself: **Attach a chat to note** in the command palette or a note's
context menu, or the link button in the chat's header. The unlink button on a chat's card
takes it away again. Scripts can have chats attached the same way.
