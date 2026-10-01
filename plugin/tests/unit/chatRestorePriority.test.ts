import { afterEach, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { TFile } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  ChatService.getInstance().destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('makes the saved active chat usable before reading inactive conversations, preserving order', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const paths = Array.from({ length: 4 }, (_, i) => `SampleChats/sample-chat-${i}.abchat`)
  const app = useVault(
    paths.map((path, i) => ({ path, content: 'x'.repeat(i === 3 ? 100 : 10_000) }))
  )
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  ChatService.getInstance().destroy()
  const service = ChatService.getInstance()
  app.saveLocalStorage('abele-agent-tabs', {
    tabs: paths.map((chatFilePath) => ({ chatFilePath })),
    activeIndex: 3,
  })
  const reads: string[] = []
  let bytes = 0
  vi.spyOn(ChatSession.prototype, 'load').mockImplementation(async function (file) {
    reads.push(file.path)
    bytes += (await app.vault.read(file)).length
    await new Promise((resolve) => setTimeout(resolve, 20))
    this.currentChatFile.value = file
  })
  let ready = -1,
    bytesAtReady = -1
  const stop = watch(
    service.activeSession,
    (session) => {
      if (session?.currentChatFile.value?.path === paths[3]) {
        ready = Date.now()
        bytesAtReady = bytes
      }
    },
    { flush: 'sync' }
  )
  const restoring = service.restoreTabs()
  await vi.advanceTimersByTimeAsync(200)
  await restoring
  stop()
  console.info(
    `active chat: ready=${ready}ms, bytesBeforeReady=${bytesAtReady}, reads=${reads.length}`
  )
  expect(reads[0]).toBe(paths[3])
  expect(ready).toBe(20)
  expect(bytesAtReady).toBe(100)
  expect(
    service.tabOrder.value.map((id) => service.getSession(id)?.currentChatFile.value?.path)
  ).toEqual(paths)
  expect(service.activeSession.value?.currentChatFile.value?.path).toBe(paths[3])
})

it('reuses an inactive conversation selected while background hydration is in flight', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const paths = ['SampleChats/sample-background.abchat', 'SampleChats/sample-active.abchat']
  const app = useVault(paths.map((path) => ({ path, content: '' })))
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  ChatService.getInstance().destroy()
  const service = ChatService.getInstance()
  const state = { tabs: paths.map((chatFilePath) => ({ chatFilePath })), activeIndex: 1 }
  app.saveLocalStorage('abele-agent-tabs', state)
  const load = vi.spyOn(ChatSession.prototype, 'load').mockImplementation(async function (file) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    this.currentChatFile.value = file
  })
  const restoring = service.restoreTabs()
  await vi.advanceTimersByTimeAsync(21)
  service.saveTabs()
  expect(app.loadLocalStorage('abele-agent-tabs')).toEqual(state)
  const opening = service.openChatFile(app.vault.getAbstractFileByPath(paths[0]) as TFile)
  await vi.advanceTimersByTimeAsync(100)
  await Promise.all([restoring, opening])
  expect(load.mock.calls.filter(([file]) => file.path === paths[0])).toHaveLength(1)
  expect(service.getAllSessions()).toHaveLength(2)
  expect(service.activeSession.value?.currentChatFile.value?.path).toBe(paths[0])
})

it('does not publish a conversation that finishes loading after service teardown', async () => {
  vi.useFakeTimers()
  useVault([{ path: 'SampleChats/sample-delayed.abchat', content: '' }])
  const service = ChatService.getInstance()
  const { GlobalStore } = await import('@/stores/GlobalStore')
  GlobalStore.getInstance().app.saveLocalStorage('abele-agent-tabs', {
    tabs: [{ chatFilePath: 'SampleChats/sample-delayed.abchat' }],
    activeIndex: 0,
  })
  let finish!: () => void
  vi.spyOn(ChatSession.prototype, 'load').mockImplementation(async function (file) {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    this.currentChatFile.value = file
  })
  const restoring = service.restoreTabs()
  service.destroy()
  finish()
  await restoring
  expect(service.tabOrder.value).toEqual([])
  expect(service.activeSession.value).toBeNull()
  expect(service.getAllSessions()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
