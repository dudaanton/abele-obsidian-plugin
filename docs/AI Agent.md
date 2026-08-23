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
| API Key | Stored securely in Obsidian's keychain, never in plugin data |

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

### Search & Browse

| Tool | Description |
|------|-------------|
| `workspace` | List all files in the current scope |
| `web_search` | Search the web via Brave Search |
| `fetch` | Send HTTP requests to any URL |
| `read_image` | Load an image for visual analysis |

### AI Tools

| Tool | Description |
|------|-------------|
| `skill` | Load a skill's instructions (see [Skills](#skills)) |
| `delegate` | Hand a task to another agent (see [Delegation](#delegation)) |

All file operations respect the workspace scope — the agent can only access files you've allowed. File paths in tool call messages are clickable — click to open the file in the workspace.

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

Chats are saved as JSON files in your vault.

### Path Template

Configure in settings (default: `AI/Chats/{{name}}`):

| Variable | Description |
|----------|-------------|
| `{{name}}` | Chat title (sanitized for filenames) |
| `{{date}}` | Current date |

The `.json` extension is added automatically.

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
