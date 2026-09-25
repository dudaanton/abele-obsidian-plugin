# Repository guard

The repository is public. `plugin/scripts/repo-guard.mjs` keeps out what should never be
published: output that tools leave lying around, build results, big files, credentials, and
paths that name a real person's home folder. It has no dependencies and finishes in well
under a second on a commit.

| Where | Command | What it reads |
|---|---|---|
| pre-commit hook | `node scripts/repo-guard.mjs --staged` | what the commit is about to record |
| CI (`test.yml`) | `--all`, then `--range <base>..HEAD` | the tree, then every new commit on its own |
| by hand, from `plugin/` | `npm run guard` / `npm run guard:staged` | the tree / the staged changes |

Range mode reads each commit separately rather than the combined diff: a key added in one
commit and deleted in the next is still in the published history.

It exits 1 when anything is refused. Warnings are printed and never fail.

## What it refuses

**Paths** — anything a commit adds or changes:

- *Junk*, anywhere in the tree: tool and test output (`.playwright-mcp/`, `test-results/`,
  `playwright-report/`, `coverage/`), `node_modules/`, `build/` and `dist/`, caches and
  `tmp/`, editor folders, vault folders (`.obsidian/`, `.trash/`), local agent folders
  (`.claude/`, `.orca/`, `.superpowers/`, `.llm/`, `CLAUDE.md`), `.DS_Store`, `data.json`,
  `.env` files (not `*.example`), keys and certificates, logs and runtime dumps, `.abchat`
  chat logs, databases, archives, source maps, editor and merge leftovers.
- *Pictures and videos* outside `assets/`, `docs/` and `plugin/tests/fixtures/`.
- *New entries* in the repository root, `plugin/`, `.github/` and `.githooks/`. Each of those
  holds a fixed list, so a stray file beside them is caught even when its name looks harmless.
- *Files over 1 MB*.

**Contents** — every added line (every line of every text file with `--all`):

- Credentials: GitHub tokens, Anthropic, OpenRouter and OpenAI-style keys, AWS access keys,
  Google API keys, Slack, Stripe, npm and Hugging Face tokens, private key blocks, JWTs,
  passwords inside URLs, `Bearer` tokens, and `password`/`token`/`apiKey`-style assignments
  with a long random-looking literal. The generic rules ignore values that read as words or
  placeholders (`your-token-here`, `${token}`), which keeps ordinary code quiet.
- Real home folders: `/Users/<name>/`, `/home/<name>/`, `C:\Users\<name>\`. Example names —
  `username`, `user`, `you`, `runner` and a few more — pass.
- A warning, not an error, for a `~/…` path in `docs/` or a top-level Markdown file: docs use
  made-up example paths, never a real vault.

A match is never printed whole. The report shows its first few characters and its length —
enough to find it, not enough to use it.

## Allowing something on purpose

- **A path** — add a glob to `plugin/scripts/repo-guard.json`: `allow.junk`, `allow.images`
  or `allow.large` (`**` crosses folders, `*` does not). A new top-level file or folder goes
  into the matching list under `layout`. The error names the list to edit.
- **A line** — put `repo-guard: allow` in a comment on the same line. For made-up values in
  tests, where the value has to look real. Better still, build the value from pieces at run
  time, the way `tests/unit/repoGuard.test.ts` does, so it never sits in the file whole.
- **A real home path** that a file genuinely needs — add the file to `allow.homePaths`.

Each of these is visible in review. `git commit --no-verify` skips the hook, but CI runs the
same check.

## Private patterns

Some strings must not be published and cannot be written into a public rule either: an
internal host name, a private project name. Put them in a file outside the repository — by
default `~/.config/abele/guard-patterns.txt`, or wherever `ABELE_GUARD_PATTERNS` points:

```text
# one regular expression per line; blank lines and # comments are skipped
internal\.example\.lan
(?i)codename
```

A leading `(?i)` makes a pattern case-insensitive. Patterns are checked against added lines
and against paths, and reported by line number in that file, never by what they matched.
The file is optional; CI has none, so private patterns are a pre-commit check only.

## If something got through

A credential that reached a commit is compromised the moment the commit is pushed: revoke it
first, then remove it. Deleting it in a later commit does not take it out of the history.
