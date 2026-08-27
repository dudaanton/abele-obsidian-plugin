/**
 * `show` — a script handing back something worth reading.
 *
 * A notice was the only way a script could say anything, and it is the wrong instrument for
 * an answer: cut off at 500 characters, gone in ten seconds, and its text cannot be selected.
 * `show` is the form modal asking nothing — one markdown block and a way to close it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import type { FormField } from '@/scripting/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

let shown: FormField[][]

function context(withHandler = true) {
  shown = []
  return buildScriptContext({
    params: {},
    signal: new AbortController().signal,
    logs: [],
    formHandler: withHandler
      ? async (fields: FormField[]) => {
          shown.push(fields)
          return null
        }
      : undefined,
  })
}

beforeEach(() => {
  useVault([])
  // The context is built whole, and parts of it read the AI settings on the way up.
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})

describe('showing markdown', () => {
  it('puts the text in a field that asks for nothing', async () => {
    const ctx = context()

    await ctx.show('# Report\n\nAll **good**.')

    expect(shown).toHaveLength(1)
    expect(shown[0]).toEqual([
      { name: 'text', label: '', type: 'markdown', text: '# Report\n\nAll **good**.' },
    ])
  })

  it('uses the title it was given as the heading of that block', async () => {
    const ctx = context()

    await ctx.show('Body.', 'What was found')

    expect(shown[0][0].label).toBe('What was found')
  })

  it('resolves once the modal is done with, whatever it answered', async () => {
    const ctx = context()

    await expect(ctx.show('Body.')).resolves.toBeUndefined()
  })

  it('says why it cannot, where no modal can be shown at all', async () => {
    // A script run from a deeplink or as an agent tool has no one in front of it.
    const ctx = context(false)

    await expect(ctx.show('Body.')).rejects.toThrow(/only available/)
  })
})
