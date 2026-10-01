import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

// Execute the actual page probe, not a copy of its cleanup: early setup failures must
// never delete a file that the probe's create call did not successfully create.
const source = readFileSync(
  resolve(__dirname, '../e2e/interceptorScriptReplyOnly.e2e.test.ts'),
  'utf8'
)
const probe = source.match(/const probe = String\.raw`([\s\S]*?)`\n/)![1]
const scriptPath = 'Scripts/sample-side-review.js'
const chatPath = 'AI/Chats/sample-script-reply.abchat'

describe('script reply-only probe cleanup', () => {
  it.each([
    { name: 'script collision', existing: [scriptPath], failDiscover: false },
    { name: 'chat collision', existing: [chatPath], failDiscover: false },
    { name: 'both paths occupied', existing: [scriptPath, chatPath], failDiscover: false },
    {
      name: 'index failure before reaching an existing chat',
      existing: [chatPath],
      failDiscover: true,
    },
    { name: 'chat setup failure after creating both fixtures', existing: [], failDiscover: false },
  ])(
    'preserves existing files on $name and removes only its own fixtures',
    async ({ existing, failDiscover }) => {
      const files = new Map(
        existing.map((path) => [path, { path, content: 'Existing sample contents' }])
      )
      const before = [...files.entries()]
      const folders = new Map(
        ['AI', 'AI/Chats', 'Scripts'].map((path) => [path, { path, children: [] }])
      )
      const vault = {
        getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path),
        createFolder: vi.fn(),
        create: vi.fn(async (path: string, content: string) => {
          if (files.has(path)) throw new Error(`already exists: ${path}`)
          const file = { path, content }
          files.set(path, file)
          return file
        }),
        delete: vi.fn(async (file: { path: string }) => {
          files.delete(file.path)
        }),
      }
      const scripts = {
        discover: vi.fn().mockResolvedValue(undefined),
        get: () => ({ path: scriptPath }),
        confirm: vi.fn(),
      }
      if (failDiscover)
        scripts.discover.mockRejectedValueOnce(new Error('Sample index unavailable'))
      const chats = {
        activeTabId: { value: 'previous-tab' },
        openChatFile: vi.fn(),
        revealSidebar: vi.fn(),
        getSessionByFile: () => null,
        deleteChat: vi.fn(),
      }
      const cfg = { ai: { scriptsFolder: '' } }
      const originalFetch = vi.fn()
      const window = {
        fetch: originalFetch,
        __abeleTest: {
          ChatService: { getInstance: () => chats },
          ScriptService: { getInstance: () => scripts },
          AbeleConfig: { getInstance: () => cfg },
        },
      }
      const app = { vault, workspace: { rightSplit: { collapsed: true, collapse: vi.fn() } } }
      const report = JSON.parse(
        await runInNewContext(probe, { window, app, setTimeout }, { timeout: 1000 })
      )
      expect(report.error).toMatch(/already exists|index unavailable|chat did not open/)
      expect([...files.entries()]).toEqual(before)
      expect(vault.delete.mock.calls.every(([file]) => !existing.includes(file.path))).toBe(true)
      expect(window.fetch).toBe(originalFetch)
      expect(cfg.ai.scriptsFolder).toBe('')
      expect(chats.activeTabId.value).toBe('previous-tab')
    }
  )
})
