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

## Permissions

`confirm-all` asks before every action. `allow-edit` lets file edits through and asks about the
rest. `allow-all` asks about nothing. Each tool can additionally be set to `off`, `ask` or
`auto`, which is how a person switches off, say, web access for one agent.

Being refused is not a failure to work around. Say what was refused and why; do not look for
another tool that does the same thing unwatched.

## Scope

Scope is the part of the vault an agent can read and write. It is built from entries of four
kinds: a **file**, a **folder**, a **pattern**, or a **group**.

A group entry is the powerful one: it grants everything linked to that group through `groups`,
and everything under those, at any depth. In a flat vault this is how a person grants "this
project and all its notes" without a folder for it.

`fullVaultAccess` turns the scope off entirely. If a path is outside the scope, the tools will
refuse it — that is the plugin working, not a bug to report.

## Skills

Skills are notes with `type: abele-skill` describing how to do something. An agent can be
allowed all of them, none, or a chosen few. Load one with the `skill` tool when the task
matches its name; do not paste a skill's text into a prompt by hand.

## Delegation

An agent can hand a self-contained piece of work to another agent with the `delegate` tool. The
sub-run has its own agent, its own scope and its own conversation; only its result comes back.
`maxDelegateDepth` limits how deep this can nest, and 0 forbids it.

Delegate when the work is genuinely separate — a long search, a second opinion, a job needing
different permissions. Do not delegate what is one tool call away.

## Chats

Chats live in the vault as `.abchat` files, so they survive a restart and can be searched. A
long chat can be compacted: the older turns are replaced by a summary and the conversation
carries on. Compaction uses the background model.

A chat can also be a **comment chat**: one anchored to a passage in a note and answered on the
margin beside it. It starts on the agent named by `commentAgentId` and the person can point it
at another from the card's own header, so each comment runs on the agent it was given. It is
scoped to the note it is anchored in on top of that agent's own scope, and is told at the start of every turn where it
is — the note, the quoted passage, the paragraph around it. Its file lives in the comments
folder rather than the chat folder. Opening one as a full chat keeps the anchor and the file
where it is, moves it into the chat history and the sidebar, and takes `edit_selection` away,
because from then on it is an ordinary chat. That is reversible: an expanded comment can be
sent back to its note, which closes the sidebar tab, drops it from the chat history and makes
it a comment again — the same conversation, back on the margin.
