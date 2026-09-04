/**
 * One reference, two readers.
 *
 * The API text used to live inside the AI tool that serves it, which was fine while the agent
 * was the only one who ever read it. The "Show script API reference" command puts the same
 * text in front of a person, and the failure worth guarding against is not a typo — it is a
 * second copy, made by whoever next edits one of the two places.
 */
import { describe, it, expect } from 'vitest'
import { SCRIPT_API_DOCS } from '@/scripting/apiDocs'
import { createScriptApiDocsTool } from '@/ai/tools/CreateScriptTool'
import { SCRIPT_VIEW_DOCS } from '@/scripting/view/viewDocs'
import { VIEW_GLOBALS } from '@/scripting/view/components'

describe('the script API reference', () => {
  it('is what the agent is served, character for character', async () => {
    const result = await createScriptApiDocsTool().execute('call-1', {})

    expect(result.content).toEqual([{ type: 'text', text: SCRIPT_API_DOCS }])
  })

  it('still documents the API it is a reference for', () => {
    expect(SCRIPT_API_DOCS).toContain('# Script API Reference')
    // One entry from each section a script cannot be written without.
    expect(SCRIPT_API_DOCS).toContain('// @name My Script Name')
    expect(SCRIPT_API_DOCS).toContain('`read(path)`')
    expect(SCRIPT_API_DOCS).toContain('`show(markdown, title?)`')
  })
})

describe('the view reference', () => {
  it('is served for section "views" and named from the main reference', async () => {
    const result = await createScriptApiDocsTool().execute('call-2', { section: 'views' })

    expect(result.content).toEqual([{ type: 'text', text: SCRIPT_VIEW_DOCS }])
    expect(SCRIPT_API_DOCS).toContain("section: 'views'")
  })

  it('documents every class the prelude hands a script', () => {
    for (const name of Object.keys(VIEW_GLOBALS)) {
      expect(SCRIPT_VIEW_DOCS, name).toMatch(new RegExp('`' + name + '\\('))
    }
    for (const member of [
      'view(',
      'v.state',
      'v.style(',
      "on('key'",
      "on('vault'",
      'every(',
      'open(',
      'sanitizeHTMLToDom',
    ]) {
      expect(SCRIPT_VIEW_DOCS).toContain(member)
    }
  })
})
