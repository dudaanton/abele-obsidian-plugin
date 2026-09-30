import { afterEach, expect, it, vi } from 'vitest'
import { Platform } from 'obsidian'
import { ChatService } from '@/ai/ChatService'
import { useVault } from '../helpers/testEnv'

afterEach(() => { Platform.isMobile = false; vi.restoreAllMocks() })

it('waits for the chat panel reveal before resolving', async () => {
  const app = useVault([])
  let release!: () => void
  const split = { collapsed: false, containerEl: { offsetWidth: 330 }, expand: vi.fn(), collapse: vi.fn() }
  const leaf = { getRoot: () => split }
  ;(app as any).workspace = {
    rightSplit: split, leftSplit: {}, getLeavesOfType: () => [leaf],
    revealLeaf: () => new Promise<void>((resolve) => { release = resolve }),
  }
  let done = false
  const revealing = ChatService.getInstance().revealSidebar({ focus: false }).then(() => { done = true })
  await Promise.resolve()
  expect(done).toBe(false)
  release()
  await revealing
})

it('reopens the recreated chat panel when a phone drawer hides itself while still marked open', async () => {
  const app = useVault([])
  const split = {
    collapsed: false, containerEl: { offsetWidth: 0 },
    collapse: vi.fn(() => { split.collapsed = true }),
    expand: vi.fn(() => { split.collapsed = false; split.containerEl.offsetWidth = 330 }),
  }
  const leaf = { getRoot: () => split }
  ;(app as any).workspace = {
    rightSplit: split, leftSplit: {}, getLeavesOfType: () => [leaf],
    revealLeaf: vi.fn(async () => { split.collapsed = false; split.containerEl.offsetWidth = 0 }),
  }
  Platform.isMobile = true
  await ChatService.getInstance().revealSidebar({ focus: false })
  expect(split.containerEl.offsetWidth).toBeGreaterThan(0)
  expect(split.collapse).toHaveBeenCalledOnce()
  expect(split.expand).toHaveBeenCalledOnce()
})
