/**
 * A script that stops to ask for parameters, run from a chat.
 *
 * It used to be unrunnable: `ctx.form()` threw «Form input is only available when the script is
 * run from the command palette», every call from an agent failed, and nothing about the script
 * said so in advance — `form()` is called inside its own code. Now the question comes back to
 * the agent as a form to fill in, the run stays alive holding it open, and `answer_form` sends
 * the answers into that same run.
 *
 * What is asserted is the protocol: the shape of the question, that the run survives being
 * asked, that answering it carries on from where it stopped, and that a second question works
 * the same way as the first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { createScriptTools, createAnswerFormTool } from '@/ai/tools/ScriptTool'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const ASKS = `
  const answers = await form([
    { name: 'word', label: 'Word', required: true },
    { name: 'lang', label: 'Language', type: 'select', options: ['en', 'ru'], default: 'en' },
    { name: 'about', label: 'What this is for', type: 'markdown', text: 'A card for a word.' },
  ])
  if (!answers) return 'nothing was answered'
  return answers.word + ':' + answers.lang
`

const ASKS_TWICE = `
  const first = await form([{ name: 'a', label: 'A' }])
  const second = await form([{ name: 'b', label: 'B' }])
  return first.a + second.b
`

function script(name: string, code: string): ParsedScript {
  return {
    path: `Scripts/${name}.js`,
    meta: { name, description: '', params: [], tool: true },
    code,
    commandId: `abele-script-${name}`,
  }
}

/** The service with two scripts in it, without touching the vault or the command palette. */
function withScripts(...scripts: ParsedScript[]): ScriptService {
  const service = ScriptService.getInstance()
  const map = new Map(scripts.map((one) => [one.path, one]))
  ;(service as unknown as { scripts: Map<string, ParsedScript> }).scripts = map
  vi.spyOn(service, 'getEnabledToolScripts').mockReturnValue(scripts)
  return service
}

const text = (result: { content: { type: string; text?: string }[] }): string =>
  result.content.map((part) => part.text ?? '').join('')

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, scriptsEnabled: true }
  ScriptRuns.getInstance().runs.value = []
  vi.restoreAllMocks()
})

describe('a script that asks for parameters', () => {
  it('answers the agent with the form rather than with a refusal', async () => {
    withScripts(script('Card', ASKS))
    const tool = createScriptTools()[0]

    const said = text(await tool.execute('c1', {}))

    expect(said).toContain('needs input')
    expect(said).toContain('answer_form')
    expect(said).toContain('"word"')
    // A select carries what it will accept, so the agent does not guess.
    expect(said).toContain('"en"')
    // And the paragraph the form would have shown a person travels as a note, not as a field.
    expect(said).toContain('A card for a word.')
  })

  it('keeps the run alive while it waits, rather than failing it', async () => {
    withScripts(script('Card', ASKS))

    await createScriptTools()[0].execute('c1', {})

    const runs = ScriptRuns.getInstance().runs.value
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('running')
  })

  it('carries on from where it stopped when the answers arrive', async () => {
    withScripts(script('Card', ASKS))
    const asked = text(await createScriptTools()[0].execute('c1', {}))
    const runId = /run_id "([^"]+)"/.exec(asked)?.[1] ?? ''
    expect(runId).not.toBe('')

    const done = text(
      await createAnswerFormTool().execute('c2', {
        run_id: runId,
        values: '{"word":"apple","lang":"ru"}',
      })
    )

    expect(done).toContain('apple:ru')
    expect(ScriptRuns.getInstance().runs.value[0].status).toBe('done')
  })

  it('asks again when the script has a second question', async () => {
    withScripts(script('Twice', ASKS_TWICE))
    const first = text(await createScriptTools()[0].execute('c1', {}))
    const runId = /run_id "([^"]+)"/.exec(first)?.[1] ?? ''

    const second = text(
      await createAnswerFormTool().execute('c2', { run_id: runId, values: '{"a":"one"}' })
    )
    expect(second).toContain('needs input')
    expect(second).toContain('"b"')

    const done = text(
      await createAnswerFormTool().execute('c3', { run_id: runId, values: '{"b":"two"}' })
    )
    expect(done).toContain('onetwo')
  })

  /** Dismissing the dialog is something a script can handle, and so is this. */
  it('tells the script nobody answered when the agent cancels', async () => {
    withScripts(script('Card', ASKS))
    const asked = text(await createScriptTools()[0].execute('c1', {}))
    const runId = /run_id "([^"]+)"/.exec(asked)?.[1] ?? ''

    const done = text(await createAnswerFormTool().execute('c2', { run_id: runId, cancel: true }))

    expect(done).toContain('nothing was answered')
  })
})

describe('answering something that is not waiting', () => {
  it('says so for a run that has finished or never existed', async () => {
    withScripts(script('Card', ASKS))

    const said = text(
      await createAnswerFormTool().execute('c1', { run_id: 'nope', values: '{"word":"a"}' })
    )

    expect(said).toContain('No run')
  })

  it('asks for the values again when they are not an object', async () => {
    withScripts(script('Card', ASKS))
    const asked = text(await createScriptTools()[0].execute('c1', {}))
    const runId = /run_id "([^"]+)"/.exec(asked)?.[1] ?? ''

    const said = text(
      await createAnswerFormTool().execute('c2', { run_id: runId, values: 'apple' })
    )

    expect(said).toContain('JSON object')
    // And the run is still waiting, so the mistake costs nothing.
    expect(ScriptService.getInstance().pendingForm(runId)).not.toBeNull()
  })
})

/** A script that asks for nothing is not affected by any of this. */
describe('a script that asks for nothing', () => {
  it('answers with its output, as it always did', async () => {
    withScripts(script('Plain', `return 'done'`))

    expect(text(await createScriptTools()[0].execute('c1', {}))).toContain('done')
  })
})
