import { describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { prepareHighlightRepairs, repairHighlightLinks } from '@/reader/companion'

const cfi = (n: number) => `epubcfi(/6/2!/4/${n}:1)`
const entry = (n: number, book = 'sample.epub') => `> [!quote] [[${book}#cfi=/6/2!/4/${n}:1|Part]]\r\n> Fake quoted text.\r\n>\r\n> Comment  with spaces.`
const book = new TFile()
book.path = 'sample.epub'
book.basename = 'sample'
const where = { title: 'Sample', author: '', target: { to: 'note' as const, path: 'notes.md', template: '', alsoIn: ['older.md'] } }
function vault(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes).map(([path, text]) => { const file = new TFile(); file.path = path; file.name = path; file.extension = 'md'; return [path, { file, text }] as const }))
  const process = vi.fn(async (f: TFile, fn: (md: string) => string) => { const item = files.get(f.path)!; item.text = fn(item.text); return item.text })
  const app = { vault: { getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null, getMarkdownFiles: () => [...files.values()].map((x) => x.file), cachedRead: async (f: TFile) => files.get(f.path)!.text, read: async (f: TFile) => files.get(f.path)!.text, process }, metadataCache: { getFileCache: () => ({}), getFirstLinkpathDest: (path: string) => path === book.path ? book : null } } as unknown as App
  return { app, process, files }
}
const request = (n: number, to: number) => ({ cfi: cfi(n), text: 'Fake quoted text.', suggested: cfi(to), label: 'Part', context: { pre: '', match: 'Fake quoted text.', post: '' }, anchored: true })

describe('repair in the original source note', () => {
  it('does not create or rewrite the current target, and preserves concurrent comments', async () => {
    const v = vault({ 'notes.md': 'Other notes.', 'older.md': entry(2) })
    const prepared = await prepareHighlightRepairs(v.app, book, where, [request(2, 4)])
    expect(v.process).not.toHaveBeenCalled()
    v.files.get('older.md')!.text += '\r\nExtra comment.'
    const result = await repairHighlightLinks(v.app, book, where, prepared)
    expect(result).toEqual({ applied: [cfi(2)], skipped: [], failed: [] })
    expect(v.process).toHaveBeenCalledTimes(1)
    expect(v.files.get('older.md')!.text).toBe(entry(2).replace('/4/2:1|Part', '/4/4:1|Part') + '\r\nExtra comment.')
    expect(v.files.get('notes.md')!.text).toBe('Other notes.')
  })
  it('groups a batch by source and reports a failed note without rolling back a successful note', async () => {
    const v = vault({ 'notes.md': `${entry(2)}\n\n${entry(6)}`, 'older.md': entry(10) })
    const prepared = await prepareHighlightRepairs(v.app, book, where, [request(2, 4), request(6, 8), request(10, 12)])
    v.process.mockImplementationOnce(async () => { throw new Error('read-only source') })
    const result = await repairHighlightLinks(v.app, book, where, prepared)
    expect(result).toEqual({ applied: [cfi(10)], skipped: [], failed: [cfi(2), cfi(6)] })
    expect(v.process).toHaveBeenCalledTimes(2)
    expect(v.files.get('notes.md')!.text).toBe(`${entry(2)}\n\n${entry(6)}`)
    expect(v.files.get('older.md')!.text).toBe(entry(10).replace('/4/10:1|Part', '/4/12:1|Part'))
  })

  it('skips changed quote or a duplicate origin in another source', async () => {
    const v = vault({ 'notes.md': entry(2), 'older.md': entry(2) })
    const prepared = await prepareHighlightRepairs(v.app, book, where, [request(2, 4)])
    expect(prepared).toEqual([])
    expect(v.process).not.toHaveBeenCalled()
  })
})
