/**
 * Startup scripts: the header line that makes one, the list in the settings that does the same
 * from the script library, which of them a device runs and in what order, and what a script
 * that takes parameters is given when nobody is there to fill in a form.
 */
import { describe, it, expect } from 'vitest'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import {
  movedStartupScript,
  startupParams,
  startupPlace,
  startupQueue,
  startupScriptsFrom,
  withStartupDevices,
  withStartupScript,
  withoutStartupScript,
} from '@/scripting/startupScripts'
import type { ParsedScript } from '@/scripting/types'

const parsed = (header: string, path = 'Scripts/x.js'): ParsedScript => {
  const meta = parseScriptHeader(header)!
  return { path, code: '', commandId: `abele:script-${meta.name.toLowerCase()}`, meta }
}

const ALL = [
  parsed('// @name Daily note', 'Scripts/daily.js'),
  parsed('// @name Sync inbox\n// @startup', 'Scripts/inbox.js'),
  parsed('// @name Archive\n// @startup desktop', 'Scripts/archive.js'),
  parsed('// @name Weather\n// @startup mobile', 'Scripts/weather.js'),
  parsed('// @name Plain', 'Scripts/plain.js'),
]

const names = (list: ParsedScript[]) => list.map((s) => s.meta.name)

describe('the startup header line', () => {
  it('marks a script to run at startup on every device', () => {
    expect(parseScriptHeader('// @name A\n// @startup\nreturn 1')?.startup).toBe('both')
  })

  it('can name the one kind of device it runs on', () => {
    expect(parseScriptHeader('// @name A\n// @startup desktop')?.startup).toBe('desktop')
    expect(parseScriptHeader('// @name A\n// @startup mobile')?.startup).toBe('mobile')
  })

  it('reads a word it does not know as every device', () => {
    expect(parseScriptHeader('// @name A\n// @startup always')?.startup).toBe('both')
  })

  it('is absent from a script that does not say it', () => {
    expect(parseScriptHeader('// @name A\nreturn 1')?.startup).toBeUndefined()
  })
})

describe('the list as stored', () => {
  it('keeps names with their devices, drops blanks, repeats and junk', () => {
    expect(
      startupScriptsFrom([
        { script: 'A', devices: 'mobile' },
        { script: ' B ' },
        { script: 'A', devices: 'desktop' },
        { script: '' },
        'C',
        null,
        { script: 'D', devices: 'toaster' },
      ])
    ).toEqual([
      { script: 'A', devices: 'mobile' },
      { script: 'B', devices: 'both' },
      { script: 'C', devices: 'both' },
      { script: 'D', devices: 'both' },
    ])
  })

  it('is empty when nothing usable is stored', () => {
    expect(startupScriptsFrom(undefined)).toEqual([])
    expect(startupScriptsFrom('A')).toEqual([])
  })
})

describe('which scripts run, in what order', () => {
  it('runs the listed ones in their order, then those with the header line, by name', () => {
    const chosen = startupScriptsFrom(['Plain', 'Daily note'])
    expect(names(startupQueue(ALL, chosen, false))).toEqual([
      'Plain',
      'Daily note',
      'Archive',
      'Sync inbox',
    ])
  })

  it('leaves out on a phone what is for a computer, and the other way round', () => {
    const chosen = [
      { script: 'Plain', devices: 'desktop' as const },
      { script: 'Daily note', devices: 'mobile' as const },
    ]
    expect(names(startupQueue(ALL, chosen, true))).toEqual(['Daily note', 'Sync inbox', 'Weather'])
    expect(names(startupQueue(ALL, chosen, false))).toEqual(['Plain', 'Archive', 'Sync inbox'])
  })

  it('lets the list decide the devices of a script that also has the header line', () => {
    const chosen = [{ script: 'Weather', devices: 'desktop' as const }]
    expect(names(startupQueue(ALL, chosen, false))).toContain('Weather')
    expect(names(startupQueue(ALL, chosen, true))).not.toContain('Weather')
  })

  it('skips a listed name that no script has any more', () => {
    expect(names(startupQueue(ALL, startupScriptsFrom(['Gone', 'Plain']), false))).toEqual([
      'Plain',
      'Archive',
      'Sync inbox',
    ])
  })
})

describe('what the library shows', () => {
  it('says whether the list or the header line put a script there', () => {
    const chosen = startupScriptsFrom(['Plain', 'Sync inbox'])
    expect(startupPlace(ALL[4], chosen)).toBe('setting')
    expect(startupPlace(ALL[1], chosen)).toBe('setting')
    expect(startupPlace(ALL[2], chosen)).toBe('header')
    expect(startupPlace(ALL[0], chosen)).toBeNull()
  })
})

describe('changing the list', () => {
  const list = startupScriptsFrom(['A', 'B', 'C'])

  it('adds at the end once, and takes off', () => {
    expect(withStartupScript(list, 'D').map((s) => s.script)).toEqual(['A', 'B', 'C', 'D'])
    expect(withStartupScript(list, 'B')).toEqual(list)
    expect(withoutStartupScript(list, 'B').map((s) => s.script)).toEqual(['A', 'C'])
  })

  it('moves one up or down, and not past either end', () => {
    expect(movedStartupScript(list, 2, -1).map((s) => s.script)).toEqual(['A', 'C', 'B'])
    expect(movedStartupScript(list, 0, 1).map((s) => s.script)).toEqual(['B', 'A', 'C'])
    expect(movedStartupScript(list, 0, -1)).toEqual(list)
    expect(movedStartupScript(list, 2, 1)).toEqual(list)
  })

  it('changes the devices of one', () => {
    expect(withStartupDevices(list, 'B', 'mobile')[1]).toEqual({ script: 'B', devices: 'mobile' })
  })
})

describe('what a startup script is given', () => {
  it('is its own defaults, typed', () => {
    const script = parsed(
      '// @name P\n// @param n number? "N" = 5\n// @param on boolean? "On" = true\n// @param s string? "S" = "x"\n// @param free string? "Free"'
    )
    expect(startupParams(script)).toEqual({ n: 5, on: true, s: 'x' })
  })

  it('is nothing at all when a required value has no default: the script is not run', () => {
    expect(startupParams(parsed('// @name P\n// @param q string "Query"'))).toBeNull()
  })

  it('is enough when a required value has a default', () => {
    expect(startupParams(parsed('// @name P\n// @param q string "Query" = "today"'))).toEqual({
      q: 'today',
    })
  })
})
