/**
 * Scripts on the toolbar: the header line that puts one there, the list in the settings that
 * does the same from the script library, and what that means for the phone's toolbar above the
 * keyboard — which is Obsidian's own list of commands, kept in the app's config.
 */
import { describe, it, expect } from 'vitest'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import {
  mobileToolbarNext,
  toolbarCommandId,
  toolbarPlace,
  toolbarScripts,
  toolbarScriptsFrom,
  withToolbarScript,
  withoutToolbarScript,
} from '@/scripting/scriptToolbar'
import type { ParsedScript } from '@/scripting/types'

const parsed = (header: string, path = 'Scripts/x.js'): ParsedScript => {
  const meta = parseScriptHeader(header)!
  return { path, code: '', commandId: `abele:script-${meta.name.toLowerCase()}`, meta }
}

const ALL = [
  parsed('// @name Translate\n// @icon languages', 'Scripts/translate.js'),
  parsed('// @name Word card\n// @toolbar', 'Scripts/card.js'),
  parsed('// @name Anki\n// @toolbar', 'Scripts/anki.js'),
  parsed('// @name Plain', 'Scripts/plain.js'),
]

describe('the toolbar header line', () => {
  it('marks a script for the toolbar', () => {
    expect(parseScriptHeader('// @name A\n// @toolbar\nreturn 1')?.toolbar).toBe(true)
  })

  it('is absent from a script that does not say it', () => {
    expect(parseScriptHeader('// @name A\nreturn 1')?.toolbar).toBeUndefined()
  })
})

describe('the toolbar list', () => {
  it('is kept as names, blanks and repeats dropped', () => {
    expect(toolbarScriptsFrom(['Translate', '', 'Translate', 3, ' Plain '])).toEqual([
      'Translate',
      'Plain',
    ])
    expect(toolbarScriptsFrom(undefined)).toEqual([])
  })

  it('offers the chosen ones in their order, then those put there by their header, by name', () => {
    expect(toolbarScripts(ALL, ['Plain', 'Gone', 'Translate']).map((s) => s.meta.name)).toEqual([
      'Plain',
      'Translate',
      'Anki',
      'Word card',
    ])
  })

  it('says whether a script is there by the settings or by its header', () => {
    expect(toolbarPlace(ALL[0], ['Translate'])).toBe('setting')
    expect(toolbarPlace(ALL[1], [])).toBe('header')
    expect(toolbarPlace(ALL[3], [])).toBeNull()
  })

  it('adds and takes away by name', () => {
    expect(withToolbarScript(['A'], 'B')).toEqual(['A', 'B'])
    expect(withToolbarScript(['A'], 'A')).toEqual(['A'])
    expect(withoutToolbarScript(['A', 'B'], 'A')).toEqual(['B'])
  })

  it('names the command the way Obsidian registers it: the plugin id in front', () => {
    expect(toolbarCommandId('abele', ALL[0])).toBe('abele:abele:script-translate')
  })
})

describe('the phone toolbar', () => {
  const EDIT = ['editor:undo', 'editor:toggle-bold']

  it('gets a script at its start, once, and remembers that it was put there', () => {
    const next = mobileToolbarNext(EDIT, [{ id: 's:a', path: 'a.js' }], {})
    expect(next.commands).toEqual(['s:a', ...EDIT])
    expect(next.offered).toEqual({ 's:a': 'a.js' })
    expect(next.changed).toBe(true)
  })

  it('puts several in their own order, ahead of what was there', () => {
    const next = mobileToolbarNext(
      EDIT,
      [
        { id: 's:a', path: 'a.js' },
        { id: 's:b', path: 'b.js' },
      ],
      {}
    )
    expect(next.commands).toEqual(['s:a', 's:b', ...EDIT])
  })

  it('changes nothing when it is already there', () => {
    const next = mobileToolbarNext([...EDIT, 's:a'], [{ id: 's:a', path: 'a.js' }], {
      's:a': 'a.js',
    })
    expect(next.commands).toEqual([...EDIT, 's:a'])
    expect(next.changed).toBe(false)
  })

  it('does not put back one the person took off the toolbar themselves', () => {
    const next = mobileToolbarNext(EDIT, [{ id: 's:a', path: 'a.js' }], { 's:a': 'a.js' })
    expect(next.commands).toEqual(EDIT)
    expect(next.offered).toEqual({ 's:a': 'a.js' })
    expect(next.changed).toBe(false)
  })

  it('takes off only what it put there', () => {
    const next = mobileToolbarNext(['s:mine', ...EDIT, 's:a'], [], { 's:a': 'a.js' })
    expect(next.commands).toEqual(['s:mine', ...EDIT])
    expect(next.offered).toEqual({})
  })

  it('does not add a second copy of one the person had already put there', () => {
    const next = mobileToolbarNext(['s:a', ...EDIT], [{ id: 's:a', path: 'a.js' }], {})
    expect(next.commands).toEqual(['s:a', ...EDIT])
    expect(next.changed).toBe(false)
  })

  it('keeps a renamed script in its place: same file, new command', () => {
    const next = mobileToolbarNext(
      ['editor:undo', 's:old', 'editor:toggle-bold'],
      [{ id: 's:new', path: 'a.js' }],
      { 's:old': 'a.js' }
    )
    expect(next.commands).toEqual(['editor:undo', 's:new', 'editor:toggle-bold'])
    expect(next.offered).toEqual({ 's:new': 'a.js' })
  })

  it('leaves a renamed script off when the person had taken it off', () => {
    const next = mobileToolbarNext(EDIT, [{ id: 's:new', path: 'a.js' }], { 's:old': 'a.js' })
    expect(next.commands).toEqual(EDIT)
    expect(next.offered).toEqual({ 's:new': 'a.js' })
  })
})
