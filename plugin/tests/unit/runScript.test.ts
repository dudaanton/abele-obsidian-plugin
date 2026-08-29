/**
 * Running a script by name, on behalf of a link or a button.
 *
 * The parameters are the substance here. A script declares its own defaults, and whatever
 * asked for the run supplies values on top — and an empty value is not a value. Passing one
 * on would overwrite a default with nothing, which is how a field left blank in the settings
 * would quietly change what the script does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Notice } from 'obsidian'
import { ScriptService } from '@/scripting/ScriptService'
import type { ParsedScript, ScriptParam } from '@/scripting/types'
import { scriptParams, findScriptByName, runScriptByName } from '@/scripting/runScript'

function param(name: string, rest: Partial<ScriptParam> = {}): ScriptParam {
  return { name, type: 'string', required: false, description: '', ...rest }
}

function script(name: string, params: ScriptParam[] = []): ParsedScript {
  return {
    path: `Scripts/${name}.js`,
    meta: { name, description: '', params },
    code: '',
    commandId: `abele-script-${name}`,
  }
}

const fetchDetails = script('Fetch', [
  param('query'),
  param('mode', { default: 'full' }),
  param('depth', { default: '2' }),
])

let execute: ReturnType<typeof vi.fn>

beforeEach(() => {
  Notice.shown.length = 0
  execute = vi.fn().mockResolvedValue('')
  const service = ScriptService.getInstance()
  vi.spyOn(service, 'getAll').mockReturnValue([fetchDetails])
  vi.spyOn(service, 'execute').mockImplementation(execute as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('finding a script', () => {
  it('goes by the name the script declares, which is the name the settings show', () => {
    expect(findScriptByName('Fetch')).toBe(fetchDetails)
  })

  it('finds nothing for a name no script answers to', () => {
    expect(findScriptByName('Missing')).toBeUndefined()
  })
})

describe('deciding what to pass a script', () => {
  it("starts from the script's own defaults", () => {
    expect(scriptParams(fetchDetails, {})).toEqual({ mode: 'full', depth: '2' })
  })

  it('lets a supplied value override a default', () => {
    expect(scriptParams(fetchDetails, { mode: 'brief' })).toEqual({ mode: 'brief', depth: '2' })
  })

  it('passes a value for a parameter that has no default', () => {
    expect(scriptParams(fetchDetails, { query: 'The Third Man' })).toEqual({
      query: 'The Third Man',
      mode: 'full',
      depth: '2',
    })
  })

  it('treats an empty value as nothing said, leaving the default in place', () => {
    expect(scriptParams(fetchDetails, { mode: '' })).toEqual({ mode: 'full', depth: '2' })
  })

  it('passes nothing for a parameter that has neither a default nor a value', () => {
    expect(scriptParams(fetchDetails, {})).not.toHaveProperty('query')
  })
})

describe('running one', () => {
  it('executes it at its own path, with the parameters decided above', async () => {
    await runScriptByName('Fetch', { query: 'The Third Man' })

    expect(execute).toHaveBeenCalledWith('Scripts/Fetch.js', {
      query: 'The Third Man',
      mode: 'full',
      depth: '2',
    },
      { source: 'note' }
    )
  })

  it('says so rather than executing anything when the name matches no script', async () => {
    await runScriptByName('Missing', {}, 'Abele link')

    expect(execute).not.toHaveBeenCalled()
    // The label names whatever asked for the run, so a broken deeplink says it is a deeplink.
    expect(Notice.shown).toEqual(['Abele link: script "Missing" not found'])
  })

  it('shows what the script returned, since a script speaks through its result', async () => {
    execute.mockResolvedValue('Found 3 matches.')

    await runScriptByName('Fetch', {})

    expect(Notice.shown).toEqual(['Found 3 matches.'])
  })

  it('says nothing when the script returned nothing', async () => {
    execute.mockResolvedValue('   ')

    await runScriptByName('Fetch', {})

    expect(Notice.shown).toEqual([])
  })

  it('survives a script that throws, so a failure is reported and not swallowed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    execute.mockRejectedValue(new Error('boom'))

    await expect(runScriptByName('Fetch', {})).resolves.toBeUndefined()

    expect(Notice.shown).toEqual(['Abele error: boom'])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
