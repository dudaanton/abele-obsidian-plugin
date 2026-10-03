import { describe, expect, it, vi } from 'vitest'
import { followNoteRename } from '@/drawing/noteRenames'
import { drawingSvg, parseDrawingSvg } from '@/drawing/drawingFile'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const note = (id: string, path: string) => ({
  id,
  type: 'note' as const,
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  scale: 1,
  path,
})

describe('batched drawing note renames', () => {
  it.each(['cachedRead', 'process'] as const)(
    'continues queued renames after a deferred %s failure without replaying applied edits',
    async (operation) => {
      const items = [note('a', 'Notes/sample-a.md'), note('c', 'Notes/sample-c.md')]
      const app = Object.assign(
        useVault([
          { path: 'Drawings/applied.svg', content: drawingSvg({ items }) },
          { path: 'Drawings/broken.svg', content: drawingSvg({ items }) },
          { path: 'Drawings/unaffected.svg', content: drawingSvg({ items }) },
        ]),
        { workspace: { getLeavesOfType: () => [] as unknown[] } }
      )
      const session = {
        items: { items: [...items] },
        replaceItems: vi.fn((next: typeof items) => {
          session.items.items = session.items.items.map(
            (item) => next.find((replacement) => replacement.id === item.id) ?? item
          )
        }),
      }
      app.workspace.getLeavesOfType = () => [
        { view: { file: { path: 'Drawings/open.svg' }, session } },
      ]
      const failure = deferred<never>()
      const entered = deferred<void>()
      const vault = app.vault as unknown as {
        cachedRead(file: TFile): Promise<string>
        process(file: TFile, fn: (text: string) => string): Promise<string>
      }
      const original = vault[operation].bind(vault)
      let blocked = false
      const interceptor = vi.spyOn(vault, operation).mockImplementation((async (
        file: TFile,
        fn?: (text: string) => string
      ) => {
        if (file.path === 'Drawings/broken.svg' && !blocked) {
          blocked = true
          entered.resolve()
          return failure.promise
        }
        return operation === 'process'
          ? (original as typeof vault.process)(file, fn!)
          : (original as typeof vault.cachedRead)(file)
      }) as never)
      const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const first = followNoteRename(app as never, 'Notes/sample-a.md', 'Notes/sample-b.md')
        await entered.promise
        const second = followNoteRename(app as never, 'Notes/sample-c.md', 'Notes/sample-d.md')
        failure.reject(new Error('sample storage failure'))
        await Promise.allSettled([first, second])
        expect(session.items.items.map((item) => item.path)).toEqual([
          'Notes/sample-b.md',
          'Notes/sample-d.md',
        ])
        expect(session.replaceItems).toHaveBeenCalledTimes(2)
        for (const path of ['Drawings/applied.svg', 'Drawings/unaffected.svg']) {
          const data = parseDrawingSvg(
            await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)
          )
          expect(data?.items.map((item) => ('path' in item ? item.path : ''))).toEqual([
            'Notes/sample-b.md',
            'Notes/sample-d.md',
          ])
        }
        expect(reported).toHaveBeenCalledWith(
          expect.any(String),
          'Drawings/broken.svg',
          expect.objectContaining({ message: 'sample storage failure' })
        )
      } finally {
        interceptor.mockRestore()
        reported.mockRestore()
      }
    }
  )

  it('reads each drawing once and preserves every rename in a folder burst', async () => {
    const app = Object.assign(
      useVault([
        {
          path: 'Drawings/sample.svg',
          content: drawingSvg({
            items: [note('a', 'Notes/sample-a.md'), note('b', 'Notes/sample-b.md')],
          }),
        },
      ]),
      { workspace: { getLeavesOfType: () => [] } }
    )
    const scan = vi.spyOn(app.vault, 'getFiles')
    const read = vi.spyOn(app.vault, 'cachedRead')
    await Promise.all([
      followNoteRename(app as never, 'Notes/sample-a.md', 'Archive/sample-a.md'),
      followNoteRename(app as never, 'Notes/sample-b.md', 'Archive/sample-b.md'),
    ])
    const scans = scan.mock.calls.length,
      reads = read.mock.calls.length
    const result = parseDrawingSvg(
      await app.vault.read(app.vault.getAbstractFileByPath('Drawings/sample.svg') as TFile)
    )
    expect(result?.items.map((item) => ('path' in item ? item.path : ''))).toEqual([
      'Archive/sample-a.md',
      'Archive/sample-b.md',
    ])
    expect(scans).toBe(1)
    expect(reads).toBe(1)
  })

  it('preserves an edit arriving between the preliminary read and the rename write', async () => {
    const original = { items: [note('a', 'Notes/sample.md')] }
    const app = Object.assign(
      useVault([{ path: 'Drawings/sample.svg', content: drawingSvg(original) }]),
      { workspace: { getLeavesOfType: () => [] } }
    )
    const file = app.vault.getAbstractFileByPath('Drawings/sample.svg') as TFile
    const vault = app.vault as unknown as { modify(file: TFile, text: string): Promise<void> }
    vi.spyOn(app.vault, 'cachedRead').mockImplementationOnce(async () => {
      await vault.modify(
        file,
        drawingSvg({ items: [...original.items, note('b', 'Notes/new-card.md')] })
      )
      return drawingSvg(original)
    })
    await followNoteRename(app as never, 'Notes/sample.md', 'Archive/sample.md')
    const result = parseDrawingSvg(await app.vault.read(file))
    expect(result?.items.map((item) => ('path' in item ? item.path : ''))).toEqual([
      'Archive/sample.md',
      'Notes/new-card.md',
    ])
  })

  it('follows a chain of renames in order without changing an unrelated note', async () => {
    const app = Object.assign(
      useVault([
        {
          path: 'Drawings/sample.svg',
          content: drawingSvg({
            items: [note('a', 'Notes/sample.md'), note('b', 'Notes/other.md')],
          }),
        },
      ]),
      { workspace: { getLeavesOfType: () => [] } }
    )
    await Promise.all([
      followNoteRename(app as never, 'Notes/sample.md', 'Notes/intermediate.md'),
      followNoteRename(app as never, 'Notes/intermediate.md', 'Archive/sample.md'),
    ])
    const result = parseDrawingSvg(
      await app.vault.read(app.vault.getAbstractFileByPath('Drawings/sample.svg') as TFile)
    )
    expect(result?.items.map((item) => ('path' in item ? item.path : ''))).toEqual([
      'Archive/sample.md',
      'Notes/other.md',
    ])
  })
})
