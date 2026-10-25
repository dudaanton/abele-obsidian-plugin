import { expect, it } from 'vitest'
import { nodeToolAccess, migrateNodeAccess } from '@/ai/nodeAccess'
import type { NodeScopeEntry } from '@/ai/nodeScope'
const scope = (access: 'read' | 'edit' | 'run'): NodeScopeEntry[] => [
  { kind: 'node', node_id: 'sample-node', access },
]
it('offers tools from folder levels', () => {
  for (const level of ['read', 'edit', 'run'] as const) {
    expect(nodeToolAccess('node_read', scope(level))).toBe(true)
    expect(nodeToolAccess('node_write', scope(level))).toBe(level !== 'read')
    expect(nodeToolAccess('node_command_run', scope(level))).toBe(level === 'run')
    expect(nodeToolAccess('node_delegate', scope(level))).toBe(level === 'run')
    expect(nodeToolAccess('node_git_commit', scope(level))).toBe(level === 'run')
  }
  expect(nodeToolAccess('node_read', [])).toBe(false)
  expect(nodeToolAccess('read', [])).toBeUndefined()
})
it('migrates only edit folders with enabled legacy execution', () => {
  const entries = [...scope('read'), ...scope('edit')]
  expect(migrateNodeAccess(entries, { node_delegate: 'ask' }).map((e) => e.access)).toEqual([
    'read',
    'run',
  ])
  expect(migrateNodeAccess(entries, { node_command_run: 'auto' }).map((e) => e.access)).toEqual([
    'read',
    'run',
  ])
  expect(migrateNodeAccess(entries, { node_delegate: 'off' })).toEqual(entries)
  expect(migrateNodeAccess(entries, {})).toEqual(entries)
})

it('preserves legacy execution over inherited edit folders without changing the shared folder', () => {
  const inherited = [
    ...scope('read'),
    {
      kind: 'project' as const,
      node_id: 'sample-node',
      project_id: 'sample-project',
      access: 'edit' as const,
    },
  ]
  expect(migrateNodeAccess([], { node_command_run: 'auto' }, inherited)).toEqual([
    { ...inherited[1], access: 'run' },
  ])
  expect(inherited[1].access).toBe('edit')
  expect(migrateNodeAccess([], {}, inherited)).toEqual([])
})
