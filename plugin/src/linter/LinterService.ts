/**
 * The linter as the app uses it: the rules there are, the run on screen, fixing what it found.
 *
 * One report at a time — the one the linter tab shows. Starting a run stops the one before it.
 * The agent's tools run the same engine without touching this report (see `LintTools.ts`).
 */
import { Notice, TFile, type App } from 'obsidian'
import { shallowRef } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { GlobalStore } from '@/stores/GlobalStore'
import { BUILTIN_RULES } from './rules'
import { linterSettingsFrom, type LinterSettings } from './settings'
import { loadScriptRule, scriptRuleStub } from './scriptRules'
import {
  activeRules,
  filesFor,
  fixFile,
  lintFile,
  lintFiles,
  previewFix,
  writeIfUnchanged,
  type ActiveRule,
  type FixOutcome,
} from './engine'
import type { LintIssue, LintReport, LintRule, LintTarget } from './types'

/** What a target is called on screen. */
export function targetLabel(target: LintTarget): string {
  if (target.kind === 'vault') return 'the whole vault'
  if (target.kind === 'folder') return target.path ? `the folder ${target.path}` : 'the whole vault'
  if (target.paths.length === 1) return target.paths[0].replace(/\.md$/, '')
  return `${target.paths.length} notes`
}

/** How often a run in progress redraws the list. */
const PAINT_EVERY_MS = 150

export interface FixSummary {
  fixed: number
  unchanged: number
  /** Notes that changed while their fix was being worked out, and were left alone. */
  skipped: number
}

export class LinterService {
  private static instance: LinterService | null = null

  static getInstance(): LinterService {
    if (!this.instance) this.instance = new LinterService()
    return this.instance
  }

  static destroy(): void {
    this.instance?.cancel()
    this.instance = null
  }

  /** The run on screen; `null` before the first. */
  readonly report = shallowRef<LintReport | null>(null)
  /** A fix-all going on: how many notes are done of how many. */
  readonly fixing = shallowRef<{ done: number; total: number } | null>(null)

  private controller: AbortController | null = null
  /**
   * The rules each run was made with — scripts loaded — by the run's `startedAt`. The report on
   * screen is fixed and read again with its own run's rules: a run stopped by a newer one may
   * finish loading its rules after that one, and must not hand them to the newer report.
   */
  private runRules = new Map<number, ActiveRule[]>()
  private lastStart = 0

  /** The rules of the run on screen; none before its rules are loaded. */
  private get rules(): ActiveRule[] {
    const at = this.report.value?.startedAt
    return (at !== undefined && this.runRules.get(at)) || []
  }

  private get app(): App {
    return GlobalStore.getInstance().app
  }

  settings(): LinterSettings {
    return linterSettingsFrom(AbeleConfig.getInstance().linter)
  }

  private lintScripts() {
    try {
      return ScriptService.getInstance().getLintScripts()
    } catch {
      return []
    }
  }

  /** Every rule there is, for the settings: the plugin's and the scripts', not loaded. */
  allRules(): LintRule[] {
    return [...BUILTIN_RULES, ...this.lintScripts().map(scriptRuleStub)]
  }

  /** The rules that run, the scripts among them run once each to get their check and fix. */
  async loadRules(settings = this.settings()): Promise<ActiveRule[]> {
    const scripts = this.lintScripts()
    const service = ScriptService.getInstance()
    const wanted = activeRules(settings, [...BUILTIN_RULES, ...scripts.map(scriptRuleStub)])
    const loaded: LintRule[] = []
    for (const { rule } of wanted) {
      const script = scripts.find((s) => rule.source !== 'builtin' && s.path === rule.source.script)
      loaded.push(script ? await loadScriptRule(script, (p) => service.definition(p)) : rule)
    }
    return activeRules(settings, loaded)
  }

  running(): boolean {
    return !!this.report.value?.running
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }

