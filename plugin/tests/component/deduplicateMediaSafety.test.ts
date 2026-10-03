import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import DeduplicateMediaModal from '@/components/DeduplicateMediaModal.vue'
import { buildFakeVault } from '../helpers/fakeVault'
import { GlobalStore } from '@/stores/GlobalStore'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})
async function open(
  options: {
    text?: string
    links?: [string, string][]
    bytes?: number[][]
    extra?: Parameters<typeof buildFakeVault>[0]
  } = {}
) {
  const app = buildFakeVault([
    { path: 'sample-note.md', content: options.text ?? '' },
    { path: 'media/sample-keep.png' },
    { path: 'media/sample-copy.png' },
    ...(options.extra ?? []),
  ])
  const vault = app.vault as any
  const files = ['media/sample-keep.png', 'media/sample-copy.png'].map((p) =>
    vault.getAbstractFileByPath(p)
  )
  for (let i = 0; i < 2; i++) {
    const bytes = new Uint8Array(options.bytes?.[i] ?? [1, 2, 3]).buffer
    await vault.modifyBinary(files[i], bytes)
    files[i].stat.size = bytes.byteLength
  }
  // Keep choice is pinned independently of the references to be rewritten.
  app.metadataCache.resolvedLinks['sample-keep-ref.md'] = { 'media/sample-keep.png': 1 }
  app.metadataCache.resolvedLinks['sample-other-ref.md'] = { 'media/sample-keep.png': 1 }
  const note = vault.getAbstractFileByPath('sample-note.md')
  const cache = app.metadataCache.getFileCache(note) as any
  cache.links = (options.links ?? []).map(([original, link]) => {
    const start = (options.text ?? '').indexOf(original)
    return {
      original,
      link,
      position: { start: { offset: start }, end: { offset: start + original.length } },
    }
  })
  ;(GlobalStore.getInstance() as any)._app = app
  const wrapper = mount(DeduplicateMediaModal, {
    shallow: true,
    global: {
      stubs: {
        ObsidianModal: { template: '<div><slot /></div>' },
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { app, vault, files, note, state: (wrapper.vm as any).$.setupState }
}

describe('deduplicate media safety', () => {
  it('includes AVIF files in the same byte-verified scan', async () => {
    const { state } = await open({
      extra: [
        { path: 'media/sample-first.avif', content: 'sample image bytes' },
        { path: 'media/sample-second.avif', content: 'sample image bytes' },
      ],
    })
    const avif = state.groups.find((group: any) =>
      group.files.some((file: any) => file.path.endsWith('.avif'))
    )
    expect(avif.files.map((file: any) => file.path)).toEqual([
      'media/sample-first.avif',
      'media/sample-second.avif',
    ])
    expect(avif.files.every((file: any) => file.mediaType === 'image')).toBe(true)
  })

  it('groups equal bytes, keeps the most referenced file and trashes the duplicates', async () => {
    const { state, files, vault } = await open()
    expect(state.groups).toHaveLength(1)
    expect(state.groups[0].files.map((f: any) => f.path)).toEqual(files.map((f: any) => f.path))
    expect(state.totalDuplicateSize).toBe('3 B')
    await state.mergeAll()
    expect(state.groups[0].status).toBe('done')
    expect(vault.getAbstractFileByPath(files[0].path)).not.toBeNull()
    expect(vault.getAbstractFileByPath(files[1].path)).toBeNull()
  })

  // BUG: FNV-1a is only a bucket key, not proof of equal bytes.
  it('does not group distinct bytes with the same short hash', async () => {
    const { state } = await open({
      bytes: [
        [191, 207, 58, 213, 46, 186, 59, 138],
        [135, 161, 0, 176, 188, 180, 123, 219],
      ],
    })
    expect(state.groups).toEqual([])
  })

  // BUG: media can change between the preview and the merge.
  it('never trashes a duplicate whose bytes changed after scanning', async () => {
    const { state, vault, files } = await open()
    await vault.modifyBinary(files[1], new Uint8Array([9, 8, 7]).buffer)
    await state.mergeAll()
    expect(state.groups[0].status).toBe('error')
    expect(vault.getAbstractFileByPath(files[1].path)).not.toBeNull()
  })

  // BUG: raw substring replacement edits prose and longer filenames, and misses aliased links.
  it('rewrites only resolved parsed targets, preserving labels, fragments, titles and unrelated text', async () => {
    const links: [string, string][] = [
      ['![[sample-copy.png|120]]', 'sample-copy.png'],
      ['[[sample-copy#page=2|caption]]', 'sample-copy#page=2'],
      ['[caption](media/sample-copy.png "title")', 'media/sample-copy.png'],
      ['![alt](<media/sample-copy.png#page=3>)', 'media/sample-copy.png#page=3'],
      ['[[sample-copy]]', 'sample-copy'],
    ]
    const untouched =
      'Prose media/sample-copy.png and media/sample-copy.png.backup; `[[sample-copy]]`\n![[other/sample-copy.png]]'
    const text = links.map(([s]) => s).join('\n') + '\n' + untouched
    const { state, vault, note } = await open({
      text,
      links,
      extra: [{ path: 'other/sample-copy.png', content: 'different bytes' }],
    })
    // The basename-only links are explicitly resolved as Obsidian does in this source folder.
    const originalResolve = GlobalStore.getInstance().app.metadataCache.getFirstLinkpathDest.bind(
      GlobalStore.getInstance().app.metadataCache
    )
    vi.spyOn(
      GlobalStore.getInstance().app.metadataCache,
      'getFirstLinkpathDest'
    ).mockImplementation((target, source) =>
      target === 'sample-copy' || target === 'sample-copy.png'
        ? vault.getAbstractFileByPath('media/sample-copy.png')
        : originalResolve(target, source)
    )
    await state.mergeAll()
    expect(await vault.read(note)).toBe(
      [
        '![[media/sample-keep.png|120]]',
        '[[media/sample-keep.png#page=2|caption]]',
        '[caption](media/sample-keep.png "title")',
        '![alt](<media/sample-keep.png#page=3>)',
        '[[media/sample-keep.png]]',
        untouched,
      ].join('\n')
    )
    expect(state.groups[0].status).toBe('done')
  })

  // BUG: a merge must not leave a chat pointing at a trashed attachment.
  it('refuses to delete media referenced in a format it cannot safely rewrite', async () => {
    const { state, vault, files } = await open({
      extra: [{ path: 'sample-chat.abchat', content: '{"attachments":["media/sample-copy.png"]}' }],
    })
    await state.mergeAll()
    expect(vault.getAbstractFileByPath(files[1].path)).not.toBeNull()
    expect(state.groups[0].status).toBe('error')
  })

  // BUG: references can appear while the merge's note writes are in flight.
  it('keeps the duplicate if a chat starts using it while note links are rewritten', async () => {
    const text = '![[media/sample-copy.png]]'
    const { state, vault, files } = await open({ text, links: [[text, 'media/sample-copy.png']] })
    const process = vault.process.bind(vault)
    vi.spyOn(vault, 'process').mockImplementation(async (...args: any[]) => {
      const value = await process(...args)
      await vault.create('sample-new-chat.abchat', '{"attachments":["media/sample-copy.png"]}')
      return value
    })
    await state.mergeAll()
    expect(vault.getAbstractFileByPath(files[1].path)).not.toBeNull()
    expect(state.groups[0].status).toBe('error')
  })

  it('keeps escaped label delimiters separate from the Markdown target', async () => {
    const text = '[sample \\](caption](media/sample-copy.png)'
    const { state, vault, note } = await open({ text, links: [[text, 'media/sample-copy.png']] })
    await state.mergeAll()
    expect(await vault.read(note)).toBe('[sample \\](caption](media/sample-keep.png)')
    expect(state.groups[0].status).toBe('done')
  })

  it('refuses stale parsed offsets instead of editing unrelated text', async () => {
    const text = '![[media/sample-copy.png]]'
    const { state, vault, note, files } = await open({
      text,
      links: [[text, 'media/sample-copy.png']],
    })
    await vault.modify(note, 'New paragraph\n' + text)
    await state.mergeAll()
    expect(await vault.read(note)).toBe('New paragraph\n' + text)
    expect(vault.getAbstractFileByPath(files[1].path)).not.toBeNull()
    expect(state.groups[0].status).toBe('error')
  })

  it('keeps duplicates referenced by HTML or plain frontmatter properties', async () => {
    const { state, vault, files } = await open({
      text: '---\ncover: media/sample-copy.png\n---\n<img src="media/sample-copy.png">',
    })
    await state.mergeAll()
    expect(state.groups[0].status).toBe('error')
    expect(vault.getAbstractFileByPath(files[1].path)).not.toBeNull()
  })

  it('does not trash files if a note write fails', async () => {
    const text = '![[media/sample-copy.png]]'
    const { state, vault, files } = await open({ text, links: [[text, 'media/sample-copy.png']] })
    vi.spyOn(vault, 'modify').mockRejectedValue(new Error('sample failure'))
    vi.spyOn(vault, 'process').mockRejectedValue(new Error('sample failure'))
    await state.mergeAll()
    expect(state.groups[0].status).toBe('error')
    expect(vault.getAbstractFileByPath(files[1].path)).not.toBeNull()
  })
})
