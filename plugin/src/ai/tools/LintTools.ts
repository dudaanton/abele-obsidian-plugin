/**
 * The linter for an agent: `lint` reads what the rules find, `lint_fix` applies their fixes.
 *
 * Both run the same engine and rules as the linter tab, set up the same way, and look only at the
 * notes in the chat's scope. Neither touches the report the tab shows.
 */
import { TFile, TFolder, normalizePath, type App } from 'obsidian'
import type { AgentTool } from '../client'
import { scopeOf, type ToolContext } from '../toolContext'
import { GlobalStore } from '@/stores/GlobalStore'
import { LinterService } from '@/linter/LinterService'
import { filesFor, fixFile, lintFiles, rulesFor } from '@/linter/engine'
import type { LintIssue, LintTarget } from '@/linter/types'
import { groupByFolder } from './compactListing'

const DEFAULT_LIMIT = 200

/** What `path` names: a note, a folder, or — left empty — everything in scope. */
function targetOf(app: App, raw: unknown): LintTarget {
  const path = typeof raw === 'string' ? normalizePath(raw.trim()) : ''
  if (!path || path === '/') return { kind: 'vault' }
  const node =
    app.vault.getAbstractFileByPath(path) ?? app.vault.getAbstractFileByPath(`${path}.md`)
  if (node instanceof TFile) return { kind: 'notes', paths: [node.path] }
  if (node instanceof TFolder) return { kind: 'folder', path: node.path }
  throw new Error(`No note or folder at ${path}`)
}

function filesInScope(app: App, target: LintTarget, ctx?: ToolContext): TFile[] {
  const scope = scopeOf(ctx)
  return filesFor(app, target, LinterService.getInstance().settings()).filter((f) =>
    scope.isInScope(f.path)
  )
}

function describeIssues(issues: LintIssue[], limit: number): string {
  const byNote = new Map<string, LintIssue[]>()
  for (const issue of issues.slice(0, limit)) {
    const list = byNote.get(issue.path)
    if (list) list.push(issue)
    else byNote.set(issue.path, [issue])
  }
  return groupByFolder(
    [...byNote.entries()],
    ([path]) => path,
    ([, list], name) =>
      [
        name,
        ...list.map(
          (i) =>
            `    ${i.line ? `L${i.line} ` : ''}${i.rule} (${i.severity}${i.fixable ? ', fixable' : ''}): ${i.message}`
        ),
      ].join('\n')
  )
}

export function createLintTool(): AgentTool {
  return {
    name: 'lint',
    label: 'Lint notes',
    description:
      'Check notes against the linter rules the person has set up (properties present and readable, ' +
      'required properties, no h1, blank line after the properties, their own script rules…). ' +
      'Returns the issues grouped by folder and note: line, rule id, severity, whether a fix exists, message. ' +
      'Reads only; use lint_fix to apply the fixes, or edit a note by hand for the rest.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'A note or a folder to lint. Empty for every note in scope.',
        },
        rule: { type: 'string', description: 'Only this rule id’s issues.' },
        limit: {
          type: 'number',
          description: `How many issues to list at most (default ${DEFAULT_LIMIT}). The counts are always whole.`,
        },
      },
    },
    execute: async (_id, params, signal, ctx) => {
      const { app } = GlobalStore.getInstance()
      const files = filesInScope(app, targetOf(app, params.path), ctx)
      const service = LinterService.getInstance()
      const rules = await service.loadRules()
      const run = await lintFiles(app, files, rules, { signal })
      const only = typeof params.rule === 'string' && params.rule.trim() ? params.rule.trim() : ''
      const issues = only ? run.issues.filter((i) => i.rule === only) : run.issues
      const limit =
        typeof params.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_LIMIT
      const notes = new Set(issues.map((i) => i.path)).size
      const fixable = issues.filter((i) => i.fixable).length
      const counts = new Map<string, number>()
      for (const i of issues) counts.set(i.rule, (counts.get(i.rule) ?? 0) + 1)

      const lines = [
        `Linted ${run.checked} notes with ${rules.length} rules: ${issues.length} issues in ${notes} notes, ${fixable} fixable.`,
      ]
      if (counts.size) {
        lines.push(`By rule: ${[...counts].map(([r, n]) => `${r} ${n}`).join(', ')}`)
      }
      for (const [rule, error] of Object.entries(run.ruleErrors)) {
        lines.push(`Rule ${rule} failed and was skipped: ${error}`)
      }
      if (issues.length) lines.push('', describeIssues(issues, limit))
      if (issues.length > limit) lines.push(`… ${issues.length - limit} more not listed`)
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    },
  }
}

export function createLintFixTool(): AgentTool {
  return {
    name: 'lint_fix',
    label: 'Fix lint issues',
    description:
      'Apply the linter’s automatic fixes to a note, or to every note in a folder. Only issues `lint` ' +
      'marks fixable are changed; the rest stay for editing by hand. A note that changes while its fix ' +
      'is worked out is left alone. Returns which notes were changed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The note or folder to fix. "/" for every note in scope.',
        },
        rule: { type: 'string', description: 'Only this rule id’s fixes.' },
      },
      required: ['path'],
    },
    execute: async (_id, params, signal, ctx) => {
      const { app } = GlobalStore.getInstance()
      const files = filesInScope(app, targetOf(app, params.path), ctx)
      const rules = await LinterService.getInstance().loadRules()
      const only =
        typeof params.rule === 'string' && params.rule.trim() ? params.rule.trim() : undefined
      const fixed: string[] = []
      const skipped: string[] = []
      for (const file of files) {
        if (signal?.aborted) break
        if (!rulesFor(app, file, rules).some((r) => r.rule.fix !== undefined)) continue
        const outcome = await fixFile(app, file, rules, only)
        if (outcome === 'fixed') fixed.push(file.path)
        if (outcome === 'changed-underneath') skipped.push(file.path)
      }
      const lines = [`Fixed ${fixed.length} of ${files.length} notes.`]
      if (fixed.length)
        lines.push(
          groupByFolder(
            fixed,
            (p) => p,
            (_p, name) => name
          )
        )
      if (skipped.length) lines.push(`Changed while being fixed, left alone: ${skipped.join(', ')}`)
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: fixed.length === 1 ? { path: fixed[0] } : undefined,
      }
    },
  }
}
