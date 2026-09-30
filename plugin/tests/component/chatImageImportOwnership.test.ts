import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { fakeNoteEditors } from '../helpers/fakeNoteEditor'
import { TFile } from 'obsidian'
import AiChat from '@/components/AiChat.vue'
import AiChatInput from '@/components/AiChatInput.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

vi.mock('@/editor/embeddedEditor', () => import('../helpers/fakeNoteEditor'))
const convert = vi.hoisted(() => vi.fn())
const external = vi.hoisted(() => vi.fn())
vi.mock('@/ai/attachments', async (original) => ({ ...await original<any>(), importExternalFile: external }))
vi.mock('@/media/importImageFile', () => ({ imageFileForImport: convert, createImportedBinary: vi.fn() }))
let finish: (file: TFile) => void
let finishExternal: (file: TFile) => void
let source: TFile
let png: TFile
let service: ChatService
let a: ReturnType<typeof fakeChatSession>
let b: ReturnType<typeof fakeChatSession>
let wrapper: ReturnType<typeof mount>
beforeEach(async () => {
  const app = useVault([
    { path: 'Pictures/sample.heic', content: '' },
    { path: 'Pictures/sample.png', content: '' },
    { path: 'Pictures/sample-drawn.png', content: '' },
  ])
  source = app.vault.getAbstractFileByPath('Pictures/sample.heic') as TFile
  png = app.vault.getAbstractFileByPath('Pictures/sample.png') as TFile
  convert.mockReset().mockImplementation(() => new Promise<TFile>((resolve) => { finish = resolve }))
  external.mockReset().mockImplementation(() => new Promise<TFile>((resolve) => { finishExternal = resolve }))
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a', 'tab-b']
  service.activeTabId.value = 'tab-a'
  service.pendingInput.value = null
  a = fakeChatSession({ kind: 'chat', overrides: { conversationVersion: ref(0) } })
  b = fakeChatSession({ kind: 'chat', overrides: { conversationVersion: ref(0) } })
  a.sendMessage = vi.fn()
  b.sendMessage = vi.fn()
  a.scopeResolver.addFile = vi.fn()
  b.scopeResolver.addFile = vi.fn()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockImplementation(() => ({ value: service.activeTabId.value === 'tab-a' ? a : b }) as never)
  vi.spyOn(service, 'getSession').mockImplementation((id) => (id === 'tab-a' ? a : id === 'tab-b' ? b : undefined) as never)
  wrapper = mount(AiChat, { attachTo: document.body, global: { stubs: { AiRunView: true } } })
  await nextTick()
})
afterEach(() => { wrapper.unmount(); vi.restoreAllMocks() })
const input = () => wrapper.getComponent(AiChatInput)
async function switchTo(id: string) {
  service.activeTabId.value = id
  await nextTick(); await nextTick()
}

it('keeps a pending HEIC in its originating draft and grants only that session access', async () => {
  input().vm.addAttachment(source)
  await switchTo('tab-b')
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments).toEqual([])
  expect(b.scopeResolver.addFile).not.toHaveBeenCalled()
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
  await switchTo('tab-a')
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
  expect(convert).toHaveBeenCalledOnce()
})

it('keeps a delayed disk or clipboard import in its originating draft too', async () => {
  const pending = input().vm.importFiles([new File(['sample'], 'sample.heic')])
  await switchTo('tab-b')
  finishExternal(png)
  await pending
  expect(input().vm.takeDraft().attachments).toEqual([])
  expect(b.scopeResolver.addFile).not.toHaveBeenCalled()
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
  await switchTo('tab-a')
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
})

it('does not submit the previous conversation draft before a tab switch has painted', async () => {
  input().vm.addAttachment(png)
  service.activeTabId.value = 'tab-b'
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(b.sendMessage).not.toHaveBeenCalled()
})

it('keeps a just-completed import when returning to a tab with a pending drawing replacement', async () => {
  input().vm.addAttachment(png)
  input().vm.addAttachment(source)
  await switchTo('tab-b')
  service.pendingInput.value = { text: '', tabId: 'tab-a', replaceAttachment: png.path, attachments: ['Pictures/sample-drawn.png'] }
  service.activeTabId.value = 'tab-a'
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path, 'Pictures/sample-drawn.png'])
  expect(b.scopeResolver.addFile).not.toHaveBeenCalled()
})

it('rejects a queued picture return for an earlier conversation in the same tab', async () => {
  a.conversationVersion.value++
  service.pendingInput.value = { text: '', tabId: 'tab-a', conversationVersion: 0, attachments: [png.path] } as never
  await flushPromises()
  expect(input().vm.takeDraft().attachments).toEqual([])
  expect(a.scopeResolver.addFile).not.toHaveBeenCalled()
  expect(service.pendingInput.value).toBeNull()
})

it.each(['load', 'reset'])('invalidates imports when %s replaces the conversation inside one tab', async () => {
  input().vm.addAttachment(source)
  a.conversationVersion.value++
  await nextTick(); await nextTick()
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments).toEqual([])
  expect(a.scopeResolver.addFile).not.toHaveBeenCalled()
})

it.each(['vault', 'external'])('preserves another %s import and its send barrier when a drawing returns', async (kind) => {
  input().vm.addAttachment(png)
  let pending: Promise<void> | undefined
  if (kind === 'vault') input().vm.addAttachment(source)
  else pending = input().vm.importFiles([new File(['sample'], 'sample.heic')])
  service.pendingInput.value = { text: '', tabId: 'tab-a', replaceAttachment: png.path, attachments: ['Pictures/sample-drawn.png'] }
  await nextTick(); await nextTick()
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(a.sendMessage).not.toHaveBeenCalled()
  if (kind === 'vault') finish(png)
  else finishExternal(png)
  if (pending) await pending
  await flushPromises()
  // Vault conversion keeps its placeholder's slot; an external import appends on completion.
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual(kind === 'vault'
    ? [png.path, 'Pictures/sample-drawn.png']
    : ['Pictures/sample-drawn.png', png.path])
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
})

