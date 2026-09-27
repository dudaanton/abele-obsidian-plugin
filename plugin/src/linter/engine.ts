/**
 * Running the rules over notes, and applying their fixes.
 *
 * A run reads the notes a batch at a time and hands the main thread back between batches, so a
 * vault of thousands of notes can be linted without the app freezing, and stopped part way. Which
 * rules look at which note is decided from the metadata cache before the note is read.
 *
 * A fix is worked out on the text as it was read, and written with `vault.process` only if the note
 * still holds that text — a note typed into, or synced, while the fix was being worked out is left
 * alone and said to be, rather than overwritten.
 */
import { TFile, TFolder, type App } from 'obsidian'
import { readNote } from './note'
import { anyMatch, ruleApplies } from './scope'
import { ruleSetting, type LintRuleSetting, type LinterSettings } from './settings'
import type { LintFinding, LintIssue, LintRule, LintTarget } from './types'

export interface ActiveRule {
  rule: LintRule
  setting: LintRuleSetting
}

/** The rules that run: switched on, each with how it is set up here. */
export function activeRules(settings: LinterSettings, rules: LintRule[]): ActiveRule[] {
  return rules
    .map((rule) => ({ rule, setting: ruleSetting(settings, rule) }))
    .filter((r) => r.setting.enabled)
}

/** The notes a target covers, less the folders no rule looks in. */
export function filesFor(app: App, target: LintTarget, settings: LinterSettings): TFile[] {
  let files: TFile[]
  if (target.kind === 'notes') {
    files = target.paths
      .map((p) => app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
  } else if (target.kind === 'folder') {
    const folder = target.path.replace(/\/+$/, '')
    const node = folder ? app.vault.getAbstractFileByPath(folder) : null
    files = app.vault
      .getMarkdownFiles()
      .filter((f) => !folder || (node instanceof TFolder && f.path.startsWith(folder + '/')))
  } else {
    files = app.vault.getMarkdownFiles()
  }
  // Notes asked for by name are linted even inside an excluded folder: the person pointed at them.
  if (target.kind !== 'notes') files = files.filter((f) => !anyMatch(f.path, settings.exclude))
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/** What a script's finding may be: words alone, or the finding in full. */
function asFinding(raw: unknown): LintFinding | null {
  if (typeof raw === 'string') return raw.trim() ? { message: raw.trim() } : null
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const message = typeof r.message === 'string' ? r.message.trim() : ''
  if (!message) return null
  const line = typeof r.line === 'number' && r.line >= 1 ? Math.floor(r.line) : undefined
  return { message, line, fixable: typeof r.fixable === 'boolean' ? r.fixable : undefined }
}

/** A run's memory of rules that broke: skipped from then on, reported once. */
export type RuleErrors = Record<string, string>

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)

/** Every issue the rules find in one note's text. */
export async function lintContent(
  path: string,
  content: string,
  facts: { ctime?: number; mtime?: number },
  rules: ActiveRule[],
  errors: RuleErrors = {}
): Promise<LintIssue[]> {
  const note = readNote(content, { path, ...facts })
  const issues: LintIssue[] = []
  for (const { rule, setting } of rules) {
    if (errors[rule.id]) continue
    let found: unknown
    try {
      found = await rule.check(note, setting.params)
    } catch (err) {
      errors[rule.id] = errorText(err)
      continue
    }
    for (const raw of Array.isArray(found) ? found : []) {
      const f = asFinding(raw)
      if (!f) continue
      issues.push({
        path,
        rule: rule.id,
        message: f.message,
        line: f.line ?? 0,
        severity: setting.severity,
        fixable: !!rule.fix && f.fixable !== false,
      })
    }
  }
  return issues
}

/** The rules that look at this note, where they are set up to. */
export const rulesFor = (app: App, file: TFile, rules: ActiveRule[]): ActiveRule[] =>
  rules.filter((r) => ruleApplies(app, file, r.setting))

export async function lintFile(
  app: App,
  file: TFile,
  rules: ActiveRule[],
  errors: RuleErrors = {}
): Promise<LintIssue[]> {
  const mine = rulesFor(app, file, rules)
  if (!mine.length) return []
  const content = await app.vault.cachedRead(file)
  return lintContent(file.path, content, file.stat, mine, errors)
}

export interface RunOptions {
  signal?: AbortSignal
  /** Called after every batch with how far the run is and what it has found so far. */
  onProgress?: (checked: number, total: number, found: LintIssue[]) => void
  batch?: number
}

export interface RunResult {
  issues: LintIssue[]
  checked: number
  cancelled: boolean
  ruleErrors: RuleErrors
}

/** Hands the main thread back, so what is on screen moves and a stop can be pressed. */
const breathe = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0))

export async function lintFiles(
  app: App,
  files: TFile[],
  rules: ActiveRule[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const size = Math.max(1, opts.batch ?? 40)
  const ruleErrors: RuleErrors = {}
  const issues: LintIssue[] = []
  let checked = 0
  for (let i = 0; i < files.length; i += size) {
    if (opts.signal?.aborted) return { issues, checked, cancelled: true, ruleErrors }
    const batch = files.slice(i, i + size)
    const found = await Promise.all(batch.map((f) => lintFile(app, f, rules, ruleErrors)))
    const fresh = found.flat()
    issues.push(...fresh)
    checked += batch.length
    opts.onProgress?.(checked, files.length, fresh)
    await breathe()
  }
  return { issues, checked, cancelled: !!opts.signal?.aborted, ruleErrors }
}

/**
 * The note's text with the fixes applied, rule after rule, each seeing what the one before wrote.
 * `only` limits it to one rule. A fix that throws is skipped.
 */
export async function fixContent(
  path: string,
  content: string,
  facts: { ctime?: number; mtime?: number },
  rules: ActiveRule[],
  only?: string
): Promise<string> {
  let text = content
  for (const { rule, setting } of rules) {
    if (!rule.fix || (only && rule.id !== only)) continue
    const errors: RuleErrors = {}
    const issues = await lintContent(path, text, facts, [{ rule, setting }], errors)
    if (!issues.some((i) => i.fixable)) continue
    try {
      const out = await rule.fix(readNote(text, { path, ...facts }), setting.params)
      if (typeof out === 'string' && out !== text) text = out
    } catch (err) {
      console.error(`[Abele] lint fix ${rule.id} failed on ${path}:`, err)
    }
  }
  return text
}

export type FixOutcome = 'fixed' | 'unchanged' | 'changed-underneath'

/** What fixing a note would write, without writing it: the text before and after. */
export async function previewFix(
  app: App,
  file: TFile,
  rules: ActiveRule[],
  only?: string
): Promise<{ before: string; after: string }> {
  const before = await app.vault.read(file)
  const after = await fixContent(file.path, before, file.stat, rulesFor(app, file, rules), only)
  return { before, after }
}

export async function fixFile(
  app: App,
  file: TFile,
  rules: ActiveRule[],
  only?: string
): Promise<FixOutcome> {
  const { before, after } = await previewFix(app, file, rules, only)
  if (after === before) return 'unchanged'
  let moved = false
  await app.vault.process(file, (current) => {
    if (current !== before) {
      moved = true
      return current
    }
    return after
  })
  return moved ? 'changed-underneath' : 'fixed'
}
