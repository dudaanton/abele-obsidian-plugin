/**
 * Editing what a tool tells the model, in the AI settings.
 *
 * The field opens on the tool's own description, so the person edits from it rather than from
 * an empty box. What is saved is an override and nothing else: text equal to the default,
 * whitespace aside, is no override, and "Reset to default" takes one away.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { codeToolDescriptions } from '@/ai/tools'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS }
})

const open = (toolDescriptions: Record<string, string> = {}) =>
  mount(ToolModesEditor, {
    props: { toolModes: {}, descriptionsOnly: true, showDescriptions: true, toolDescriptions },
    global: { stubs: { Dropdown: true } },
  })

/** The row of one tool, found by its label. */
const rowOf = (w: ReturnType<typeof open>, label: string) =>
  w.findAll('.abele-tool-modes__row').find((r) => r.text().includes(label))!

const edited = (w: ReturnType<typeof open>) =>
  (w.emitted('updateDescription') ?? []) as Array<[string, string]>

describe('a tool with no override', () => {
  it('opens on the tool’s own description', async () => {
    const w = open()
    await rowOf(w, 'List directory').find('.abele-tool-modes__desc-btn').trigger('click')

    const area = rowOf(w, 'List directory').find('textarea')
    expect((area.element as HTMLTextAreaElement).value).toBe(codeToolDescriptions().ls)
    expect(rowOf(w, 'List directory').text()).not.toContain('Reset to default')
  })

  it('saves what the person changed', async () => {
    const w = open()
    await rowOf(w, 'List directory').find('.abele-tool-modes__desc-btn').trigger('click')
    await rowOf(w, 'List directory').find('textarea').setValue('List a folder of mine.')

    expect(edited(w).at(-1)).toEqual(['ls', 'List a folder of mine.'])
  })

  it('saves nothing for text that is the default again, whitespace aside', async () => {
    const w = open()
    await rowOf(w, 'List directory').find('.abele-tool-modes__desc-btn').trigger('click')
    await rowOf(w, 'List directory')
      .find('textarea')
      .setValue(`  ${codeToolDescriptions().ls.replace(/ /g, '\n')}  `)

    expect(edited(w).at(-1)).toEqual(['ls', ''])
  })
})

describe('a tool with an override', () => {
  it('shows it, and resets to the default on request', async () => {
    const w = open({ ls: 'List a folder of mine.' })
    const row = rowOf(w, 'List directory')
    expect((row.find('textarea').element as HTMLTextAreaElement).value).toBe(
      'List a folder of mine.'
    )

    const reset = row.findAll('button').find((b) => b.text().includes('Reset to default'))!
    await reset.trigger('click')
    expect(edited(w).at(-1)).toEqual(['ls', ''])
  })
})