it.each(['vault', 'external'])('retains a pending %s import when incoming text replaces the draft after a run visit', async (kind) => {
  vi.spyOn(service, 'activeRun', 'get').mockImplementation(() => service.activeTabId.value === 'run:sample' ? ({ runId: 'sample' } as never) : null)
  service.tabOrder.value.push('run:sample')
  let pending: Promise<void> | undefined
  if (kind === 'vault') input().vm.addAttachment(source)
  else pending = input().vm.importFiles([new File(['sample'], 'sample.heic')])
  await switchTo('run:sample')
  service.pendingInput.value = { text: 'Incoming sample passage', tabId: 'tab-a', focus: true }
  await switchTo('tab-a')
  expect(input().vm.takeDraft().text).toBe('Incoming sample passage')
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(a.sendMessage).not.toHaveBeenCalled()
  if (kind === 'vault') finish(png)
  else finishExternal(png)
  if (pending) await pending
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(a.sendMessage).toHaveBeenCalledWith('Incoming sample passage', [png.path])
})

it.each(['vault', 'external'])('keeps the pending %s import and send barrier after the entire chat panel is remounted', async (kind) => {
  input().vm.setText('An unfinished sample message')
  let pending: Promise<void> | undefined
  if (kind === 'vault') input().vm.addAttachment(source)
  else pending = input().vm.importFiles([new File(['sample'], 'sample.heic')])
  wrapper.unmount()
  wrapper = mount(AiChat, { attachTo: document.body, global: { stubs: { AiRunView: true } } })
  await nextTick(); await nextTick()
  input().vm.setText('Sending must wait')
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(a.sendMessage).not.toHaveBeenCalled()
  if (kind === 'vault') finish(png)
  else finishExternal(png)
  if (pending) await pending
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
})

it('shows an import completed while the whole panel was closed in the newly opened panel', async () => {
  input().vm.setText('A preserved sample draft')
  input().vm.addAttachment(source)
  wrapper.unmount()
  finish(png)
  await flushPromises()
  wrapper = mount(AiChat, { attachTo: document.body, global: { stubs: { AiRunView: true } } })
  await nextTick(); await nextTick()
  expect(input().vm.takeDraft().text).toBe('A preserved sample draft')
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
})

it('keeps the send barrier and completion through a delegated-run composer remount', async () => {
  vi.spyOn(service, 'activeRun', 'get').mockImplementation(() => service.activeTabId.value === 'run:sample' ? ({ runId: 'sample' } as never) : null)
  service.tabOrder.value.push('run:sample')
  const original = input().vm
  original.addAttachment(source)
  await switchTo('run:sample')
  expect(wrapper.findComponent(AiChatInput).exists()).toBe(false)
  await switchTo('tab-a')
  expect(input().vm).not.toBe(original)
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(a.sendMessage).not.toHaveBeenCalled()
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
})

it('delivers a completed import while the composer is still unmounted on a run tab', async () => {
  vi.spyOn(service, 'activeRun', 'get').mockImplementation(() => service.activeTabId.value === 'run:sample' ? ({ runId: 'sample' } as never) : null)
  service.tabOrder.value.push('run:sample')
  input().vm.addAttachment(source)
  await switchTo('run:sample')
  finish(png)
  await flushPromises()
  expect(a.scopeResolver.addFile).toHaveBeenCalledWith(png.path)
  await switchTo('tab-a')
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
})

it('preserves import ownership and the send barrier when aborted queued messages restore the draft', async () => {
  input().vm.addAttachment(source)
  a.isStreaming.value = true
  a.takeQueuedMessages = () => [{ id: 'sample-queued', content: 'queued words', attachments: [] }]
  await nextTick()
  await wrapper.get('[data-icon="square"]').trigger('click')
  a.isStreaming.value = false
  await nextTick()
  fakeNoteEditors.at(-1)!.press('Shift-Enter')
  expect(a.sendMessage).not.toHaveBeenCalled()
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
  expect(input().vm.takeDraft().text).toBe('queued words')
})

it('handles a drop in the composer exactly once, without bubbling into the chat', async () => {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: {
    types: ['text/plain'], files: [], getData: (type: string) => type === 'text/plain' ? source.path : '',
  } })
  input().element.dispatchEvent(event)
  expect(convert).toHaveBeenCalledOnce()
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
})

it('still accepts an Obsidian file URI dropped into the composer', async () => {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: {
    types: ['text/plain'], files: [],
    getData: (type: string) => type === 'text/plain' ? `obsidian://open?file=${encodeURIComponent(source.path)}` : '',
  } })
  input().element.dispatchEvent(event)
  expect(convert).toHaveBeenCalledOnce()
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([png.path])
})

it('deduplicates an in-flight conversion and does not restore a removed attachment', async () => {
  input().vm.addAttachment(source)
  input().vm.addAttachment(source)
  expect(convert).toHaveBeenCalledOnce()
  input().vm.putDraft({ text: '', attachments: [] })
  finish(png)
  await flushPromises()
  expect(input().vm.takeDraft().attachments).toEqual([])
  expect(a.scopeResolver.addFile).not.toHaveBeenCalled()
})
