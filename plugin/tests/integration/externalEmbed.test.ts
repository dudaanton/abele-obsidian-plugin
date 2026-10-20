import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { sha256 } from '@abele/sync-sdk/core'
import { Component, MarkdownRenderer } from 'obsidian'
import { externalFileFixture } from './externalFileFollowupFixture'
import {
  mountExternalEmbed,
  externalEmbedsInEditor,
  externalEmbedProcessor,
} from '@/sync/external/embed'
import { externalReadingEmbed, externalEditorEmbed } from '../e2e/helpers/externalFileSelectors'
import { routeExternalFiles, routeExternalLinks } from '@/sync/external/opening'

it.each([
  { mode: 'reading', preview: false },
  { mode: 'reading', preview: true },
  { mode: 'editor', preview: false },
  { mode: 'editor', preview: true },
])(
  'completes the native $mode embed (preview=$preview) and matches the live selector',
  async ({ mode, preview }) => {
    const s = await externalFileFixture(preview ? 'Media/sample.png' : 'Media/sample.pdf')
    const owner = new Component()
    const leaf = document.createElement('div')
    leaf.className = 'workspace-leaf mod-active'
    const surface = document.createElement('div')
    surface.className = mode === 'reading' ? 'markdown-reading-view' : 'markdown-source-view'
    const source = document.createElement('span')
    source.className = 'internal-embed'
    source.setAttribute('src', s.path)
    surface.append(source)
    leaf.append(surface)
    document.body.append(leaf)
    let editor: ReturnType<ReturnType<typeof externalEmbedsInEditor>> | undefined
    try {
      if (preview)
        s.app.saveLocalStorage('abele-external-previews-v1', {
          [s.head.sha]: { data: 'data:image/jpeg;base64,c2FtcGxl', saved: 1 },
        })
      await s.port.evict(s.path)
      owner.load()
      if (mode === 'reading') {
        externalEmbedProcessor(s.app as never)(surface, {
          sourcePath: 'sample-note.md',
          addChild: (child: Component) => owner.addChild(child),
        } as never)
      } else {
        editor = externalEmbedsInEditor(
          s.app as never,
          () => 'sample-note.md'
        )({ contentDOM: surface, dom: surface } as never)
      }
      const selector = mode === 'reading' ? externalReadingEmbed : externalEditorEmbed
      await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull())
      await flushPromises()
      // Native reading sections wait for every internal embed, including nested ones.
      expect(surface.querySelectorAll('.internal-embed:not(.is-loaded)')).toHaveLength(0)
      if (preview) expect(document.querySelector(selector)?.querySelector('img')).not.toBeNull()
      else expect(document.querySelector(selector)?.textContent).toContain('sample.pdf')
      expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
    } finally {
      editor?.destroy()
      owner.unload()
      leaf.remove()
      s.close()
    }
  }
)

it('marks an owned reading embed loaded while its original is intentionally absent', async () => {
  const s = await externalFileFixture('Media/sample.pdf')
  try {
    await s.port.evict(s.path)
    const el = document.createElement('span')
    el.className = 'internal-embed'
    el.setAttribute('src', s.path)
    const off = mountExternalEmbed(s.app as never, el, '', s.manager)
    await flushPromises()
    expect(el.classList.contains('is-loaded')).toBe(true)
    expect(el.querySelector('.abele-external-embed')).not.toBeNull()
    expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
    off()
    expect(el.classList.contains('is-loaded')).toBe(false)
  } finally {
    s.close()
  }
})

it('does not let a late native render replace a reused editor widget', async () => {
  const s = await externalFileFixture()
  const source = document.createElement('span')
  let release!: () => void
  const pause = new Promise<void>((resolve) => {
    release = resolve
  })
  const native = vi
    .spyOn(MarkdownRenderer, 'render')
    .mockImplementation(async (_app, _text, target) => {
      await pause
      target.textContent = 'old rendered attachment'
    })
  let off = () => {}
  try {
    await s.port.evict(s.path)
    source.setAttribute('src', s.path)
    off = mountExternalEmbed(s.app as never, source, '', s.manager)
    await s.manager.prepare([s.path])
    await vi.waitFor(() => expect(native).toHaveBeenCalled())
    off()
    source.setAttribute('src', 'Media/another.png')
    source.textContent = 'new widget'
    release()
    await flushPromises()
    expect(source.textContent).toBe('new widget')
  } finally {
    release()
    off()
    native.mockRestore()
    s.close()
  }
})

