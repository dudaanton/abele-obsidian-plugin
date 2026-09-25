# AI Agent

An AI assistant integrated into Obsidian that can read, create, edit, and search files in your vault, browse the web, and hand work to other agents — all within a chat interface.

## Getting Started

1. Enable the AI Agent in plugin settings
2. On the **General** tab, add a provider (any OpenAI-compatible API)
3. Set the API key (stored in Obsidian's secure keychain)
4. Add at least one model
5. On the **Agents** tab, open the `Default` agent and give it that model
6. Open the chat sidebar

## Agents

An agent is what a chat runs on: a model, a set of instructions, and what it is allowed to do.
Agents live on the **Agents** tab in settings, and every chat picks one from the dropdown in the
chat header.

### What an agent carries

| Field | Purpose |
|-------|---------|
| Model | The model this agent runs on |
| Fallback model | Offered as a retry when a request fails. Used automatically inside a delegated run, where nobody can press a button |
| Prompts | One or more blocks, each inline text or a vault note, joined in order |
| Permission mode | What it may do without asking |
| Scope | Where it works by default |
| Tools | Which feature tools it may use, and whether each asks first |
| Skills | All, none, or a chosen few |
| Delegation depth | How far it may hand work onward. `0` removes the delegate tool |
| Utility | Hidden from the chat picker. Still reachable from scripts, delegation and draft review |

### Editing an agent while a chat is open

Changes take effect immediately, with nothing reloaded. A chat holds the agent's *id*, not a copy
of its settings, so every open conversation resolves the agent afresh on each request.

### Per-chat overrides

Changing the model, scope, permissions or tools **inside a chat** overrides the agent for that chat
only. The chat then stops tracking the agent for that one setting, and says so — each of those
screens shows whether a value came from the agent or was overridden, with a reset back to the
agent. Switching agent mid-chat clears the overrides, since they were expressed against the
previous agent.

### Delegation

An agent with delegation depth above zero can hand work to another agent:

```
delegate(agent: "Researcher", task: "Summarise this", items?: ["a.md", "b.md"])
```

Without `items` this is one sub-agent. With `items` it fans out, one sub-agent per item, each with
a fresh context.

A delegated run keeps its whole conversation. In the chat it appears as a collapsed card on the
tool call — agent name, how many tasks, status — which expands into the sub-agent's messages, or
opens in its own read-only tab. Nested delegations expand the same way.

The sub-agent runs with **its own** instructions, tools and permission mode, and with the union of
its own scope and the delegating chat's — the agent knows where it normally works, and the chat
holds the files the task is actually about.

Run transcripts are stored beside your chats, in a `Runs` folder, and are deleted with the chat
that started them.

## Providers & Models

The agent works with any OpenAI-compatible API endpoint. You can configure multiple providers and switch between models mid-conversation.

### Adding a Provider

Each provider needs:

| Field | Description |
|-------|-------------|
| Name | Display name (e.g., "OpenRouter", "Local Ollama") |
| Base URL | API endpoint (e.g., `https://openrouter.ai/api/v1`) |
| API Key | Stored securely in Obsidian's keychain, never in plugin data in the clear. With [synced keys](Synced%20keys.md) on, it also travels to your other devices, encrypted |

### Adding Models

Two ways to add models:

- **Fetch Models** — queries the provider's `/models` endpoint, then pick from the list
- **Add Manually** — enter the model ID directly

Each model has configurable properties:

| Property | Description |
|----------|-------------|
| Display name | Label shown in the model selector |
| Context window | Maximum input tokens the model supports |
| Max output tokens | Maximum tokens in a single response |
| Reasoning | Enable for models that support extended thinking (e.g., DeepSeek-R1, QWQ) |

### Which model runs where

Chat models are chosen per agent, on the Agents tab. The **General** tab holds one model slot of
its own: the **auxiliary** model, used for the plugin's own background work — naming chats and
compacting long conversations. It has no tools, no scope and no prompt of its own, which is why it
is a plain model rather than an agent.

When the model changes mid-conversation — a per-chat override, a fallback retry — a divider line
appears in the chat showing the new model name. Switching agent leaves a divider too. Reasoning
content from previous messages is automatically stripped when sending to a non-reasoning model.

## Chat

### Commands

Type these in the chat input:

| Command | Action |
|---------|--------|
| `/new` | Start a new chat |
| `/load` | Open chat history |
| `/compact` | Manually compact conversation history |
| `/scope` | Open workspace scope manager |
| `/prompt` | Browse and apply a saved prompt |
| `/skill-name` | Invoke a skill by name (see [Skills](#skills)) |

### Chat about a note

Right-click a note — in the file explorer, on its tab, in its "more options" menu or in the
editor — and choose **Chat about this**, or run **Chat about current note** from the command
palette. A new chat opens on the default agent with a link to the note already in the input and
the cursor after it; nothing is sent until you have written your question. Any vault file can be
chosen this way, except a chat file.

If something is selected in that note, it comes along: the link then points at the selected
lines (`[[Note#L10-L12|Note]]`) and the passage is quoted under it, the same way **Use in AI
agent** quotes a selection. Only the note's own selection counts — the one in the editor you
right-clicked, or in the note in front — never one left in another note. In reading view the
selected text is quoted under a plain link to the note.

If the agent cannot see that note, this chat is given access to it — to that one file and
nothing else, the same as attaching it would. The access is saved with the chat, so it is still
there when the chat is reopened. The agent's own scope is not changed.

### Chats under a note

A chat that writes to a note — creates, edits, moves or copies it — shows up in the **Chats**
list at the bottom of that note, one card per chat. A chat can be put there by hand as well:

- **From the note** — right-click it and choose **Attach a chat…**, or run **Attach a chat to
  current note**, then pick a chat from your history.
- **From the chat** — the link button in the chat's header attaches it to the note in front, or
  to any note you pick; the number beside it is how many notes it is attached to.

A chat can sit under several notes, and a note can list several chats. A chat attached by hand
looks the same as one that wrote to the note; with nothing written, its card shows what the chat
is about instead of what it did. To take one away, use the unlink button on its card, or the
chat's link button. The chat itself is not touched, and if it writes to that note again it
comes back. Agents cannot attach chats themselves.

### Attachments

Click the paperclip icon to attach files:

- **From vault** — browse and select vault files
- **From disk** — system file picker (files are imported into the vault's attachment folder)

Supported formats: images (png, jpg, gif, webp, bmp, svg) and text files (md, txt, json, csv, yaml, js, ts, py, go, rs, and many more).

Images are sent as visual content. Text files are inlined into the message. Files over 100 KB are truncated.

### Continue

When the model stops (e.g., due to output length limit), press the play button to send "Continue" and resume generation.

### Context Compaction

When the conversation approaches the model's context window (90% usage), the agent automatically summarizes the history using the auxiliary model. You can also trigger this manually with `/compact`.

The summary preserves key decisions, file paths, code changes, and pending tasks. A divider appears in the chat marking where compaction occurred — click the icon to expand the summary.

### Sending Messages

Press **Shift+Enter** to send a message. **Enter** inserts a new line.

### Token Display

The input toolbar shows current token usage: `12.5k/128k` (used / context window).

## Tools

The agent has access to these tools:

### File Operations

| Tool | Description |
|------|-------------|
| `read` | Read file content |
| `ls` | List files in a folder |
| `find` | Search files by name, frontmatter, or content |
| `edit` | Replace a string in a file |
| `create` | Create a new file |
| `rm` | Delete a file (moves to trash) |
| `mv` | Move or rename a file |
| `cp` | Copy a file |
| `read_result` | Read on in, or search, a tool answer that was too long to send whole |

### Search & Browse

| Tool | Description |
|------|-------------|
| `workspace` | List all files in the current scope |
| `web_search` | Search the web via Brave Search |
| `fetch` | Send HTTP requests to any URL |
| `read_image` | Load an image for visual analysis |

### Maps

| Tool | Description |
|------|-------------|
| `geocode` | Address or place name to coordinates, and coordinates back to an address |
| `places` | Find places around a point by category or free text, sorted by distance |
| `route` | Distance, time and turn-by-turn directions between places, by car, bike or on foot |

These run on OpenStreetMap data through Photon, Overpass and the FOSSGIS routing servers — no API
key and no account, so they work on a fresh install. Each of them draws what it answered: the
chat shows a map under the tool call, and the same map can be written into a note as an
`abele-map` block. Coordinates come back as `lat, lon`, the form a note
property stores and a map layout reads.

### MCP servers

**Settings → AI Agent → MCP** connects [MCP](https://modelcontextprotocol.io) servers, and each
server's tools become tools an agent can be given. Only servers reached over HTTP are supported
(Streamable HTTP, both the 2026-07-28 revision and the session-based one before it); nothing is
ever started on the device, so the same servers work on a phone. The deprecated HTTP+SSE
transport of 2024-11-05 is not spoken.

| Field | Meaning |
|-------|---------|
| Name | What you call it. Its tools are named `mcp_<name>_<tool>`, so two servers need different names |
| URL | The server's MCP endpoint |
| On | Off keeps the server configured and hands its tools to nobody |
| Token | Sent as `Authorization: Bearer`, kept in the keychain like a provider key |
| Headers | Any other headers, one per line as `Name: value`; a secret is written `${abele_key:name}` |

**Fetch tools** connects and reads the server's list. That list is saved with the server and is
what agents are told from then on: a server that changes its tools or their descriptions changes
nothing until you fetch again and look at the new list.

A server's tools are off for every agent until you switch them on — in the agent's **Access** tab
(or a chat's permissions) each server is a group with a **Use this server** switch. Switching it
on puts every tool at *Ask*; set single tools to *Auto* or *Off* below it. Tool descriptions from
a server go to the model on every request, so a server with many tools costs tokens in every chat
of every agent it is given to.

What a server answers is handed to the model marked as outside content, to be read as data and
not as instructions. Pictures it returns are shown to the model; audio and files are named but
not passed on. **Stop** ends the wait at once; the plugin cannot close the connection, so the
server may still finish the call on its side.

Servers travel with the rest of the settings (Transfer), their tools list included; the token
travels only when keys are sent.

### AI Tools

| Tool | Description |
|------|-------------|
| `skill` | Load a skill's instructions (see [Skills](#skills)) |
| `delegate` | Hand a task to another agent (see [Delegation](#delegation)) |

All file operations respect the workspace scope — the agent can only access files you've allowed. File paths in tool call messages are clickable — click to open the file in the workspace.

### Long answers

Every tool answer stays in the conversation and is sent to the model again with each later
request, so one very long answer — every task in a large vault, a folder of thousands of notes —
would be paid for on every step after it. An answer over about six thousand tokens is therefore
kept whole in the chat file, and the model is sent its first part with a note saying how much is
missing and the key it is kept under; `read_result` pages through the rest or searches it,
including after the chat is reopened. The tool card shows the same shortened answer the model
saw. `read` does the same by lines: a file over about ten thousand tokens comes a window at a
time, and the windows add up to the whole file for the read-before-write rule.

Listings (`workspace`, `find`, `read_tasks`, `read_transactions`, `read_backlinks`) come grouped
by folder rather than as full paths, which on a real vault is 20–60% fewer tokens for the same
information. Scripts calling the same tools get the flat, whole answers they always did.

## Workspace Scope

The scope controls which files the agent can access. Open it with `/scope` or the folder icon in the input toolbar.

### Entry Types

| Type | Example | Description |
|------|---------|-------------|
| File | `Notes/todo.md` | Single file |
| Folder | `Projects/` | Folder and all its contents (recursive) |
| Pattern | `Journal/**/*.md` | Glob pattern (`*` matches within a folder, `**` matches across folders) |
| Group | `Team/Backend.md` | A note that references other notes via `groups` frontmatter — all referenced notes are included |

### Add Current File

In the scope manager, click "Add current" to quickly add the currently open file to the scope.

### Full Vault Access

Toggle "Full vault access" to give the agent unrestricted access to all files. When off, only explicitly added entries are accessible.

### File References

When you mention a file with `@filename.md` in a message, it's automatically added to the scope.

When a message links to a note with `[[Note]]` or `[text](Note.md)`, the agent is also told the
path each link leads to, for the notes it can reach — so a link by name alone is never mistaken
for another note with the same name.

## Permissions

### Permission Modes

Set globally in settings, adjustable per chat in the scope manager:

| Mode | Behavior |
|------|----------|
| Confirm all | Every write operation requires approval |
| Allow read + edit | `read`, `edit`, and `create` are auto-approved; `rm`, `mv`, `cp` require approval |
| Full freedom | All operations auto-approved |

Read-only tools (`read`, `ls`, `find`, `workspace`, `skill`) are always auto-approved regardless of mode.

### Per-Chat Permissions

These are toggled per chat in the scope manager and default to global settings for new chats:

| Permission | Default | Description |
|------------|---------|-------------|
| Web search | On | Allow `web_search` without approval |
| Fetch URL | Off | Allow `fetch` without approval |
| Delegate | Off | Allow `delegate` without approval |

When a permission is off, the agent asks for approval before each use. When on, the tool runs automatically.

### Tool Approval UI

When a tool needs approval, a panel appears showing:

- **Edit/Create** — file path and content diff
- **Delete** — file path
- **Move/Copy** — source and destination
- **Other tools** — parameters as key-value pairs

You can **Approve**, **Edit** (modify parameters as JSON), or **Reject** (with optional reason sent to the model).

## Prompts

### System Prompt

An agent's system prompt is built from its **prompt blocks**, edited on the Agents tab. Each block
is either inline text or the body of a vault note, and they are joined in order with a blank line
between them. A block that resolves to nothing — an empty box, a note that was moved — is dropped
rather than leaving a gap.

Use `{{date}}` in any block to insert the current date (YYYY-MM-DD), resolved fresh on each request.

The **General** tab keeps only the prompts used for background work: title generation and
compaction.

### Prompt Library

Save reusable prompts as vault notes:

```yaml
---
type: abele-prompt
description: Optional description shown in picker
---

Analyze the following code for potential issues:

{{code}}
```

Access via `/prompt` command. Variables in `{{ }}` syntax become input fields — fill them in before the prompt is inserted into the chat input.

Date variables (`{{ date }}`, `{{ date.format('YYYY-MM-DD') }}`, `{{ date.offset(7) }}`) are resolved automatically.

### Tool Descriptions

Each tool's description (sent to the model) can be customized in settings under "Tool Descriptions". This lets you fine-tune how the model understands and uses each tool.

## Skills

Skills are instructions that the model can load on demand. Unlike prompts (which are inserted into the input), skills are injected directly into the model's context.

### Creating a Skill

Create a vault note with this frontmatter:

```yaml
---
type: abele-skill
name: review
description: Code review with best practices checklist
---

When reviewing code, follow this checklist:
1. Check for security vulnerabilities
2. Verify error handling
3. Look for performance issues
...
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `abele-skill` |
| `name` | Yes | Identifier used for invocation (no spaces recommended) |
| `description` | No | Short description — this is what the model sees to decide when to use the skill |

### How Skills Work

**Progressive disclosure** — only skill names and descriptions are sent to the model with every request (~100 tokens per skill). The full skill body is loaded only when invoked.

**Two invocation paths:**

1. **Model-initiated** — the model reads the skill descriptions in the `skill` tool definition and decides to call `skill(name="review")` when relevant
2. **User-initiated** — type `/review` in the chat input to explicitly load the skill

When invoked with arguments (`/review check the auth module`), the skill is loaded into context and the arguments are sent as a user message, triggering an immediate response.

When invoked without arguments (`/review`), the skill is loaded and waits for your next message.

## Chat Storage

Chats are saved as `.abchat` files in your vault.

### File Format

An `.abchat` file is a log: one JSON record per line, appended as the conversation goes.

```
{"v":2,"k":"meta","type":"abele-chat","title":"...","activeLeafId":"..."}
{"k":"msg","id":"m1","role":"user","content":"..."}
{"k":"int","role":"assistant","toolCalls":[...]}
```

Reading a file replays it from the top: the last `meta` record wins, a `msg` record replaces
any earlier one with the same id, and `int` records — the model's own context — accumulate.

This is what makes a save cost what changed rather than what the conversation weighs. A turn
appends a few lines; the file is rewritten in full only when a chat is created, when it is
compacted (once the log holds twice as many records as live entities), or when a file written
by an older build is migrated. Measured in a running Obsidian, an append is about 2ms whatever
the size, against 5ms at 0.9MB and 27ms at 8.7MB for a full rewrite — and a long agentic chat
saves at least once per tool call.

It also means a write cut short by a crash costs the last line rather than the file, and that
the file can be read with `head`, searched with `grep`, and repaired by deleting a line.

### Format Versions

| Version | Written by | Shape |
|---------|-----------|-------|
| 1 | before this change | a single JSON object, rewritten in full on every save |
| 2 | current | the log described above |

Both are read. A version 1 file is recognised by its first line and converted to version 2 the
first time the chat is changed — opening one leaves it alone.

### Path Template

Configure in settings (default: `AI/Chats/{{name}}`):

| Variable | Description |
|----------|-------------|
| `{{name}}` | Chat title (sanitized for filenames) |
| `{{date}}` | Current date |

The `.abchat` extension is added automatically.

### What's Saved

- All visible messages (user, assistant, tool calls, system dividers)
- Internal model context (for seamless conversation recovery)
- System prompt at the time of saving
- Pending tool approvals (restored when loading the chat)
- Per-chat permission settings

### Migration

If you change the path template, use the "Migrate" button in settings to move existing chat files to match the new pattern.

## Settings Reference

Settings are split in two: **General** for infrastructure — providers, keys, storage, background
model — and **Agents** for everything that shapes how an agent behaves.

### Background Model (General)

| Setting | Default | Description |
|---------|---------|-------------|
| Auxiliary Model | First available | Model for chat titles and compaction |
| Sequential Auxiliary | Off | If on, title generation and compaction block the chat. Enable for local models with limited throughput |

Chat models are set per agent, on the Agents tab.

### Chat Storage

| Setting | Default | Description |
|---------|---------|-------------|
| Chat path template | `AI/Chats/{{name}}` | Where chat files are saved |

### Integrations

| Setting | Default | Description |
|---------|---------|-------------|
| Brave Search API Key | — | Required for `web_search` tool. Get one at [brave.com/search/api](https://brave.com/search/api/) |

### Permissions and scope

Set per agent, on the Agents tab. A chat inherits them and can override them for itself.

### Background Prompts (General)

| Setting | Default | Description |
|---------|---------|-------------|
| Title Generation Prompt | Built-in | Template with `{{messages}}` for generating chat titles |
| Title System Prompt | Built-in | System prompt for the title model |
| Compact Prompt | Built-in | Template with `{{messages}}` for summarizing conversations |
| Tool Descriptions | Built-in | What each tool tells the model about itself, shared by every agent |

An agent's own instructions are its prompt blocks, on the Agents tab.
| Tool Descriptions | Built-in | Per-tool descriptions sent to the model (expandable section) |
