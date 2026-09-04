/**
 * How a script reaches a view: `view()` and the catalogue are globals like `read` and `find`.
 *
 * The one rule with teeth is about modals. A script started by an agent must not pop a form
 * (scriptShow.test.ts pins that), but once the script has opened a view its handlers run
 * because the user pressed something, and a modal is then theirs to see.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { View, ViewHost } from '@/scripting/view/View'
import { Button } from '@/scripting/view/components'
import { setDefaultViewHost } from '@/scripting/view/host'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'

const { showFormModal } = vi.hoisted(() => ({ showFormModal: vi.fn(async () => ({ a: '1' })) }))
vi.mock('@/scripting/formModal', () => ({ showFormModal }))

const host = (): ViewHost => ({
  async open(view: View) {
    view.leafId = 'leaf'
  },
  close() {},
})

function context(over: Partial<Parameters<typeof buildScriptContext>[0]> = {}) {
  return buildScriptContext({
    params: { deck: 'German' },
    signal: new AbortController().signal,
    logs: [],
    scriptName: 'Flashcards',
    viewHost: host(),
    ...over,
  })
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  showFormModal.mockClear()
})

describe('view() in a script', () => {
  it('makes a View that remembers which script made it and with what', () => {
    const ctx = context()
    const v = ctx.view({ title: 'T' })
    expect(v.origin).toEqual({ script: 'Flashcards', params: { deck: 'German' } })
    expect(v.title).toBe('T')
  })

  it('hands the restored state to the first view only', () => {
    const ctx = context({ restore: { leafId: 'L', state: { index: 2 } } })
    const first = ctx.view({ title: 'A' })
    const second = ctx.view({ title: 'B' })
    expect(first.state).toEqual({ index: 2 })
    expect(first.restore?.leafId).toBe('L')
    expect(second.restore).toBeUndefined()
  })

  it('exposes the catalogue as globals', () => {
    const ctx = context()
    expect(ctx.Button === Button).toBe(true)
    expect(typeof ctx.Html).toBe('function')
  })

  it('refuses a form before a view is open and allows one after', async () => {
    const ctx = context()
    await expect(ctx.form([{ name: 'a', label: 'A' }])).rejects.toThrow(/only available/)
    const v = ctx.view({ title: 'T' })
    await v.open()
    expect(await ctx.form([{ name: 'a', label: 'A' }])).toEqual({ a: '1' })
    await ctx.show('text', 'Title')
    expect(showFormModal).toHaveBeenCalledTimes(2)
  })

  it('still prefers a form handler it was given', async () => {
    const handler = vi.fn(async () => null)
    const ctx = context({ formHandler: handler })
    const v = ctx.view({ title: 'T' })
    await v.open()
    await ctx.form([])
    expect(handler).toHaveBeenCalled()
    expect(showFormModal).not.toHaveBeenCalled()
  })
})

/**
 * The same rule through the service, which is the road a real run takes. The service threads
 * the run's id into whatever handler it was given; when it was given none it must hand the
 * context nothing, not a handler that throws — or a view's button could never ask anything.
 */
describe('form() in a script the service ran', () => {
  let service: ScriptService

  /** Puts a script in the index without a vault folder to discover it from. */
  function register(name: string, code: string): string {
    const path = `Scripts/${name}.js`
    const scripts = (service as unknown as { scripts: Map<string, unknown> }).scripts
    scripts.set(path, { path, code, commandId: '', meta: { name, description: '', params: [] } })
    return path
  }

  beforeEach(() => {
    ScriptRuns.destroy()
    ScriptService.destroy()
    service = ScriptService.getInstance()
    setDefaultViewHost(host())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    setDefaultViewHost(null)
  })

  it('reaches the dialog once the script has a view open, as a restored tab does', async () => {
    const path = register(
      'Ask',
      `const v = view({ title: 'T' })
       await v.open()
       return JSON.stringify(await form([{ name: 'a', label: 'A' }]))`
    )
    await expect(service.execute(path, {}, { source: 'view' })).resolves.toBe('{"a":"1"}')
    expect(showFormModal).toHaveBeenCalledTimes(1)
  })

  it('is refused with the reason when nothing is open and nobody can answer', async () => {
    const path = register('Ask', `await form([{ name: 'a', label: 'A' }])`)
    await expect(service.execute(path, {}, { source: 'script' })).rejects.toThrow(
      'command palette or has a view open'
    )
    expect(showFormModal).not.toHaveBeenCalled()
  })
})
