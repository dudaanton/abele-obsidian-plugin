/**
 * How a script reaches a view: `view()` and the catalogue are globals like `read` and `find`.
 *
 * The one rule with teeth is about modals. A script started by an agent must not pop a form
 * (scriptShow.test.ts pins that), but once the script has opened a view its handlers run
 * because the user pressed something, and a modal is then theirs to see.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { View, ViewHost } from '@/scripting/view/View'
import { Button } from '@/scripting/view/components'

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
