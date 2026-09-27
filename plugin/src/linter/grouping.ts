/**
 * The report cut into what the linter tab lists: a group per note or per rule, each with its
 * issues in order. Pure, so what is listed, in what order and with what counts is tested without
 * a screen.
 */
import type { LintIssue, LintReport } from './types'

export type GroupBy = 'note' | 'rule'

export interface IssueGroup {
  /** The note's path or the rule's id. */
  key: string
  kind: GroupBy
  title: string
  issues: LintIssue[]
  errors: number
  fixable: number
}

const noteTitle = (path: string): string => path.replace(/\.md$/i, '')

export function groupIssues(
  issues: LintIssue[],
  by: GroupBy,
  ruleTitle: (id: string) => string = (id) => id
): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const issue of issues) {
    const key = by === 'note' ? issue.path : issue.rule
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        kind: by,
        title: by === 'note' ? noteTitle(key) : ruleTitle(key),
        issues: [],
        errors: 0,
        fixable: 0,
      }
      groups.set(key, group)
    }
    group.issues.push(issue)
    if (issue.severity === 'error') group.errors++
    if (issue.fixable) group.fixable++
  }
  const list = [...groups.values()]
  for (const g of list) g.issues.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  // Notes by path; rules with the most found first, errors ahead of warnings.
  return by === 'note'
    ? list.sort((a, b) => a.key.localeCompare(b.key))
    : list.sort((a, b) => b.errors - a.errors || b.issues.length - a.issues.length)
}

export interface ReportCounts {
  issues: number
  notes: number
  fixable: number
  fixableNotes: number
  errors: number
}

export function reportCounts(report: LintReport | null): ReportCounts {
  const issues = report?.issues ?? []
  const fixable = issues.filter((i) => i.fixable)
  return {
    issues: issues.length,
    notes: new Set(issues.map((i) => i.path)).size,
    fixable: fixable.length,
    fixableNotes: new Set(fixable.map((i) => i.path)).size,
    errors: issues.filter((i) => i.severity === 'error').length,
  }
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

/** The report in one line: what was linted and how far, then what was found. */
export function reportHeadline(report: LintReport | null): string {
  if (!report) return 'Nothing linted yet.'
  const c = reportCounts(report)
  const done = report.running
    ? `Linting ${report.scope}: ${report.checked.toLocaleString()} of ${plural(report.total, 'note')}`
    : `${report.cancelled ? 'Stopped linting' : 'Linted'} ${report.scope}: ${plural(report.checked, 'note')}`
  if (!c.issues) return report.running ? `${done}.` : `${done}, nothing found.`
  const fixable = c.fixable ? `, ${c.fixable.toLocaleString()} can be fixed` : ''
  return `${done}. ${plural(c.issues, 'issue')} in ${plural(c.notes, 'note')}${fixable}.`
}

export { plural }
