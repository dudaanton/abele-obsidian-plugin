/**
 * Scripts that act as a chat's interceptor.
 *
 * A script marked `@interceptor` is shown each message a chat sends before its agent sees it,
 * with the chat around it, and its return value decides what becomes of the message. It is
 * not something to run by hand: it has no command and is no agent's tool, and every other road
 * to running it says what it is for. It runs only in a version this device vouches for, and
 * never longer than its header allows.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptTrust } from '@/scripting/ScriptTrust'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { GlobalStore } from '@/stores/GlobalStore'
import { runInterceptorScript, interceptorScripts } from '@/ai/interceptor/runScript'
import { buildInterceptInput, type InterceptInput } from '@/ai/interceptor/context'
import { useVault } from '../helpers/testEnv'
import type { TFile } from 'obsidian'

const review = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true))
vi.mock('@/scripting/reviewScript', () => ({ reviewScript: review }))

const input: InterceptInput = {
  message: { text: 'hello there', attachments: [] },
  chat: {
    id: 'c1',
    title: 'Sample chat',
    kind: 'chat',
    path: null,
    messages: [{ role: 'user', text: 'earlier', timestamp: 1 }],
    attachments: [],
    activeNote: 'notes/sample-note.md',
    note: null,
    agent: null,
  },
}

const header = (name: string, extra = '// @interceptor') => `// @name ${name}\n${extra}\n`

let commands: string[]

async function setup(files: { path: string; content: string }[], confirm = false) {
  useVault(files)
  ScriptService.destroy()
  ScriptTrust.reset()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    scriptsFolder: 'Scripts',
    confirmForeignScripts: confirm,
  }
  commands = []
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = {
    addCommand: (c: { id: string }) => commands.push(c.id),
    removeCommand: () => {},
    addStatusBarItem: () => createDiv(),
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue(undefined)
  await ScriptService.getInstance().discover()
}

beforeEach(() => {
  review.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the @interceptor header', () => {
  it('marks the script, with 30 seconds unless it says', () => {
    expect(parseScriptHeader(header('A'))?.interceptor).toBe(30)
    expect(parseScriptHeader(header('A', '// @interceptor 5'))?.interceptor).toBe(5)
    expect(parseScriptHeader(header('A', '// @interceptor 99999'))?.interceptor).toBe(600)
    expect(parseScriptHeader(header('A', '// @interceptor soon'))?.interceptor).toBe(30)
    expect(parseScriptHeader('// @name A\n')?.interceptor).toBeUndefined()
  })
})

describe('an interceptor script in the index', () => {
  it('is no command and no tool, and is listed for the pickers', async () => {
    await setup([
      { path: 'Scripts/guard.js', content: header('Guard') + 'return' },
      { path: 'Scripts/plain.js', content: '// @name Plain\nreturn 1' },
    ])
    const service = ScriptService.getInstance()
    expect(commands).toEqual(['abele:script-plain'])
    expect(service.getEnabledToolScripts().map((s) => s.meta.name)).toEqual(['Plain'])
    expect(interceptorScripts().map((s) => s.meta.name)).toEqual(['Guard'])
  })

  it('refuses to run by any other road, saying what it is for', async () => {
    await setup([{ path: 'Scripts/guard.js', content: header('Guard') + 'return 1' }])
    await expect(
      ScriptService.getInstance().execute('Scripts/guard.js', {}, { source: 'command' })
    ).rejects.toThrow(/interceptor/)
  })
})

describe('running an interceptor script', () => {
  it('shows it the message and the chat, and reads what it returns', async () => {
    await setup([
      {
        path: 'Scripts/guard.js',
        content:
          header('Guard') +
          'return message.text.toUpperCase() + " / " + chat.messages[0].text + " / " + chat.activeNote',
      },
    ])
    const out = await runInterceptorScript('Guard', input, new AbortController().signal)
    expect(out).toMatchObject({
      kind: 'send',
      text: 'HELLO THERE / earlier / notes/sample-note.md',
      rewritten: true,
    })
  })

  it('lets a script of its own name for "message" shadow the one it is given', async () => {
    await setup([
      {
        path: 'Scripts/guard.js',
        content: header('Guard') + 'const message = "mine"\nreturn message',
      },
    ])
    const out = await runInterceptorScript('Guard', input, new AbortController().signal)
    expect(out).toMatchObject({ kind: 'send', text: 'mine' })
  })

  it('cannot change what it was shown', async () => {
    await setup([
      {
        path: 'Scripts/guard.js',
        content: header('Guard') + 'message.text = "changed"\nreturn',
      },
    ])
    const shown = buildInterceptInput(
      { text: 'hello there', attachments: [] },
      {
        id: 'c1',
        title: 'Sample chat',
        kind: 'chat',
        path: null,
        messages: [],
        activeNote: null,
        note: null,
        agent: null,
        overrides: { providerId: '', modelId: '', permissionMode: 'confirm-all', toolModes: {} },
      }
    )
    const out = await runInterceptorScript('Guard', shown, new AbortController().signal)
    expect(out.kind).toBe('failed')
    expect(shown.message.text).toBe('hello there')
  })

  it('turns a policy it returns into decisions about tool calls', async () => {
    await setup([
      {
        path: 'Scripts/guard.js',
        content: header('Guard') + 'return { approve: ["edit"], deny: ["rm"] }',
      },
    ])
    const out = await runInterceptorScript('Guard', input, new AbortController().signal)
    if (out.kind !== 'send') throw new Error(`expected send, got ${out.kind}`)
    expect(await out.policy!.decide({ name: 'edit', args: {}, outOfScope: false })).toEqual({
      kind: 'approve',
    })
    expect((await out.policy!.decide({ name: 'rm', args: {}, outOfScope: false })).kind).toBe(
      'deny'
    )
  })

  it('fails, with the reason, when the script throws', async () => {
    await setup([
      { path: 'Scripts/guard.js', content: header('Guard') + 'throw new Error("nope")' },
    ])
    const out = await runInterceptorScript('Guard', input, new AbortController().signal)
    expect(out).toMatchObject({ kind: 'failed' })
    if (out.kind === 'failed') expect(out.reason).toContain('nope')
  })

  it('fails when it returns something it cannot use', async () => {
    await setup([{ path: 'Scripts/guard.js', content: header('Guard') + 'return 42' }])
    const out = await runInterceptorScript('Guard', input, new AbortController().signal)
    expect(out.kind).toBe('failed')
  })

  it('fails when no interceptor script has that name, or two have', async () => {
    await setup([
      { path: 'Scripts/a.js', content: header('Twin') + 'return' },
      { path: 'Scripts/b.js', content: header('Twin') + 'return' },
      { path: 'Scripts/plain.js', content: '// @name Plain\nreturn' },
    ])
    const signal = new AbortController().signal
    const missing = await runInterceptorScript('Nobody', input, signal)
    expect(missing.kind).toBe('failed')
    const plain = await runInterceptorScript('Plain', input, signal)
    expect(plain.kind).toBe('failed')
    const twin = await runInterceptorScript('Twin', input, signal)
    expect(twin.kind).toBe('failed')
    if (twin.kind === 'failed') expect(twin.reason).toMatch(/two|more than one/i)
  })

  it('gives up after the seconds its header allows, and says so', async () => {
    await setup([
      {
        path: 'Scripts/slow.js',
        content: header('Slow', '// @interceptor 2') + 'await new Promise(() => {})',
      },
    ])
    vi.useFakeTimers()
    const pending = runInterceptorScript('Slow', input, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(2100)
    const out = await pending
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/2 s/)
  })

  it('stops when told to, which is not a failure', async () => {
    await setup([
      { path: 'Scripts/slow.js', content: header('Slow') + 'await new Promise(() => {})' },
    ])
    const controller = new AbortController()
    const pending = runInterceptorScript('Slow', input, controller.signal)
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    expect((await pending).kind).toBe('stopped')
  })

  it('does not run a version this device has not confirmed, and never asks mid-send', async () => {
    await setup([{ path: 'Scripts/guard.js', content: header('Guard') + 'return "one"' }], true)
    const { app } = GlobalStore.getInstance()
    const file = app.vault.getAbstractFileByPath('Scripts/guard.js') as TFile
    await app.vault.modify(file, header('Guard') + 'return "arrived from elsewhere"')
    await ScriptService.getInstance().discover()

    const out = await runInterceptorScript('Guard', input, new AbortController().signal)
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/confirm/)
    expect(review).not.toHaveBeenCalled()
  })
})
