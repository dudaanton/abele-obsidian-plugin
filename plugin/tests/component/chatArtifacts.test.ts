import { catalogs as testCatalogs } from '@/i18n/catalogs'
import { initializeLocale } from '@/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { Menu, type MenuItem } from 'obsidian'
import ListSectionHeader from '@/components/obsidian/ListSectionHeader.vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import type { ChatSession } from '@/ai/ChatSession'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import * as links from '@/ai/chatNoteLinks'
import * as opening from '@/ai/openChat'
import { ChatStorage } from '@/ai/ChatStorage'

vi.mock('@/components/obsidian/Modal.vue', () => ({
  default: { template: '<div><slot /><slot name="footer" /></div>' },
}))
vi.mock('@/components/ChatPicture.vue', () => ({
  default: { props: ['path', 'chatId', 'version'], template: '<button>Preview</button>' },
}))
let app: ReturnType<typeof useVault>
let session: ChatSession
let view: VueWrapper | undefined
const mountView = () => (view = mount(ChatArtifacts, { props: { session } }))
beforeEach(() => {
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  app = useVault([
    { path: 'Notes/sample.md' },
    { path: 'Scripts/sample.js' },
    { path: 'Pictures/sample.png' },
  ])
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    scriptsFolder: 'Scripts',
    scriptsEnabled: false,
    chatHistory: [{ path: 'Chats/sample.abchat', title: 'Sample', created: '2025-01-01' }],
  }
  ChatStorage.destroy()
  session = {
    id: 'sample',
    currentChatFile: ref({ path: 'Chats/sample.abchat' }),
    touched: ref([
      { path: 'Notes/sample.md', at: '2025-01-01' },
      { path: 'Scripts/sample.js', at: '2025-01-01' },
    ]),
    allMessages: ref([
      {
        id: 'image',
        role: 'user',
        content: '',
        timestamp: 1,
        attachments: ['Pictures/sample.png'],
      },
    ]),
  } as unknown as ChatSession
})
afterEach(() => {
  initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})
const headers = () =>
  view!.findAllComponents(ListSectionHeader).map((h) => `${h.props('text')} (${h.props('count')})`)
const row = (path: string) => view!.find(`.abele-chat-artifacts__row [data-path="${path}"]`)
/** Opens a row's ⋯ menu and hands back what it holds. */
const menuOf = async (target: ReturnType<VueWrapper['find']>, how: 'more' | 'contextmenu') => {
  const spy = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  if (how === 'more') await target.find('.abele-chat-artifacts__more').trigger('click')
  else await target.trigger('contextmenu')
  const shown = spy.mock.contexts.at(-1) as Menu | undefined
  spy.mockRestore()
  expect(shown, 'menu shown').toBeDefined()
  return shown!.items as (MenuItem & { disabled: boolean; warning: boolean })[]
}
const item = (items: Awaited<ReturnType<typeof menuOf>>, title: string) =>
  items.find((i) => i.title === title)
