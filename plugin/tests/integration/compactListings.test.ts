/**
 * The listings an agent gets grouped by folder carry every fact the flat ones did.
 *
 * Each tool's compact answer is read back — by a reader written from the format alone — and
 * compared with the vault it was made from: every path, and every field of every row.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createReadTasksTool,
  createReadTransactionsTool,
  createReadBacklinksTool,
} from '@/ai/tools/RelationTools'
import { createListWorkspaceTool } from '@/ai/tools/ListWorkspaceTool'
import { createFindTool } from '@/ai/tools/FindTool'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import type { AgentTool } from '@/ai/client'
import type { FakeFileSpec } from '../helpers/fakeVault'
import { useVault, configureAbele } from '../helpers/testEnv'
import { readGrouped, readProperties } from '../helpers/compactListing'

const run = async (tool: AgentTool, params: Record<string, unknown> = {}) =>
  (await tool.execute('call', params)).content.map((c) => c.text).join('')

const TASKS: FakeFileSpec[] = [
  {
    path: 'Tasks/Ship it.md',
    frontmatter: {
      type: 'task',
      due: '2026-09-01',
      priority: 'High',
      labels: ['work'],
      groups: ['[[Project]]'],
    },
  },
  {
    path: 'Tasks/Done/Old thing.md',
    frontmatter: {
      type: 'task',
      completed: '2026-08-02',
      date: '2026-08-01',
      groups: ['[[Project]]'],
    },
  },
  {
    path: 'Tasks/Done/Weekly — review.md',
    frontmatter: { type: 'task', recurrence: 'every week', groups: ['[[Project]]'] },
  },
  { path: 'Root task.md', frontmatter: { type: 'task', due: '2026-10-10' } },
]

const TRANSACTIONS: FakeFileSpec[] = [
  {
    path: 'Finance/Transactions/2026/03/Coffee (1).md',
    frontmatter: {
      type: 'transaction',
      date: '2026-03-24',
      from: '[[Checking]]',
      to: '[[Eating out]]',
      amount: 6.11,
      currency: 'USD',
      category: 'Eating out',
      groups: ['[[Project]]'],
    },
  },
  {
    path: 'Finance/Transactions/2026/03/No category.md',
    frontmatter: { type: 'transaction', date: '2026-03-25', from: '[[Checking]]', amount: 3 },
  },
  {
    path: 'Finance/Transactions/2026/04/Rent.md',
    frontmatter: {
      type: 'transaction',
      date: '2026-04-01',
      to: '[[Landlord]]',
      amount: 900,
      currency: 'EUR',
      category: 'Home',
    },
  },
]

beforeEach(() => {
  useVault([
    { path: 'Notes/Project.md', content: 'Project\n' },
    {
      path: 'Notes/Linked/One.md',
      frontmatter: { type: 'book', created: '2026-01-02', groups: ['[[Project]]'] },
    },
    { path: 'Notes/Two.md', frontmatter: { groups: ['[[Project]]'] } },
    ...TASKS,
    ...TRANSACTIONS,
  ])
  configureAbele().taskLabelProperty = 'labels'
  ScopeResolver.getInstance().setFullVaultAccess(true)
})

afterEach(() => {
  ScopeResolver.getInstance().setFullVaultAccess(false)
  VaultWatcherWrapper.destroy()
})

describe('read_tasks', () => {
  it('names every task by its path and carries every field', async () => {
    const text = await run(createReadTasksTool())
    expect(text.split('\n')[0]).toBe('4 tasks (1 done):')
    const rows = readGrouped(text)
    expect(rows.map((r) => r.path).sort()).toEqual(TASKS.map((t) => t.path).sort())

    const byPath = new Map(rows.map((r) => [r.path, r]))
    expect(byPath.get('Tasks/Ship it.md')).toMatchObject({
      marker: '[ ]',
      fields: ['due:2026-09-01', 'priority:high', 'labels:work'],
    })
    expect(byPath.get('Tasks/Done/Old thing.md')).toMatchObject({
      marker: '[x]',
      fields: ['date:2026-08-01', 'completed:2026-08-02'],
    })
    expect(byPath.get('Tasks/Done/Weekly — review.md')?.fields).toEqual(['recur:every week'])
    expect(byPath.get('Root task.md')?.fields).toEqual(['due:2026-10-10'])
  })

  it('lists the tasks of one note the same way', async () => {
    const text = await run(createReadTasksTool(), { path: 'Notes/Project.md' })
    expect(
      readGrouped(text)
        .map((r) => r.path)
        .sort()
    ).toEqual(
      TASKS.filter((t) => t.path !== 'Root task.md')
        .map((t) => t.path)
        .sort()
    )
  })
})

describe('read_transactions', () => {
  it('carries every column of every row, empty ones in their place', async () => {
    const text = await run(createReadTransactionsTool())
    expect(text.split('\n')[0]).toBe(
      '3 transactions (date | from | to | amount | category | file):'
    )
    const rows = readGrouped(
      // The row starts with the date, the file is last: move it first for the reader.
      text
        .split('\n')
        .map((l) => {
          if (!l.startsWith('  ')) return l
          const parts = l.slice(2).split(' | ')
          return '  ' + [parts[parts.length - 1], ...parts.slice(0, -1)].join(' | ')
        })
        .join('\n')
    )
    expect(rows.map((r) => r.path).sort()).toEqual(TRANSACTIONS.map((t) => t.path).sort())
    for (const spec of TRANSACTIONS) {
      const fm = spec.frontmatter as Record<string, unknown>
      const row = rows.find((r) => r.path === spec.path)!
      expect(row.fields).toEqual([
        fm.date ?? '',
        fm.from ?? '',
        fm.to ?? '',
        fm.amount != null ? `${fm.amount} ${fm.currency ?? ''}`.trim() : '',
        fm.category ?? '',
      ])
    }
  })
})

describe('read_backlinks', () => {
  it('names every linked note by its path, with its type and date', async () => {
    const text = await run(createReadBacklinksTool(), { path: 'Notes/Project.md' })
    const rows = readGrouped(text)
    const paths = rows.map((r) => r.path)
    expect(paths).toContain('Notes/Linked/One.md')
    expect(paths).toContain('Notes/Two.md')
    expect(rows.find((r) => r.path === 'Notes/Linked/One.md')?.fields).toEqual([
      'type=book',
      '2026-01-02',
    ])
    expect(text.split('\n')[0]).toBe(`${rows.length} notes:`)
  })
})

describe('workspace', () => {
  it('lists every path of the page', async () => {
    const text = await run(createListWorkspaceTool())
    const all = ScopeResolver.getInstance().getAccessiblePaths()
    expect(readGrouped(text).map((r) => r.path)).toEqual(all)
  })
})

describe('find, as an agent has it', () => {
  const tasks = [{ type: 'property', operator: 'equals', property: 'type', value: 'task' }]

  it('lists every path it found', async () => {
    const text = await run(createFindTool({ compact: true }), { criteria: tasks })
    expect(
      readGrouped(text)
        .map((r) => r.path)
        .sort()
    ).toEqual(TASKS.map((t) => t.path).sort())
  })

  it('carries every property of every file, shared ones said once', async () => {
    const text = await run(createFindTool({ compact: true }), {
      criteria: tasks,
      include_frontmatter: true,
    })
    const head = text.split('\n')[0]
    expect(head).toBe('4 files, every one listed with type: task:')
    const shared = readProperties(head.slice('4 files, every one listed with '.length, -1))
    const rows = readGrouped(text)
    for (const spec of TASKS) {
      const row = rows.find((r) => r.path === spec.path)!
      expect({ ...shared, ...readProperties(row.fields.join(' | ')) }).toEqual(spec.frontmatter)
    }
  })

  it('keeps the flat list for a script', async () => {
    const text = await run(createFindTool(), { criteria: tasks })
    expect(text.split('\n').slice(1).sort()).toEqual(TASKS.map((t) => t.path).sort())
  })
})
