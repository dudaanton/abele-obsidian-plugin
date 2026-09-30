import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
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
  a = fakeChatSession({ kind: 'chat' })
  b = fakeChatSession({ kind: 'chat' })
  a.scopeResolver.addFile = vi.fn()
  b.scopeResolver.addFile = vi.fn()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockImplementation(() => ({ value: service.activeTabId.value === 'tab-a' ? a : b }) as never)
  vi.spyOn(service, 'getSession').mockImplementation((id) => (id === 'tab-a' ? a : id === 'tab-b' ? b : undefined) as never)
  wrapper = mount(AiChat, { attachTo: document.body })
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
