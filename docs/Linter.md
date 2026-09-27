# Linter

Notes checked against rules, the findings listed in a tab of their own, and fixes applied where a
rule has one. The code is `plugin/src/linter/`; the tab is `components/linter/LinterPanel.vue`,
the settings `components/settings/LinterSettings.vue` and `LintRuleModal.vue`.

## Shape

- **A rule is two pure functions over text** (`types.ts`). `check(note, params)` returns findings
  — a message, a line counted from 1 over the whole file, whether the fix covers it. `fix(note,
  params)` returns the note's whole new text, or `null`. The `LintNote` a rule sees is read once
  by `note.ts`: lines, the properties parsed with js-yaml's core schema (dates stay strings, a key
  written twice is an error, as Obsidian treats it), where the block ends and the body starts.
- **Built-in rules** are `rules.ts`. Frontmatter edits go through `withProperty` /
  `withoutProperty`, which change the lines of one property and leave the rest of the block as it
  was — `processFrontMatter` would rewrite the whole block in Obsidian's style.
- **Settings** (`settings.ts`) keep an entry per rule only once it is touched; `ruleSetting` fills
  the rest from the rule. They travel as the `linter` block in `transfer/entries.ts`.
- **Scope** (`scope.ts`) decides from the path and the metadata cache whether a rule looks at a
  note, so a note no rule applies to is never read.
- **The engine** (`engine.ts`) reads notes forty at a time, yielding between batches, and stops on
  an `AbortSignal`. A rule that throws is recorded once in `ruleErrors` and skipped for the rest of
  the run. A fix is computed on the text as read and written through `vault.process` only if the
  note still holds that text; otherwise the outcome is `changed-underneath` and nothing is
  written.
- **`LinterService`** holds the one report the tab shows (a `shallowRef`, replaced per batch),
  runs, cancels, fixes and re-lints a fixed note in place.

## Script rules

A script with `// @lint` (or `// @lint warning`) is parsed into `meta.lint`. It is not registered
as a command nor offered as a `script_<name>` tool. `ScriptService.definition(path)` runs its body
once — with the normal script context, but outside the list of runs — and returns what the body
returns, or `{ check, fix }` picked up from functions of those names the body declared.
`scriptRules.ts` wraps that into a `LintRule` with id `script:<name>`; the note handed to the
script is a copy.

## The agent

`lint` (auto) and `lint_fix` (asks) in `ai/tools/LintTools.ts`, bounded by the chat's scope.
`LINT_TOOL_MODES` gives them to new agents, and `enableLintTools` in the agent migration to agents
saved before them.

## Tests

`tests/unit/linterNote.test.ts`, `linterRules.test.ts` (every rule and fix),
`tests/integration/linterEngine.test.ts` (scope, batches, cancel, fixes against a changed note),
`linterScriptsAndTools.test.ts` (a real script through the script index, the agent tools),
`tests/component/linterPanel.test.ts`, and `tests/e2e/linter.e2e.test.ts` in the running app,
phone layout included.
