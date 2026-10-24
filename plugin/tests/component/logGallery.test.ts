import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { posix } from 'node:path'
import { MarkdownRenderer } from 'obsidian'
import LogView from '@/components/Log.vue'
import GalleryView from '@/components/Gallery.vue'
import { Log } from '@/entities/Log'
import { galleryPostProcessor } from '@/editor/galleryPostProcessor'
import { parseImageLine } from '@/helpers/galleryUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, useVault } from '../helpers/testEnv'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>()
  return {
    ...actual,
    Menu: class extends actual.Menu {
      unload() {}
    },
  }
})

afterEach(() => {
  VaultWatcherWrapper.destroy()
  resetFakeIntersectionObservers()
  vi.restoreAllMocks()
})

it.each([
  '![[sample.png]]',
  '![[Media/sample.png]]',
  '![sample](Media/sample.png)',
  '![sample](../Entries/Media/sample.png)',
])('renders a log gallery against its own note: %s', async (embed) => {
  const path = 'Entries/Sample.md'
  const text = `Sample [[Overview]].\n::abele-gallery::\n\n${embed}`
  const app = useVault([
    { path, content: text },
    { path: 'Entries/Media/sample.png' },
    { path: 'Overview.md' },
  ])
  configureAbele()
  Object.assign(app.vault, { getResourcePath: (file: { path: string }) => `app:///${file.path}` })
  // The fake vault handles vault links; Obsidian also normalizes explicit relative links.
  const resolve = app.metadataCache.getFirstLinkpathDest.bind(app.metadataCache)
  vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation((link, source) =>
    link.startsWith('.')
      ? app.vault.getFileByPath(posix.join(posix.dirname(source), link))
      : resolve(link, source)
  )
  installFakeIntersectionObserver()
  const store = GlobalStore.getInstance()
  store.galleriesContainers.value.splice(0)
  // Supply embed markup at the renderer boundary, then run the real processor and gallery.
  const render = vi
    .spyOn(MarkdownRenderer, 'render')
    .mockImplementation(async (_app, md, el, sourcePath, owner) => {
      if (!md.includes('::abele-gallery::')) return
      const p = el.createEl('p')
      p.append('::abele-gallery::')
      p.createEl('br')
      const entry = md.split('\n').map(parseImageLine).find(Boolean)
      if (entry) p.createSpan({ cls: 'internal-embed', attr: { src: entry.path } })
      galleryPostProcessor(el, {
        sourcePath,
        getSectionInfo: () => null,
        addChild: (child) => owner.addChild(child),
      } as Parameters<typeof galleryPostProcessor>[1])
    })
  const log = reactive(new Log(path, 'Overview.md')) as Log
  const wrapper = mount(LogView, { props: { log } })
  let galleryView: ReturnType<typeof mount> | undefined
  try {
    await flushPromises()
    expect(scrollIntoView(wrapper.element)).toBe(1)
    await flushPromises()
    await vi.waitFor(() => expect(store.galleriesContainers.value).toHaveLength(1))
    expect(log.content).toBe(text)
    expect(render.mock.calls.find((call) => call[1] === text)?.[3]).toBe(path)
    expect(store.galleriesContainers.value).toHaveLength(1)
    const gallery = store.galleriesContainers.value[0]
    expect(gallery.filePath).toBe(path)
    galleryView = mount(GalleryView, { props: { gallery } })
    expect(galleryView.text()).not.toContain('No pictures yet')
    expect(galleryView.get('img').attributes('src')).toBe('app:///Entries/Media/sample.png?0-0')
  } finally {
    galleryView?.unmount()
    wrapper.unmount()
    log.cleanup()
  }
})