  /** Lints the target, the report on screen following it as it goes. */
  async run(target: LintTarget): Promise<LintReport> {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    const settings = this.settings()
    const files = filesFor(this.app, target, settings)
    const base: LintReport = {
      scope: targetLabel(target),
      target,
      issues: [],
      checked: 0,
      total: files.length,
      running: true,
      cancelled: false,
      ruleErrors: {},
      // Unique per run, since it is what tells the runs apart: two may start in one millisecond.
      startedAt: (this.lastStart = Math.max(Date.now(), this.lastStart + 1)),
      finishedAt: 0,
    }
    this.report.value = base
    const onScreen = () => this.report.value?.startedAt === base.startedAt
    const issues: LintIssue[] = []
    let done: LintReport = { ...base, running: false, cancelled: true, finishedAt: Date.now() }
    try {
      const rules = await this.loadRules(settings)
      if (onScreen()) this.runRules = new Map([[base.startedAt, rules]])
      // The list is drawn anew a few times a second at most: each drawing groups all found so far.
      let drawn = 0
      const result = await lintFiles(this.app, files, rules, {
        signal: controller.signal,
        onProgress: (checked, _total, found) => {
          issues.push(...found)
          if (!onScreen()) return
          const now = Date.now()
          if (now - drawn < PAINT_EVERY_MS && checked < files.length) return
          drawn = now
          this.report.value = { ...base, issues: [...issues], checked }
        },
      })
      done = {
        ...base,
        issues: result.issues,
        checked: result.checked,
        running: false,
        cancelled: result.cancelled,
        ruleErrors: result.ruleErrors,
        finishedAt: Date.now(),
      }
    } catch (err) {
      // Whatever broke, the tab stops saying it is linting and keeps what was found.
      console.error('[Abele] lint run failed:', err)
      done = { ...base, issues, running: false, cancelled: true, finishedAt: Date.now() }
    } finally {
      // A newer run has taken the screen: this one's result is not shown.
      if (onScreen()) this.report.value = done
      if (this.controller === controller) this.controller = null
    }
    return done
  }

  /** Runs the last target again. */
  async rerun(): Promise<void> {
    const target = this.report.value?.target
    if (target) await this.run(target)
  }

  private file(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? file : null
  }

  /** Reads one note again and puts what it holds now in place of what the report said. */
  async relint(path: string): Promise<void> {
    const report = this.report.value
    if (!report) return
    const file = this.file(path)
    const fresh = file ? await lintFile(this.app, file, this.rules) : []
    const current = this.report.value
    if (!current || current.startedAt !== report.startedAt) return
    const at = current.issues.findIndex((i) => i.path === path)
    const rest = current.issues.filter((i) => i.path !== path)
    const place = at < 0 ? rest.length : at
    this.report.value = {
      ...current,
      issues: [...rest.slice(0, place), ...fresh, ...rest.slice(place)],
    }
  }

  /** What fixing the note would change — one rule's findings, or all of them. */
  async preview(path: string, rule?: string): Promise<{ before: string; after: string } | null> {
    const file = this.file(path)
    return file ? previewFix(this.app, file, this.rules, rule) : null
  }

  /**
   * Writes the fix a preview showed, exactly — and only while the note still holds the text it
   * was worked out from. Changed since, nothing is written and the preview has to be asked again.
   */
  async applyPreview(path: string, shown: { before: string; after: string }): Promise<FixOutcome> {
    const file = this.file(path)
    if (!file || shown.after === shown.before) return 'unchanged'
    const outcome = await writeIfUnchanged(this.app, file, shown.before, shown.after)
    if (outcome === 'changed-underneath') {
      new Notice(`${file.basename} changed since the preview, so it was left as it is`)
    }
    await this.relint(path)
    return outcome
  }

  /** Fixes a note — one rule's findings, or every one that can be — and reads it again. */
  async fix(path: string, rule?: string): Promise<FixOutcome> {
    const file = this.file(path)
    if (!file) return 'unchanged'
    const outcome = await fixFile(this.app, file, this.rules, rule)
    if (outcome === 'changed-underneath') {
      new Notice(`${file.basename} changed while it was being fixed, so it was left as it is`)
    }
    await this.relint(path)
    return outcome
  }

  /** The notes with something the fixes can put right. */
  fixablePaths(): string[] {
    const issues = this.report.value?.issues ?? []
    return [...new Set(issues.filter((i) => i.fixable).map((i) => i.path))]
  }

  /** Fixes every note in the report that can be, one after another. */
  async fixAll(): Promise<FixSummary> {
    const paths = this.fixablePaths()
    const summary: FixSummary = { fixed: 0, unchanged: 0, skipped: 0 }
    this.fixing.value = { done: 0, total: paths.length }
    try {
      for (const [i, path] of paths.entries()) {
        const file = this.file(path)
        const outcome = file ? await fixFile(this.app, file, this.rules) : 'unchanged'
        if (outcome === 'fixed') summary.fixed++
        else if (outcome === 'changed-underneath') summary.skipped++
        else summary.unchanged++
        await this.relint(path)
        this.fixing.value = { done: i + 1, total: paths.length }
      }
    } finally {
      this.fixing.value = null
    }
    const skipped = summary.skipped
      ? `; ${summary.skipped} changed while being fixed and were left as they are`
      : ''
    new Notice(`Fixed ${summary.fixed} ${summary.fixed === 1 ? 'note' : 'notes'}${skipped}`)
    return summary
  }
}
