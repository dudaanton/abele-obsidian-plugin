# Agent reference

`src/docs/` is the plugin's own documentation, written for **agents at runtime**, not for
people. It answers the questions an agent working inside somebody's vault has to get right:
what `type: task` means, which property holds a deadline, which tool to reach for, what scope
refuses and why. The notes in this folder are the ones for people; those two sets do not
overlap and should not be merged.

It is served by the `query_docs` tool, a level at a time — the sections, then a section's
topics, then one topic's prose — so an agent pays for the answer it needs rather than for the
whole reference. `query_docs` is a core tool: it is always available, because a reference
behind a switch goes unread.

## How it is written

One markdown file per section in `src/docs/`, registered in `src/docs/index.ts`. The shape is
the whole parser:

- `# Title` on the first line.
- The paragraph after it is the section's summary — it appears in the table of contents, so it
  should say what is in the section, in one or two sentences.
- Each `## Heading` starts a topic. Its id is the slugified heading, and that id is what an
  agent asks for, so headings are renamed with the same care as a function.

Write for an agent: state the convention, name the exact property or tool, and say what not to
do. Leave out the history, the reasoning and the screenshots — those belong here, in the notes
for people.

## Keeping it true

- **A new agent tool must be named in `src/docs/tools.md`.** `tests/unit/queryDocs.test.ts`
  fails otherwise: it walks the tool registry and looks each name up in the reference.
- **A change to what the plugin stores changes `src/docs/vault.md`.** A property renamed in a
  template and not here leaves agents writing notes the plugin cannot read. Nothing can test
  this for you.
- **A new feature that an agent can see gets a topic, or a sentence in an existing one.** If it
  is only visible to a person, it belongs in the `commands` section as something to tell them
  to do, not as something to do.
- The tests also hold the shape: every section needs a summary and at least two topics, and
  topic ids must be unique within their section.
