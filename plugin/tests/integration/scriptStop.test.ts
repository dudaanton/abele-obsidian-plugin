import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { runInterceptorScript } from '@/ai/interceptor/runScript'
import type { InterceptInput } from '@/ai/interceptor/context'
import { showFormModal } from '@/scripting/formModal'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))
vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

beforeEach(() => {
  ScriptService.destroy()
  ScriptRuns.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsFolder: 'Scripts' }
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = {
    addCommand: vi.fn(),
    removeCommand: vi.fn(),
    addStatusBarItem: () => document.createElement('div'),
  }
  requestUrl.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  ScriptService.destroy()
  ScriptRuns.destroy()
})

function context(controller: AbortController, formHandler = vi.fn(async () => null)) {
  return buildScriptContext({ params: {}, signal: controller.signal, logs: [], formHandler })
}

describe('revoked script capabilities', () => {
  it('refuses writes, requests and prompts even when the script catches cancellation', async () => {
    const app = useVault([{ path: 'sample-note.md', content: 'original' }])
    const controller = new AbortController()
    const formHandler = vi.fn(async () => null)
    const ctx = context(controller, formHandler)
    requestUrl.mockResolvedValue({ status: 200, headers: {}, text: '' })
    controller.abort()
    const operations = [
      () => ctx.write('sample-note.md', 'changed'),
      () => ctx.edit('sample-note.md', 'original', 'changed'),
      () => ctx.create('new-note.md', 'created'),
      () => ctx.copy('sample-note.md', 'copy.md'),
      () => ctx.move('sample-note.md', 'moved.md'),
      () => ctx.remove('sample-note.md'),
      () =>
        ctx.replace('sample-note.md', [
          { type: 'set-property', property: 'sample', value: 'true' },
        ]),
      () => ctx.fetch('https://sample.invalid'),
      () => ctx.downloadFile('https://sample.invalid/sample.zip'),
      () => ctx.downloadImage('https://sample.invalid/sample.png'),
      () => ctx.generateImage('sample picture'),
      () => ctx.agent('sample task'),
      () => ctx.applyTemplate('sample-template.md'),
      () => ctx.createFromTemplate('sample-template.md'),
      () => ctx.setCover('sample-note.md'),
      () => ctx.unzip('sample.zip'),
      () => ctx.runScript('Sample'),
      () => ctx.form([]),
      () => ctx.show('sample prompt'),
      () => ctx.vocabulary.mark({ note: 'sample-note.md', forms: ['sample'] }),
    ]
    const errors = await Promise.all(
      operations.map(async (run) => {
        try {
          await run()
          return 'not stopped'
        } catch (error) {
          return String(error)
        }
      })
    )
    expect(errors.every((error) => /abort|stopped/i.test(error))).toBe(true)
    expect(requestUrl).not.toHaveBeenCalled()
    expect(formHandler).not.toHaveBeenCalled()
    expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toBe('original')
    expect(app.vault.getFiles().map((file) => file.path)).toEqual(['sample-note.md'])
  })

  it.each(['write', 'edit', 'copy'] as const)(
    'checks again after %s has awaited a read',
    async (method) => {
      const app = useVault([{ path: 'sample-note.md', content: 'original' }])
      const controller = new AbortController()
      const ctx = context(controller)
      const gate = deferred<string>()
      vi.spyOn(app.vault, 'read').mockReturnValueOnce(gate.promise)
      const modify = vi.spyOn(app.vault, 'modify')
      const create = vi.spyOn(app.vault, 'create')
      const call =
        method === 'write'
          ? ctx.write('sample-note.md', 'changed')
          : method === 'edit'
            ? ctx.edit('sample-note.md', 'original', 'changed')
            : ctx.copy('sample-note.md', 'copy.md')
      const result = call.catch((error) => error)
      controller.abort()
      gate.resolve('original')
      expect(await result).toBeInstanceOf(Error)
      expect(modify).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    }
  )

  it.each(['downloadFile', 'downloadImage'] as const)(
    'does not save %s after its response arrives late',
    async (method) => {
      const app = useVault([])
      const controller = new AbortController()
      const gate = deferred<any>()
      requestUrl.mockReturnValue(gate.promise)
      const ctx = context(controller)
      const call = ctx[method]('https://sample.invalid/sample.png').catch((error) => error)
      controller.abort()
      gate.resolve({
        status: 200,
        headers: { 'content-type': 'image/png' },
        arrayBuffer: new ArrayBuffer(0),
      })
      expect(await call).toBeInstanceOf(Error)
      expect(app.vault.getFiles()).toHaveLength(0)
    }
  )
})

