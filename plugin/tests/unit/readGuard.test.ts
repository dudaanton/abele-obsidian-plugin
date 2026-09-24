import { describe, it, expect } from 'vitest'
import type { TFile } from 'obsidian'
import {
  READ_FIRST,
  ReadGuard,
  contentHash,
  foldMarks,
  guardedTarget,
  refusal,
  withReadGuard,
} from '@/ai/readGuard'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { createEditFileTool } from '@/ai/tools/EditFileTool'
import type { ReadMark } from '@/ai/client'
import { useVault } from '../helpers/testEnv'

const mark = (over: Partial<ReadMark> = {}): ReadMark => ({
  path: 'A.md',
  hash: 'h1',
  at: Date.now(),
  via: 'read',
  ...over,
})

describe('which calls are guarded', () => {
  it('guards the tools that rewrite text, asking write for the whole file', () => {
    expect(guardedTarget('write', { path: 'A.md' })).toEqual({ path: 'A.md', need: 'whole' })
    expect(guardedTarget('edit', { path: 'A.md' })).toEqual({ path: 'A.md', need: 'any' })
    expect(guardedTarget('replace', { path: 'A.md', actions: [{ type: 'set-property' }] })).toEqual(
      { path: 'A.md', need: 'any' }
    )
  })

  it('leaves alone what changes no text of an existing file', () => {
    expect(guardedTarget('replace', { path: 'A.md', actions: [{ type: 'move' }] })).toBeNull()
    for (const name of ['read', 'create', 'mv', 'cp', 'rm', 'edit_selection', 'eval_js']) {
      expect(guardedTarget(name, { path: 'A.md', from: 'A.md' })).toBeNull()
    }
  })
})

describe('the agent’s view of a file', () => {
  it('is the latest mark', () => {
    const views = foldMarks([mark({ hash: 'h1' }), mark({ hash: 'h2', via: 'write' })])
    expect(views.get('A.md')).toMatchObject({ hash: 'h2', via: 'write' })
  })

  it('stays whole when part of the same text is read after all of it', () => {
    const views = foldMarks([mark(), mark({ lines: [2, 3] })])
    expect(views.get('A.md')?.lines).toBeUndefined()
  })

  it('becomes partial when the text changed in between', () => {
    const views = foldMarks([mark(), mark({ hash: 'h2', lines: [2, 3] })])
    expect(views.get('A.md')?.lines).toEqual([2, 3])
  })
})

describe('the refusal', () => {
  const edit = { path: 'A.md', need: 'any' as const }
  const write = { path: 'A.md', need: 'whole' as const }

  it('says the file was never read', () => {
    expect(refusal(edit, undefined, 'h1')).toMatch(
      new RegExp(`^${READ_FIRST}: A.md has not been read`)
    )
  })

  it('says what the agent last did with it, and when', () => {
    expect(refusal(edit, mark(), 'h2')).toContain('has changed since you read it at')
    expect(refusal(edit, mark({ via: 'write' }), 'h2')).toContain('since you last wrote it at')
    expect(refusal(edit, mark({ via: 'attachment' }), 'h2')).toContain('since it was attached at')
  })

  it('lets a part do for edit and not for write', () => {
    const partial = mark({ lines: [1, 5] })
    expect(refusal(edit, partial, 'h1')).toBeNull()
    expect(refusal(write, partial, 'h1')).toContain('only lines 1–5 of A.md')
  })

  it('passes a file seen as it is', () => {
    expect(refusal(write, mark(), 'h1')).toBeNull()
  })
})

describe('the hash', () => {
  it('tells versions apart and is stable', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).not.toBe(contentHash('abd'))
    expect(contentHash('')).not.toBe(contentHash(' '))
  })
})

describe('an agent a script starts', () => {
  it('is guarded for its own run', async () => {
    const app = useVault([{ path: 'A.md', content: 'alpha' }])
    const scope = new ScopeResolver()
    scope.fullVaultAccess.value = true
    const guard = new ReadGuard({ history: () => [], scope: () => scope })
    const [read, edit] = withReadGuard(
      [createReadFileTool({ skipScope: true }), createEditFileTool({ skipScope: true })],
      guard
    )
    const args = { path: 'A.md', old_string: 'alpha', new_string: 'ALPHA' }

    await expect(edit.execute('1', args)).rejects.toThrow(READ_FIRST)
    await read.execute('2', { path: 'A.md' })
    await edit.execute('3', args)
    expect(await app.vault.read(app.vault.getAbstractFileByPath('A.md') as TFile)).toBe('ALPHA')
  })
})
