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
import { createWriteFileTool } from '@/ai/tools/WriteFileTool'
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

describe('a file read in windows', () => {
  it('adds up windows of the same text that follow one another', () => {
    const views = foldMarks([
      mark({ lines: [1, 40], total: 100 }),
      mark({ lines: [41, 80], total: 100 }),
    ])
    expect(views.get('A.md')?.lines).toEqual([1, 80])
  })

  it('counts as whole once the windows run from the first line to the last', () => {
    const views = foldMarks([
      mark({ lines: [1, 40], total: 100 }),
      mark({ lines: [30, 80], total: 100 }),
      mark({ lines: [81, 100], total: 100 }),
    ])
    expect(views.get('A.md')?.lines).toBeUndefined()
    expect(refusal({ path: 'A.md', need: 'whole' }, views.get('A.md'), 'h1')).toBeNull()
  })

  it('does not add up windows with a gap between them', () => {
    const views = foldMarks([
      mark({ lines: [1, 40], total: 100 }),
      mark({ lines: [50, 100], total: 100 }),
    ])
    expect(views.get('A.md')?.lines).toEqual([50, 100])
  })

  it('does not add up windows of different texts', () => {
    const views = foldMarks([
      mark({ lines: [1, 50], total: 100 }),
      mark({ hash: 'h2', lines: [51, 100], total: 100 }),
    ])
    expect(views.get('A.md')?.lines).toEqual([51, 100])
  })

  it('does not add a read to a window carried over an edit', () => {
    const views = foldMarks([
      mark({ via: 'write', lines: [1, 50] }),
      mark({ lines: [51, 100], total: 100 }),
    ])
    expect(views.get('A.md')?.lines).toEqual([51, 100])
  })
})

describe('a file too long for one read', () => {
  const long = Array.from({ length: 4000 }, (_, i) => `line ${i + 1} with a few more words in it`)

  it('comes back as the window that fits, recorded as only that window', async () => {
    useVault([{ path: 'A.md', content: long.join('\n') }])
    const read = createReadFileTool({ skipScope: true, numbered: true, budget: 2000 })
    const r = await read.execute('1', { path: 'A.md' })
    const text = r.content[0].text
    const to = r.seen!.lines![1]
    expect(r.seen!.lines![0]).toBe(1)
    expect(to).toBeLessThan(4000)
    expect(r.seen!.total).toBe(4000)
    expect(text).toContain(`${to}\t${long[to - 1]}`)
    expect(text).not.toContain(`${to + 1}\t`)
    expect(text).toContain(`Read on with start_line: ${to + 1}`)
  })

  it('can be written once read to the end, one window after another', async () => {
    const app = useVault([{ path: 'A.md', content: long.join('\n') }])
    const scope = new ScopeResolver()
    scope.fullVaultAccess.value = true
    const guard = new ReadGuard({ history: () => [], scope: () => scope })
    const [read, write] = withReadGuard(
      [
        createReadFileTool({ skipScope: true, numbered: true, budget: 2000 }),
        createWriteFileTool({ skipScope: true }),
      ],
      guard
    )

    let start = 1
    let reads = 0
    for (;;) {
      const r = await read.execute(`r${reads++}`, { path: 'A.md', start_line: start })
      const lines = r.seen?.lines
      if (!lines || lines[1] >= 4000) break
      // Short of the end, part of the file is still unseen and `write` is refused.
      await expect(write.execute('w', { path: 'A.md', content: 'new' })).rejects.toThrow(READ_FIRST)
      start = lines[1] + 1
      if (reads > 100) throw new Error('never reached the end')
    }
    // The last window closed the gap: the view is whole now, so `write` is let through.
    expect(reads).toBeGreaterThan(2)
    expect(guard.view('A.md')?.lines).toBeUndefined()
    await write.execute('w2', { path: 'A.md', content: 'new' })
    expect(await app.vault.read(app.vault.getAbstractFileByPath('A.md') as TFile)).toBe('new')
  })

  it('is whole for a script, however long', async () => {
    useVault([{ path: 'A.md', content: long.join('\n') }])
    const r = await createReadFileTool({ skipScope: true }).execute('1', { path: 'A.md' })
    expect(r.content[0].text).toBe(long.join('\n'))
    expect(r.seen!.lines).toBeUndefined()
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
