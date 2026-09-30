import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { TFile } from 'obsidian'
import { ImageInkView } from '@/drawing/ImageInkView'
import { ChatService } from '@/ai/ChatService'
import { useVault } from '../helpers/testEnv'

let service: ChatService
let version: ReturnType<typeof ref<number>>
let original: TFile
let result: TFile
beforeEach(() => {
  const app = useVault([{ path: 'Pictures/sample.png', content: '' }, { path: 'Pictures/sample-drawn.png', content: '' }])
  original = app.vault.getAbstractFileByPath('Pictures/sample.png') as TFile
  result = app.vault.getAbstractFileByPath('Pictures/sample-drawn.png') as TFile
  service = ChatService.getInstance()
  service.activeTabId.value = 'tab-a'
  service.pendingInput.value = null
  version = ref(0)
  vi.spyOn(service, 'getSession').mockReturnValue({ conversationVersion: version, isDestroyed: false } as never)
  vi.spyOn(service, 'switchTab').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

it('does not deliver a saved drawing to a different conversation loaded into the original tab', async () => {
  let finish!: (f: TFile) => void
  const view = { chat: 'tab-a', chatVersion: 0, replaceAttachment: original.path,
    saveNew: vi.fn(() => new Promise<TFile>((resolve) => { finish = resolve })),
  }
  const sending = ImageInkView.prototype.sendToChat.call(view as never, original)
  version.value++
  finish(result)
  expect(await sending).toBe(false)
  expect(service.pendingInput.value).toBeNull()
  expect(service.revealSidebar).not.toHaveBeenCalled()
})
it('returns a drawing to the same conversation with its lifetime stamp', async () => {
  const view = { chat: 'tab-a', chatVersion: 0, replaceAttachment: original.path,
    saveNew: vi.fn(async () => result),
  }
  expect(await ImageInkView.prototype.sendToChat.call(view as never, original)).toBe(true)
  expect(service.pendingInput.value).toMatchObject({
    tabId: 'tab-a', conversationVersion: 0, attachments: [result.path], replaceAttachment: original.path,
  })
  expect(service.revealSidebar).toHaveBeenCalledOnce()
})

it('refuses a return from a drawing whose originating conversation has already changed', async () => {
  version.value++
  const view = { chat: 'tab-a', chatVersion: 0, replaceAttachment: original.path,
    saveNew: vi.fn(async () => result),
  }
  expect(await ImageInkView.prototype.sendToChat.call(view as never, original)).toBe(false)
  expect(view.saveNew).not.toHaveBeenCalled()
  expect(service.pendingInput.value).toBeNull()
})
