import { describe, expect, it, vi } from 'vitest'
import { followNoteRename } from '@/drawing/noteRenames'
import { drawingSvg, parseDrawingSvg } from '@/drawing/drawingFile'
import type { TFile } from 'obsidian'
import { useVault } from '../helpers/testEnv'

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