describe('chat artifacts dialog', () => {
  it('opens saved diffs from compact native file rows', async () => {
    session.allMessages.value.push({
      id: 'change-row',
      role: 'tool-call',
      content: '',
      timestamp: 2,
      toolName: 'edit',
      toolStatus: 'approved',
      toolParams: { path: 'Notes/sample.md' },
      toolResult: 'Edited',
      toolDiff: { old: 'Before', new: 'After' },
    })
    mountView()
    const change = view!.find('.abele-chat-artifacts__changes [data-path="Notes/sample.md"]')
    expect(change.exists()).toBe(true)
    expect(change.find('.abele-tree-item__where').text()).toBe('Notes')
    await change.trigger('click')
    expect(view!.find('.abele-chat-artifacts__changes').text()).toContain('Before')
    expect(view!.find('.abele-chat-artifacts__changes').text()).toContain('After')
  })
  it('keeps created hidden files visible while they exist on disk', async () => {
    await app.vault.adapter.write('Notes/.sample-config', 'Sample')
    session.touched.value.push({ path: 'Notes/.sample-config', at: '2025-01-01' })
    session.allMessages.value.push({
      id: 'hidden',
      role: 'tool-call',
      content: '',
      timestamp: 2,
      toolName: 'create',
      toolStatus: 'approved',
      toolParams: { path: 'Notes/.sample-config' },
      toolResult: 'Created: Notes/.sample-config',
      toolDiff: { old: '', new: 'Sample' },
    })
    mountView()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view!.text()).toContain('.sample-config')
    expect(
      view!.find('.abele-chat-artifacts__changes [data-path="Notes/.sample-config"]').exists()
    ).toBe(true)
  })
  it('shows actual changes and drops a missing file created by this chat', async () => {
    session.touched.value.push({ path: 'Notes/gone.md', at: '2025-01-01' })
    session.allMessages.value.push({
      id: 'created',
      role: 'tool-call',
      content: '',
      timestamp: 2,
      toolName: 'create',
      toolStatus: 'approved',
      toolParams: { path: 'Notes/gone.md' },
      toolResult: 'Created: Notes/gone.md',
      toolDiff: { old: '', new: 'Gone' },
    })
    session.allMessages.value.push({
      id: 'edited',
      role: 'tool-call',
      content: '',
      timestamp: 3,
      toolName: 'edit',
      toolStatus: 'approved',
      toolParams: { path: 'Notes/sample.md' },
      toolResult: 'Edited',
      toolDiff: { old: 'Before', new: 'After' },
    })
    mountView()
    await nextTick()
    expect(
      view!.find('.abele-chat-artifacts__changes [data-path="Notes/sample.md"]').exists()
    ).toBe(true)
    expect(view!.find('.abele-chat-artifacts__changes [data-path="Notes/gone.md"]').exists()).toBe(
      false
    )
    expect(
      view!.findAll('.abele-chat-artifacts__row').some((row) => row.text().includes('gone'))
    ).toBe(false)
  })
  it('shows all sections, attachment controls and scripts while execution is disabled', () => {
    mountView()
    expect(headers()).toEqual(['Notes (1)', 'Images (1)', 'Scripts (1)'])
    expect(view!.text()).toContain('Attach current note')
    expect(view!.text()).toContain('Attach a note…')
    expect(view!.text()).toContain('sample.js')
  })
  it('says so, rather than showing empty sections, when the chat has nothing', () => {
    session.touched.value = []
    session.allMessages.value = []
    mountView()
    expect(headers()).toEqual([])
    expect(view!.text()).toContain('Nothing from this chat yet')
  })
  it('isolates unlink from opening and never deletes files', async () => {
    const unlink = vi.spyOn(links, 'detachNote').mockResolvedValue(true)
    const open = vi.spyOn(opening, 'openVaultFile').mockResolvedValue()
    mountView()
    const items = await menuOf(row('Notes/sample.md'), 'more')
    const unlinkItem = item(items, 'Unlink from chat')!
    expect(unlinkItem).toMatchObject({ section: 'danger', warning: true, disabled: false })
    unlinkItem.handler!()
    expect(unlink).toHaveBeenCalledWith('Chats/sample.abchat', 'Notes/sample.md')
    expect(open).not.toHaveBeenCalled()
    expect(app.vault.getAbstractFileByPath('Notes/sample.md')).not.toBeNull()
    await row('Notes/sample.md').trigger('click')
    expect(open).toHaveBeenCalledWith('Notes/sample.md')
  })
  it('opens the same menu on a right click, and says what the chat did to the file', async () => {
    mountView()
    const glyph = row('Notes/sample.md').find('.abele-tree-item__end .abele-obsidian-icon')
    expect(glyph.attributes('aria-hidden')).toBe('true')
    expect(
      row('Notes/sample.md').find('.abele-chat-artifacts__more').attributes('aria-label')
    ).toBe('More for sample')
    const items = await menuOf(row('Notes/sample.md'), 'contextmenu')
    expect(items.map((i) => i.title)).toEqual(['Reveal in explorer', 'Unlink from chat'])
  })
  it('updates in place without reading note or script bodies', async () => {
    mountView()
    app.resetStats()
    session.touched.value = []
    session.allMessages.value.push({
      id: 'missing',
      role: 'user',
      content: '',
      timestamp: 2,
      attachments: ['Pictures/missing.png'],
    })
    await nextTick()
    expect(headers()).toEqual(['Images (1)'])
    const tiles = view!.findAll('.abele-chat-artifacts__image')
    expect(tiles).toHaveLength(1)
    expect(app.stats.read).toBe(0)
    const items = await menuOf(tiles[0], 'contextmenu')
    expect(item(items, 'Unlink from chat')).toBeUndefined()
    item(items, 'Show in chat')!.handler!()
    expect(view!.emitted('reveal')?.[0]).toEqual(['image'])
  })
  // The file list now describes files that exist; historical links and source messages stay saved.
  it('omits missing files without deleting their links or source evidence', async () => {
    const open = vi.spyOn(opening, 'openVaultFile').mockResolvedValue()
    session.touched.value = [{ path: 'Notes/missing.md', at: '2025-01-01' }]
    session.allMessages.value.push({
      id: 'change',
      role: 'tool-call',
      content: '',
      timestamp: 2,
      toolName: 'edit',
      toolStatus: 'approved',
      toolParams: { path: 'Notes/missing.md' },
      toolDiff: { old: 'a', new: 'b' },
      toolResult: 'Edited',
    })
    mountView()
    expect(view!.findAll('.abele-chat-artifacts__row')).toHaveLength(0)
    expect(open).not.toHaveBeenCalled()
    expect(session.touched.value).toEqual([{ path: 'Notes/missing.md', at: '2025-01-01' }])
    expect(session.allMessages.value.some((message) => message.id === 'change')).toBe(true)
  })
  it('disables only attachment mutations without a saved indexed chat', async () => {
    const open = vi.spyOn(opening, 'openVaultFile').mockResolvedValue()
    const unlink = vi.spyOn(links, 'detachNote').mockResolvedValue(true)
    session.currentChatFile.value = null
    mountView()
    const buttons = view!.findAll('button')
    const attach = buttons.find((b) => b.text() === 'Attach a note…')!
    expect(attach.attributes('disabled')).toBeDefined()
    expect(attach.attributes('aria-label')).toBe('Save the chat first')
    expect(
      buttons.find((b) => b.text() === 'Attach current note')!.attributes('disabled')
    ).toBeDefined()
    const items = await menuOf(row('Notes/sample.md'), 'more')
    expect(item(items, 'Unlink from chat')!.disabled).toBe(true)
    item(items, 'Unlink from chat')!.handler!()
    expect(unlink).not.toHaveBeenCalled()
    await row('Notes/sample.md').trigger('click')
    expect(open).toHaveBeenCalledWith('Notes/sample.md')
  })
  it('subscribes to availability events, ignores unrelated files, and disposes on close', async () => {
    const on = vi.spyOn(app.vault, 'on')
    const off = vi.spyOn(app.vault, 'offref')
    session.touched.value.push({ path: 'Notes/later.md', at: '2025-01-01' })
    mountView()
    expect(on.mock.calls.map((c) => c[0])).toEqual(['create', 'modify', 'rename', 'delete'])
    expect(row('Notes/later.md').exists()).toBe(false)
    const created = await app.vault.create('Notes/later.md', '')
    app.emit('vault', 'create', created)
    await nextTick()
    expect(row('Notes/later.md').exists()).toBe(true)
    view!.unmount()
    view = undefined
    expect(off).toHaveBeenCalledTimes(4)
  })
  it('closes instead of silently retargeting on a session change', async () => {
    const active = shallowRef(session)
    view = mount(
      defineComponent({ setup: () => () => h(ChatArtifacts, { session: active.value }) })
    )
    const dialog = view.findComponent(ChatArtifacts)
    active.value = { ...session, id: 'other' } as ChatSession
    await nextTick()
    expect(dialog.props('session').id).toBe('other')
    expect(dialog.emitted('close')).toHaveLength(1)
  })
})

it('keeps image rendering and readable path rows when section labels are translated', () => {
  initializeLocale('ru', testCatalogs['ru' as keyof typeof testCatalogs])
  mountView()
  expect(view!.findAll('.abele-chat-artifacts__images button')).toHaveLength(1)
  expect(row('Notes/sample.md').find('.abele-tree-item__where').text()).toBe('Notes')
})
