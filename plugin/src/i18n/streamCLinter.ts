import { currentLocale, numberFormatter, t } from './index'
import { reportCounts } from '../linter/grouping'
import type { LintReport } from '../linter/types'

const number = (n: number): string =>
  currentLocale().language === 'en'
    ? n.toLocaleString()
    : numberFormatter(currentLocale().format, {}).format(n)
const notes = (count: number) => t('streamC.lintNotes', { count: count, formatted: number(count) })

/** The report itself and all diagnostic messages stay original. */
export function lintScope(report: LintReport): string {
  const target = report.target
  if (target.kind === 'vault' || (target.kind === 'folder' && !target.path))
    return t('streamC.0a409543f63cb9f0')
  if (target.kind === 'folder') return t('streamC.28913523a4bc7d66', { v1: target.path })
  return target.paths.length === 1
    ? target.paths[0].replace(/\.md$/, '')
    : t('streamC.lintNotes', { count: target.paths.length, formatted: String(target.paths.length) })
}

export function lintHeadline(report: LintReport | null): string {
  if (!report) return t('streamC.4d857e2fe69f9cfb')
  const counts = reportCounts(report)
  const done = report.running
    ? t('streamC.dc8c1f31b5d7ab7d', {
        v1: lintScope(report),
        v2: number(report.checked),
        v3: notes(report.total),
      })
    : report.cancelled
      ? t('streamC.b07cbae259bf1781', { v1: lintScope(report), v2: notes(report.checked) })
      : t('streamC.bf5ef3c38caca474', { v1: lintScope(report), v2: notes(report.checked) })
  if (!counts.issues)
    return report.running ? done + '.' : t('streamC.037e4b039fdf21d2', { v1: done })
  const fixable = counts.fixable
    ? t('streamC.738c7de4e1afc1da', { v1: number(counts.fixable) })
    : ''
  return t('streamC.ba9cec48af7339a8', {
    v1: done,
    v2: t('streamC.lintIssues', { count: counts.issues, formatted: number(counts.issues) }),
    v3: notes(counts.notes),
    v4: fixable,
  })
}
