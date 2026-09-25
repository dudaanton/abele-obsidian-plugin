# AI chat and agents

Chats with AI models that can read and change your notes, inside limits you set.

## Setting it up

1. Turn on **Settings → Abele → AI Agent**.
2. On its **General** tab, add a provider: a name, the API's base address (any OpenAI-compatible
   API works), and the key. The key is kept in the device's keychain, not in the settings.
3. Add at least one model to the provider.
4. On the **Agents** tab, open the `Default` agent and give it that model.
5. Open the chat with **Show AI chat sidebar**, or the robot in the ribbon.

## Chatting

Type your message and press **Shift+Enter** or **Cmd/Ctrl+Enter** to send it; **Enter** starts a
new line. The paperclip attaches files from the vault or from disk, pictures included, and other
agent chats; files can also be dropped or pasted onto the message box.

Commands typed in the message box:

| Command | What it does |
|---|---|
| `/new` | Start a new chat |
| `/load` | Open the chat history |
| `/compact` | Replace older messages with a summary, to make room |
| `/scope` | Choose which notes the chat may open |
| `/prompt` | Insert a saved prompt |
| `/<skill name>` | Run a skill |

Up to 20 chats can be open at once, as tabs. Every chat is saved as a file in the chat folder
(`AI/Chats` by default), so it survives a restart and can be found again in the history. When a
chat grows too long for the model, it is compacted by itself.

The chat's settings button opens one dialog with everything about this chat: its scope, skills,
prompts, permissions, model and tools.

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
change it, or talk it over first.

## Delegation

An agent with a delegation depth above zero can hand a task to another agent, or the same task to
one agent per item of a list. Each run keeps its whole conversation, which you can open from the
chat.

## Voice

The microphone in the message box records you and types what you said. **Dictate into the note**
does the same in a note, at the cursor. The speech model and its key are set on the
**General** tab.

## Asking about a note

- **Chat about current note**, or **Chat about this** in a note's right-click menu, starts a chat
  with a link to the note already typed. With text selected, the link points at those lines and
  the text is quoted.
- **Use in AI agent** on a file, a folder or selected text adds it to the chat in front.
- **Ask here** asks about a passage and keeps the chat tied to it. See [Comments](comments).

If the agent cannot see the note, this one chat is given access to it.

## Chats under a note

A chat that changes a note is listed under that note, in the **Chats** list of its footer. You can
also put one there yourself: **Attach a chat to current note**, **Attach a chat…** in a note's
right-click menu, or the link button in the chat's header. The unlink button on a chat's card
takes it away again.
