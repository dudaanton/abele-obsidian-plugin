# AI Agent

An AI assistant integrated into Obsidian that can read, create, edit, and search files in your vault, browse the web, and consult other models — all within a chat interface.

## Getting Started

1. Enable the AI Agent in plugin settings
2. Add a provider (any OpenAI-compatible API)
3. Set the API key (stored in Obsidian's secure keychain)
4. Add at least one model
5. Select it as the primary model
6. Open the chat sidebar

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

### Model Roles

| Role | Purpose |
|------|---------|
| Primary | Main model used for chat |
| Auxiliary | Used for title generation and conversation compaction. Falls back to primary if not set |
| Wise | A powerful model the agent can consult via the `wise_model` tool. Must be explicitly configured |

When you switch the primary model mid-conversation, a divider line appears in the chat showing the new model name. Reasoning content from previous messages is automatically stripped when sending to a non-reasoning model.

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

### Token Display

The header shows current token usage: `12.5k/128k` (used / context window).

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
| `wise_model` | Consult a more powerful model (see [Wise Model](#wise-model)) |

All file operations respect the workspace scope — the agent can only access files you've allowed.

## Workspace Scope

The scope controls which files the agent can access. Open it with `/scope` or the folder icon in the header.

### Entry Types

| Type | Example | Description |
|------|---------|-------------|
| File | `Notes/todo.md` | Single file |
| Folder | `Projects/` | Folder and all its contents (recursive) |
| Pattern | `Journal/**/*.md` | Glob pattern (`*` matches within a folder, `**` matches across folders) |
| Group | `Team/Backend.md` | A note that references other notes via `groups` frontmatter — all referenced notes are included |

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
| Wise model | Off | Allow `wise_model` without approval |

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

The base system prompt tells the model about the Obsidian environment and available tools. You can customize it in settings:

- **System Prompt (base)** — replace the default entirely
- **Custom Instructions** — appended to the base prompt

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

## Wise Model

The wise model lets a smaller, cheaper model consult a more powerful one for complex tasks — code review, architectural decisions, nuanced analysis.

### Setup

1. Add the powerful model to a provider (e.g., Claude Opus, GPT-4o)
2. Select it as "Wise Model" in settings
3. Optionally enable "Allow wise model" in default permissions to skip approval

### How It Works

The agent calls `wise_model(prompt="...", system_prompt="...")` when it needs deeper analysis. The request streams to the configured wise model and returns the response as a tool result.

During execution, a spinner appears on the tool call message. You can cancel the request using the stop button.

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

### Active Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Primary Model | — | Main model for chat |
| Auxiliary Model | Same as primary | Model for title generation and compaction |
| Wise Model | Not configured | Model for the `wise_model` tool |
| Sequential Auxiliary | Off | If on, title generation and compaction block the chat. Enable for local models with limited throughput |

### Chat Storage

| Setting | Default | Description |
|---------|---------|-------------|
| Chat path template | `AI/Chats/{{name}}` | Where chat files are saved |

### Integrations

| Setting | Default | Description |
|---------|---------|-------------|
| Brave Search API Key | — | Required for `web_search` tool. Get one at [brave.com/search/api](https://brave.com/search/api/) |

### Default Permissions

| Setting | Default | Description |
|---------|---------|-------------|
| Allow web search | On | Default for new chats |
| Allow fetch | Off | Default for new chats |
| Allow wise model | Off | Default for new chats |

### Prompts

| Setting | Default | Description |
|---------|---------|-------------|
| System Prompt (base) | Built-in | The base system message sent to the model |
| Custom Instructions | Empty | Additional instructions appended to the base |
| Title Generation Prompt | Built-in | Template with `{{messages}}` for generating chat titles |
| Title System Prompt | Built-in | System prompt for the title model |
| Compact Prompt | Built-in | Template with `{{messages}}` for summarizing conversations |
| Tool Descriptions | Built-in | Per-tool descriptions sent to the model (expandable section) |
