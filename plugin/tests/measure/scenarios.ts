/**
 * The calls a measurement makes: what an agent working in a vault typically asks, aimed at the
 * places in this particular vault where the answers are biggest — its largest folder, its most
 * linked-to note, its longest note — so the numbers are the cost of real use, not of a toy.
 */
import type { FakeFileSpec } from '../helpers/fakeVault'

export interface Scenario {
  label: string
  tool: string
  args: Record<string, unknown>
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let n = 0
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c]
  return best
}

const LINK = /\[\[([^\]|#]+)/

export function scenariosFor(specs: FakeFileSpec[]): Scenario[] {
  const md = specs.filter((s) => s.path.endsWith('.md'))
  const byBasename = new Map(md.map((s) => [s.path.split('/').pop()!.slice(0, -3), s.path]))

  // The note most notes put in their `groups`: a project, a trip, a hub.
  const groupTargets: string[] = []
  for (const s of md) {
    const groups = s.frontmatter?.groups
    for (const g of Array.isArray(groups) ? groups : groups ? [groups] : []) {
      const m = LINK.exec(String(g))
      const path = m && byBasename.get(m[1].trim())
      if (path) groupTargets.push(path)
    }
  }
  const hub = mostCommon(groupTargets) ?? md[0].path

  const folders = specs.map((s) => s.path.slice(0, Math.max(0, s.path.lastIndexOf('/'))))
  const biggestFolder = mostCommon(folders.filter(Boolean)) ?? ''

  const bySize = [...md].sort((a, b) => (a.raw?.length ?? 0) - (b.raw?.length ?? 0))
  const longest = bySize[bySize.length - 1].path
  const median = bySize[Math.floor(bySize.length / 2)].path

  return [
    { label: 'ls (root)', tool: 'ls', args: {} },
    { label: 'ls (largest folder)', tool: 'ls', args: { path: biggestFolder } },
    { label: 'workspace (first page)', tool: 'workspace', args: {} },
    {
      label: 'find type=task',
      tool: 'find',
      args: {
        criteria: [{ type: 'property', operator: 'equals', property: 'type', value: 'task' }],
      },
    },
    {
      label: 'find type=task +frontmatter',
      tool: 'find',
      args: {
        criteria: [{ type: 'property', operator: 'equals', property: 'type', value: 'task' }],
        include_frontmatter: true,
      },
    },
    {
      label: 'find content "the", limit 200',
      tool: 'find',
      args: {
        criteria: [{ type: 'content', operator: 'contains', value: 'the' }],
        limit: 200,
      },
    },
    { label: 'read (longest note)', tool: 'read', args: { path: longest } },
    { label: 'read (median note)', tool: 'read', args: { path: median } },
    { label: 'read_tasks (all)', tool: 'read_tasks', args: {} },
    { label: 'read_tasks (hub)', tool: 'read_tasks', args: { path: hub } },
    { label: 'read_backlinks (hub)', tool: 'read_backlinks', args: { path: hub } },
    {
      label: 'read_backlinks (hub, content)',
      tool: 'read_backlinks',
      args: { path: hub, include_content: true },
    },
    { label: 'read_logs (hub)', tool: 'read_logs', args: { path: hub } },
    { label: 'read_transactions (all)', tool: 'read_transactions', args: {} },
    { label: 'query_docs (contents)', tool: 'query_docs', args: {} },
    { label: 'query_docs (tools)', tool: 'query_docs', args: { section: 'tools' } },
  ]
}

/**
 * One working session, as a sequence of calls: look around, find the tasks of the hub, read
 * the notes that matter, and read its history. Used to measure what the history costs when
 * every one of these results rides along in every later request.
 */
export function sessionFor(specs: FakeFileSpec[]): Scenario[] {
  const all = scenariosFor(specs)
  const pick = (label: string) => all.find((s) => s.label === label)!
  return [
    pick('workspace (first page)'),
    pick('ls (root)'),
    pick('ls (largest folder)'),
    pick('find type=task'),
    pick('read_tasks (hub)'),
    pick('read_backlinks (hub)'),
    pick('read (longest note)'),
    pick('read (median note)'),
    pick('read_logs (hub)'),
    pick('find type=task +frontmatter'),
    pick('read_transactions (all)'),
    pick('query_docs (tools)'),
  ]
}
