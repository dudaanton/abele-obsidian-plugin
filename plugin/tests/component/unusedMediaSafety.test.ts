import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import UnusedMediaModal from '@/components/UnusedMediaModal.vue'
import { buildFakeVault } from '../helpers/fakeVault'
import { GlobalStore } from '@/stores/GlobalStore'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})
async function open(specs: Parameters<typeof buildFakeVault>[0]) {
  const app = buildFakeVault(specs)
  ;(GlobalStore.getInstance() as any)._app = app
  const wrapper = mount(UnusedMediaModal, {
    shallow: true,
    global: {
      stubs: {
        ObsidianModal: { template: '<div><slot /></div>' },
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { app, state: (wrapper.vm as any).$.setupState }
}

describe('unused media safety', () => {
  it('keeps resolved links, HTML attributes and nested properties; lists only media largest first', async () => {
    const { state, app } = await open([
      {
        path: 'sample-note.md',
        content: '![[sample-linked.png]] <img src="sample-html.png">',
        frontmatter: { cover: { values: ['sample-property.png'] } },
      },
      ...['linked', 'html', 'property', 'orphan'].map((n) => ({ path: `sample-${n}.png` })),
      { path: 'sample-other.txt' },
    ])
    expect(state.items.map((i: any) => i.path)).toEqual(['sample-orphan.png'])
    await state.deleteAll()
    expect(state.items[0].status).toBe('deleted')
    expect(app.vault.getAbstractFileByPath('sample-orphan.png')).toBeNull()
    expect(app.vault.getAbstractFileByPath('sample-linked.png')).not.toBeNull()
  })

  // BUG: the resolved Markdown index contains no chat or structured-file attachments.
  it('keeps attachments in log chats, legacy chats, canvases, bases and JSON sidecars', async () => {
    const sources = [
      {
        path: 'sample-log.abchat',
        content: '{"v":2,"k":"meta"}\n{"k":"msg","attachments":["sample-log.png"]}\n',
      },
      {
        path: 'sample-legacy.json',
        content: JSON.stringify({ messages: [{ attachments: ['sample-legacy.png'] }] }),
      },
      {
        path: 'sample-board.canvas',
        content: JSON.stringify({ nodes: [{ file: 'sample-board.png' }] }),
      },
      { path: 'sample-view.base', content: 'cover: sample-view.png\n' },
      {
        path: 'sample-sidecar.json',
        content: JSON.stringify({ nested: { image: '![[sample-sidecar.png|100]]' } }),
      },
    ]
    const { state } = await open([
      ...sources,
      ...['log', 'legacy', 'board', 'view', 'sidecar'].map((n) => ({ path: `sample-${n}.png` })),
    ])
    expect(state.items).toEqual([])
  })

  // BUG: a scan result is not proof that an attachment is still unused at deletion time.
  it('rechecks usage before trashing a previewed orphan', async () => {
    const { state, app } = await open([{ path: 'sample-orphan.png' }])
    await (app.vault as any).create('sample-chat.abchat', '{"attachments":["sample-orphan.png"]}')
    await state.deleteAll()
    expect(app.vault.getAbstractFileByPath('sample-orphan.png')).not.toBeNull()
    expect(state.items[0].status).toBe('error')
  })

  it('fails closed on unreadable structured data rather than offering its attachments for deletion', async () => {
    const { state } = await open([
      { path: 'sample-torn.abchat', content: '{"attachments":[' },
      { path: 'sample-orphan.png' },
    ])
    expect(state.items).toEqual([])
    expect(state.scanError).toContain('Scan failed')
  })

  it('keeps media referenced by balanced Markdown targets inside chat text', async () => {
    const { state } = await open([
      {
        path: 'sample-chat.abchat',
        content: JSON.stringify({ content: '![sample](sample-image(1).png)' }),
      },
      { path: 'sample-image(1).png' },
    ])
    expect(state.items).toEqual([])
  })

  it('shows trash errors instead of claiming deletion', async () => {
    const { state, app } = await open([{ path: 'sample-orphan.pdf' }])
    vi.spyOn(app.fileManager as any, 'trashFile').mockRejectedValue(new Error('sample failure'))
    await state.deleteAll()
    expect(state.items[0]).toMatchObject({ status: 'error', error: 'sample failure' })
  })
})