describe('script deadlines and prompts', () => {
  it('revokes a timed-out download before a late response can create a file', async () => {
    const app = useVault([])
    const gate = deferred<any>()
    requestUrl.mockReturnValue(gate.promise)
    vi.useFakeTimers()
    const ctx = context(new AbortController())
    const call = ctx.downloadFile('https://sample.invalid/sample.zip', { timeout: 100 })
    const stopped = expect(call).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(101)
    await stopped
    gate.resolve({ status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0) })
    await flushPromises()
    expect(app.vault.getFiles()).toHaveLength(0)
  })

  it('closes its pending form on Stop and cannot use a late answer to write', async () => {
    useVault([])
    const controller = new AbortController()
    const ctx = buildScriptContext({
      params: {},
      signal: controller.signal,
      logs: [],
      formHandler: showFormModal,
    })
    const call = ctx.form([])
    const stopped = expect(call).rejects.toThrow(/abort|stopped/i)
    await flushPromises()
    expect(GlobalStore.getInstance().scriptFormModalOpened.value).toBe(true)
    controller.abort()
    await stopped
    expect(GlobalStore.getInstance().scriptFormModalOpened.value).toBe(false)
  })

  it.each(['script', 'policy'] as const)(
    'revokes an interceptor %s after its deadline',
    async (kind) => {
      const app = useVault([
        { path: 'sample-note.md', content: 'original' },
        {
          path: 'Scripts/sample.js',
          content:
            `// @name Sample\n// @interceptor 1\n` +
            (kind === 'policy'
              ? `return { approve: async () => { await fetch('https://sample.invalid'); await write('sample-note.md', 'late'); return true } }`
              : `await fetch('https://sample.invalid'); await write('sample-note.md', 'late')`),
        },
      ])
      const gate = deferred<any>()
      requestUrl.mockReturnValue(gate.promise)
      await ScriptService.getInstance().discover()
      vi.useFakeTimers()
      const input = { message: { text: 'sample', attachments: [] }, chat: {} } as InterceptInput
      const pending = runInterceptorScript('Sample', input, new AbortController().signal)
      if (kind === 'policy') {
        const out = await pending
        if (out.kind !== 'send') throw new Error('Expected send')
        const decision = out.policy!.decide({ name: 'edit', args: {}, outOfScope: false })
        await vi.advanceTimersByTimeAsync(5001)
        expect(await decision).toEqual({ kind: 'ask' })
      } else {
        await vi.advanceTimersByTimeAsync(1001)
        expect((await pending).kind).toBe('failed')
      }
      gate.resolve({ status: 200, headers: {}, text: '' })
      await flushPromises()
      expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toBe('original')
    }
  )
})

describe('script run stop accounting', () => {
  it.each(['command', 'automation'] as const)(
    'revokes a %s run while its JavaScript is still suspended',
    async (source) => {
      const gate = deferred()
      const finished = deferred()
      const app = useVault([
        { path: 'sample-note.md', content: 'original' },
        {
          path: 'Scripts/sample.js',
          content: `// @name Sample
await params.gate
try { await write('sample-note.md', 'late') } catch {}
try { await fetch('https://sample.invalid') } catch {}
try { await form([]) } catch {}
params.finished()
`,
        },
      ])
      requestUrl.mockResolvedValue({ status: 200, headers: {}, text: '' })
      const handler = vi.fn(async () => null)
      const service = ScriptService.getInstance()
      await service.discover()
      const call = service.execute(
        'Scripts/sample.js',
        { gate: gate.promise, finished: finished.resolve },
        { source, formHandler: handler }
      )
      const stopped = expect(call).rejects.toThrow(/stopped/i)
      await flushPromises()
      ScriptRuns.getInstance().stopAll()
      await stopped
      gate.resolve()
      await finished.promise
      expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toBe('original')
      expect(requestUrl).not.toHaveBeenCalled()
      expect(handler).not.toHaveBeenCalled()
    }
  )

  it.each([true, false])(
    'does not mark stopped before an already-issued vault mutation settles (awaited: %s)',
    async (awaited) => {
      const app = useVault([
        { path: 'sample-note.md', content: 'original' },
        {
          path: 'Scripts/sample.js',
          content:
            '// @name Sample\n' +
            (awaited
              ? 'await write("sample-note.md", "changed")'
              : 'void write("sample-note.md", "changed"); await new Promise(() => {})'),
        },
      ])
      const gate = deferred()
      const entered = deferred()
      vi.spyOn(app.vault, 'modify').mockImplementationOnce(async () => {
        entered.resolve()
        await gate.promise
      })
      const service = ScriptService.getInstance()
      await service.discover()
      const call = service.execute('Scripts/sample.js', {}).catch((error) => error)
      await entered.promise
      ScriptRuns.getInstance().stopAll()
      await flushPromises()
      expect(ScriptRuns.getInstance().runs.value[0].status).not.toBe('stopped')
      gate.resolve()
      await call
      await flushPromises()
      expect(ScriptRuns.getInstance().runs.value[0].status).toBe('stopped')
    }
  )

  it('does not start a script with an already-aborted caller', async () => {
    const app = useVault([
      { path: 'sample-note.md', content: 'original' },
      {
        path: 'Scripts/sample.js',
        content: '// @name Sample\nawait write("sample-note.md", "changed")',
      },
    ])
    const service = ScriptService.getInstance()
    await service.discover()
    const controller = new AbortController()
    controller.abort()
    await expect(service.execute('Scripts/sample.js', {}, controller.signal)).rejects.toThrow()
    expect(await app.vault.read(app.vault.getFileByPath('sample-note.md')!)).toBe('original')
  })
})
