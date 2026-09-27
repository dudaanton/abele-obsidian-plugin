/**
 * The linter's vocabulary: a note as a rule sees it, a rule, what a rule finds, and a run's report.
 *
 * A rule is two pure functions over text — `check` says what is wrong, `fix` hands back the note
 * as it should be. Nothing here touches the vault; the engine reads, and writes only through
 * `vault.process` once it has made sure the note did not change underneath (see `engine.ts`).
 */

export type LintSeverity = 'error' | 'warning'

/** A note, read once and taken apart the way every rule needs it. */
export interface LintNote {
  path: string
  /** The file name without `.md`. */
  name: string
  /** The folder it sits in; empty for the vault's root. */
  folder: string
  /** The whole file, exactly as it is on disk. */
  content: string
  /** The same text cut into lines, without their line breaks. */
  lines: string[]
  /**
   * The properties, parsed. `null` when the note has none, or when they could not be read — then
   * `frontmatterError` says why.
   */
  frontmatter: Record<string, unknown> | null
  /** Whether the note opens with a `---` block at all, readable or not. */
  hasFrontmatter: boolean
  /** Why the properties could not be read; empty when they could, or when there are none. */
  frontmatterError: string
  /** The line the error is on, 1-based; 0 for the block as a whole. */
  frontmatterErrorLine: number
  /** The line the closing `---` is on, 1-based; 0 without a frontmatter block. */
  frontmatterEnd: number
  /** The first line after the frontmatter, 1-based (1 when there is none). */
  bodyStart: number
  /** The text after the frontmatter. */
  body: string
  /** When the file was made and last changed, in ms. 0 when unknown. */
  ctime: number
  mtime: number
}

/** One thing a rule found wrong with a note. */
export interface LintFinding {
  message: string
  /** 1-based, over the whole file, frontmatter included — the numbers `read` gives. */
  line?: number
  /** Whether the rule's fix would put this right. Defaults to whether the rule has a fix. */
  fixable?: boolean
}

/** A setting a rule takes, described so the settings screen can offer it. */
export interface LintParamSpec {
  name: string
  label: string
  description: string
  /** `list` is a list of words, typed comma-separated. */
  type: 'list' | 'text' | 'boolean'
  default: string[] | string | boolean
}

export type LintParams = Record<string, unknown>

export interface LintRule {
  id: string
  title: string
  description: string
  severity: LintSeverity
  params: LintParamSpec[]
  /** Off until switched on, for a rule most vaults would fail wholesale. */
  enabledByDefault: boolean
  /** Where the rule comes from: the plugin, or a script (its path). */
  source: 'builtin' | { script: string }
  check(note: LintNote, params: LintParams): LintFinding[] | Promise<LintFinding[]>
  /** The note's text with what this rule found put right, or `null` for nothing it can fix. */
  fix?(note: LintNote, params: LintParams): string | null | Promise<string | null>
}

/** A finding, placed: which note, which rule, how bad. */
export interface LintIssue {
  path: string
  rule: string
  message: string
  line: number
  severity: LintSeverity
  fixable: boolean
}

export interface LintReport {
  /** What was linted, in words: "the vault", a folder, a note. */
  scope: string
  /** The paths the run was asked for, so it can be run again. */
  target: LintTarget
  issues: LintIssue[]
  /** Notes read so far, and how many there are in all. */
  checked: number
  total: number
  running: boolean
  cancelled: boolean
  /** A rule that threw, by id, with its message; it was skipped from then on. */
  ruleErrors: Record<string, string>
  startedAt: number
  finishedAt: number
}

/** What a run covers. */
export type LintTarget =
  | { kind: 'vault' }
  | { kind: 'folder'; path: string }
  | { kind: 'notes'; paths: string[] }