it('routes an owned explorer stub into the same leaf before native opening', async () => {
  const s = await externalFileFixture()
  try {
    await s.port.evict(s.path)
    const original = vi.fn(async () => {})
    const proto = { openFile: original }
    const setViewState = vi.fn(async () => {})
    const off = routeExternalFiles(s.app as never, s.manager, proto as never)
    await proto.openFile.call(
      { app: s.app, setViewState },
      s.app.vault.getFileByPath(s.path + '.abele-ref')
    )
    expect(original).not.toHaveBeenCalled()
    expect(setViewState).toHaveBeenCalledWith({
      type: 'abele-external-file',
      active: true,
      state: { path: s.path },
    })
    expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
    off()
  } finally {
    s.close()
  }
})

it.each(['png', 'mp4', 'pdf'])(
  'opens the offloaded %s row as a card without downloading',
  async (extension) => {
    const s = await externalFileFixture('Media/sample.' + extension)
    try {
      await s.port.evict(s.path)
      const source = document.createElement('span')
      source.setAttribute('src', s.path)
      const open = vi.fn()
      const off = mountExternalEmbed(s.app as never, source, '', s.manager, open)
      await flushPromises()
      ;(source.querySelector('.abele-external-embed_card') as HTMLElement).click()
      expect(open).toHaveBeenCalledWith(s.path)
      expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
      off()
    } finally {
      s.close()
    }
  }
)

it('mounts and cleans up native live-preview widgets without changing the editor document', async () => {
  const s = await externalFileFixture()
  try {
    await s.port.evict(s.path)
    const content = document.createElement('div')
    const embed = document.createElement('span')
    embed.className = 'internal-embed'
    embed.setAttribute('src', 'Media/sample.png')
    content.append(embed)
    const view = { contentDOM: content, dom: content }
    const live = externalEmbedsInEditor(s.app as never, () => 'sample-note.md')(view as never)
    await vi.waitFor(() =>
      expect(content.querySelector('.abele-external-embed_card')).not.toBeNull()
    )
    live.destroy()
    expect(content.querySelector('.abele-external-embed_card')).toBeNull()
    expect(content.querySelector('.internal-embed')?.getAttribute('src')).toBe(s.path)
    expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
  } finally {
    s.close()
  }
})

it('replaces a saved-preview embed with a native embed without rewriting or reloading its note', async () => {
  const s = await externalFileFixture()
  try {
    const preview = 'data:image/jpeg;base64,c2FtcGxl'
    s.app.saveLocalStorage('abele-external-previews-v1', {
      [s.head.sha]: { data: preview, saved: 1 },
    })
    await s.port.evict(s.path)
    await s.app.vault.create('sample-note.md', '![[Media/sample.png|240x120]]')
    const bytes = await s.app.vault.adapter.readBinary('sample-note.md')
    const source = document.createElement('span')
    source.className = 'internal-embed'
    source.setAttribute('src', 'Media/sample.png')
    source.setAttribute('width', '240')
    source.setAttribute('height', '120')
    document.body.append(source)
    const native = vi.spyOn(MarkdownRenderer, 'render')
    const open = vi.fn()
    const off = mountExternalEmbed(s.app as never, source, 'sample-note.md', s.manager, open)
    await flushPromises()
    expect(source.querySelector('img')?.getAttribute('src')).toBe(preview)
    source.querySelector('img')!.click()
    expect(open).not.toHaveBeenCalled()
    expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
    ;(source.querySelector('.abele-external-embed__plate') as HTMLElement).click()
    await vi.waitFor(() => expect(native).toHaveBeenCalled())
    expect(native.mock.calls.at(-1)?.[1]).toBe('![[Media/sample.png|240x120]]')
    expect(
      await sha256(new Uint8Array(await s.app.vault.adapter.readBinary('sample-note.md')))
    ).toBe(await sha256(new Uint8Array(bytes)))
    expect(await s.app.vault.adapter.read(s.path)).toBe('sample original bytes')
    off()
    source.remove()
    native.mockRestore()
  } finally {
    s.close()
  }
})

it('routes a missing original link to the card without downloading it', async () => {
  const s = await externalFileFixture('Media/sample.pdf')
  try {
    await s.port.evict(s.path)
    const setViewState = vi.fn(async () => {})
    Object.assign(s.app.workspace, { getLeaf: () => ({ setViewState }) })
    const off = routeExternalLinks(s.app as never, s.manager)
    await s.app.workspace.openLinkText(s.path, '', false)
    expect(setViewState).toHaveBeenCalledWith({
      type: 'abele-external-file',
      active: true,
      state: { path: s.path },
    })
    expect(await s.app.vault.adapter.exists(s.path)).toBe(false)
    off()
  } finally {
    s.close()
  }
})
