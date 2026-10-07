import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import type { ChatSession } from '@/ai/ChatSession'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import * as links from '@/ai/chatNoteLinks'
import * as opening from '@/ai/openChat'
import { ChatStorage } from '@/ai/ChatStorage'

vi.mock('@/components/obsidian/Modal.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@/components/ChatPicture.vue', () => ({
  default: { props: ['path', 'chatId', 'version'], template: '<button>Preview</button>' },
}))
let app: ReturnType<typeof useVault>
let session: ChatSession
let view: VueWrapper | undefined
const mountView = () => (view = mount(ChatArtifacts, { props: { session } }))
beforeEach(() => {
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
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})
const press = async (text: string) => {
  const button = view!.findAll('button').find((b) => b.text() === text)
  expect(button, text).toBeDefined()
  await button!.trigger('click')
}
describe('chat artifacts dialog', () => {
  it('shows all sections, attachment controls and scripts while execution is disabled', () => {
    mountView()
    expect(view!.findAll('h3').map((h) => h.text())).toEqual([
      'Notes (1)',
      'Images (1)',
      'Scripts (1)',
    ])
    expect(view!.text()).toContain('Attach to current note')
    expect(view!.text()).toContain('Attach to a note…')
    expect(view!.text()).toContain('sample.js')
  })
  it('isolates unlink from opening and never deletes files', async () => {
    const unlink = vi.spyOn(links, 'detachNote').mockResolvedValue(true)
    const open = vi.spyOn(opening, 'openVaultFile').mockResolvedValue()
    mountView()
    await press('Unlink')
    expect(unlink).toHaveBeenCalledWith('Chats/sample.abchat', 'Notes/sample.md')
    expect(open).not.toHaveBeenCalled()
    expect(app.vault.getAbstractFileByPath('Notes/sample.md')).not.toBeNull()
    await press('Open')
    expect(open).toHaveBeenCalledWith('Notes/sample.md')
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
    expect(view!.findAll('h3').map((h) => h.text())).toEqual([
      'Notes (0)',
      'Images (2)',
      'Scripts (0)',
    ])
    expect(view!.text()).toContain('Unavailable')
    expect(app.stats.read).toBe(0)
    await press('Show in chat')
    expect(view!.emitted('reveal')?.[0]).toEqual(['image'])
  })
  it('keeps missing links unlinkable and source navigation available', async () => {
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
    const card = view!.findAll('.abele-card')[0]
    expect(card.text()).toContain('Unavailable')
    expect(
      card
        .findAll('button')
        .find((b) => b.text() === 'Open')!
        .attributes('disabled')
    ).toBeDefined()
    expect(
      card
        .findAll('button')
        .find((b) => b.text() === 'Unlink')!
        .attributes('disabled')
    ).toBeUndefined()
  })
  it('disables only attachment mutations without a saved indexed chat', () => {
    session.currentChatFile.value = null
    mountView()
    const buttons = view!.findAll('button')
    expect(
      buttons.find((b) => b.text() === 'Attach to a note…')!.attributes('disabled')
    ).toBeDefined()
    expect(buttons.find((b) => b.text() === 'Open')!.attributes('disabled')).toBeUndefined()
  })
  it('subscribes to availability events, ignores unrelated files, and disposes on close', async () => {
    const on = vi.spyOn(app.vault, 'on')
    const off = vi.spyOn(app.vault, 'offref')
    session.touched.value.push({ path: 'Notes/later.md', at: '2025-01-01' })
    mountView()
    expect(on.mock.calls.map((c) => c[0])).toEqual(['create', 'modify', 'rename', 'delete'])
    const created = await app.vault.create('Notes/later.md', '')
    app.emit('vault', 'create', created)
    await nextTick()
    expect(view!.text()).not.toContain('Unavailable')
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
