import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunStorage, type RunFile } from '@/ai/RunStorage'
import { chatCopyPath } from '@/ai/chatCopy'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const run: RunFile = {
  type: 'abele-run',
  runId: 'sample-run',
  agentId: 'sample-worker',
  agentName: 'Sample worker',
  parentChat: 'AI/Chats/sample-parent.abchat',
  parentToolCallId: 'sample-call',
  task: 'Describe a garden path.',
  created: '2000-01-01',
  status: 'done',
  depth: 1,
  branches: [
    {
      item: 'sample-item',
      status: 'done',
      result: 'A lantern lights the path.',
      messages: [
        { id: 'sample-question', role: 'user', content: 'Describe the path.', timestamp: 1 },
        {
          id: 'sample-answer',
          role: 'assistant',
          content: 'A lantern lights the path.',
          timestamp: 2,
        },
      ],
    },
  ],
}
let app: ReturnType<typeof useVault>

beforeEach(() => {
  app = useVault([])
  RunStorage.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, chatFolder: 'AI/Chats' }
})
afterEach(() => vi.restoreAllMocks())

describe('delegated transcript rewrite recovery', () => {
  it.each([0, 0.5])(
    'restores all branches after a run rewrite is truncated at %s',
    async (share) => {
      const storage = RunStorage.getInstance()
      const file = (await storage.save(run))!
      const modify = app.vault.modify.bind(app.vault)
      let interrupted = false,
        copied = false
      const interrupt = async (target: typeof file, content: string) => {
        if (interrupted) return modify(target, content)
        interrupted = true
        copied = await app.vault.adapter.exists(chatCopyPath(app, target.path))
        await modify(target, content.slice(0, Math.floor(content.length * share)))
        throw new Error('sample interrupted run rewrite')
      }
      vi.spyOn(app.vault, 'modify').mockImplementationOnce(interrupt)
      vi.spyOn(app.vault, 'process').mockImplementationOnce(async (target, fn) =>
        interrupt(target, fn(await app.vault.read(target)))
      )
      await expect(
        storage.save({ ...run, task: 'An updated garden description.' })
      ).resolves.toBeNull()
      expect(JSON.parse(await app.vault.read(file))).toEqual(run)
      expect(copied).toBe(true)
      RunStorage.destroy()
      expect(await RunStorage.getInstance().load(run.runId)).toEqual(run)
      const updated = { ...run, task: 'An updated garden description.' }
      expect(await RunStorage.getInstance().save(updated)).not.toBeNull()
      expect(await RunStorage.getInstance().load(run.runId)).toEqual(updated)
    }
  )

  it('reads an interrupted run from its whole backup before another save', async () => {
    const storage = RunStorage.getInstance()
    const file = (await storage.save(run))!
    const copy = chatCopyPath(app, file.path)
    await app.vault.adapter.mkdir(copy.slice(0, copy.lastIndexOf('/')))
    await app.vault.adapter.write(copy, `${file.path}\n${JSON.stringify(run)}`)
    await app.vault.modify(file, JSON.stringify(run).slice(0, 30))
    expect(await storage.load(run.runId)).toEqual(run)
    expect(JSON.parse(await app.vault.read(file))).toEqual(run)
    expect(await app.vault.adapter.exists(copy)).toBe(false)
  })

  it('keeps an externally changed transcript when it arrives during copying', async () => {
    const storage = RunStorage.getInstance()
    const file = (await storage.save(run))!
    const write = app.vault.adapter.write.bind(app.vault.adapter)
    const external = { ...run, task: 'A separately updated transcript.' }
    vi.spyOn(app.vault.adapter, 'write').mockImplementationOnce(async (path, content) => {
      await write(path, content)
      await app.vault.modify(file, JSON.stringify(external))
    })
    expect(await storage.save({ ...run, task: 'A local update.' })).toBeNull()
    expect(await storage.load(run.runId)).toEqual(external)
    expect(await app.vault.adapter.exists(chatCopyPath(app, file.path))).toBe(false)
  })
})
