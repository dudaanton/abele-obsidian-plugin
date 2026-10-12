/**
 * The sidebar of what has been run.
 *
 * Nothing about a run is written to the vault, so this list is the only record there is: it has
 * to show what happened and when, what the script printed, and offer the two things a person
 * wants after reading that — the same run again, or the same script with the values rethought.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Notice } from 'obsidian'
import ScriptRunsView from '@/components/ScriptRuns.vue'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { ScriptService } from '@/scripting/ScriptService'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const { showFormModal } = vi.hoisted(() => ({ showFormModal: vi.fn() }))
vi.mock('@/scripting/formModal', () => ({ showFormModal }))

const script: ParsedScript = {
  path: 'Scripts/tag.js',
  code: '',
  commandId: 'abele:script-tag-notes',
  meta: {
    name: 'Tag notes',
    description: '',
    params: [{ name: 'tag', type: 'string', required: true, description: 'Tag to add' }],
  },
}

let runs: ScriptRuns
let execute: ReturnType<typeof vi.fn>
let admit: ReturnType<typeof vi.fn>

const open = () => mount(ScriptRunsView)
type Screen = ReturnType<typeof open>

const rowFor = (wrapper: Screen, name: string) =>
  wrapper.findAll('.abele-runs__run').find((r) => r.find('.abele-runs__name').text() === name)

const expand = async (wrapper: Screen, name: string) => {
  await rowFor(wrapper, name)?.find('.abele-runs__row').trigger('click')
}

/** The run's actions are glyphs; each is pressed by the words it carries for a screen reader. */
const press = async (wrapper: Screen, name: string, label: string) => {
  await rowFor(wrapper, name)?.get(`button[aria-label="${label}"]`).trigger('click')
  await flushPromises()
}
const actionsOf = (wrapper: Screen, name: string) =>
  rowFor(wrapper, name)!
    .findAll('.abele-runs__actions button')
    .map((b) => b.attributes('aria-label'))

const STOP = 'Stop this run'
const AGAIN = 'Run again with the same values'
const AS_NEW = 'Run again, asking for the values'

const began = (over: Partial<Parameters<ScriptRuns['start']>[0]> = {}) =>
  runs.start({
    path: 'Scripts/tag.js',
    name: 'Tag notes',
    params: { tag: 'todo' },
    source: 'command',
    stop: () => {},
    ...over,
  })

beforeEach(() => {
  useVault([])
  ScriptRuns.destroy()
  runs = ScriptRuns.getInstance()
  execute = vi.fn().mockResolvedValue('')
  admit = vi.fn().mockResolvedValue(script)
  vi.spyOn(ScriptService, 'getInstance').mockReturnValue({
    execute,
    admit,
    getAll: () => [script],
  } as unknown as ScriptService)
  showFormModal.mockReset()
})

describe('with nothing run yet', () => {
  it('says so rather than showing an empty box', () => {
    const view = open()
    expect(view.get('.abele-empty-state__title').text()).toBe('Nothing has run yet')
    expect(view.text()).toContain('Each script run this session shows here')
  })
})

describe('the list', () => {
  it('has a row per run, the newest first', () => {
    began({ name: 'First' })
    began({ name: 'Second' })

    const names = open()
      .findAll('.abele-runs__name')
      .map((n) => n.text())

    expect(names).toEqual(['Second', 'First'])
  })

  it('counts what is running at the top', () => {
    began()

    expect(open().find('.abele-section__heading').text()).toBe('1 running')
  })

  it('says how many ran once they are all done', () => {
    runs.finish(began(), '')
    runs.finish(began(), '')

    expect(open().find('.abele-section__heading').text()).toBe('2 runs')
  })

  it('marks out a run that came from somewhere other than the palette', () => {
    runs.finish(began({ source: 'agent', name: 'From agent' }), '')
    runs.finish(began({ name: 'From palette' }), '')
    const wrapper = open()
    const meta = (name: string) =>
      rowFor(wrapper, name)!.get('.abele-runs__meta').text().replace(/\s+/g, ' ')

    expect(wrapper.find('.abele-badge').exists()).toBe(false)
    expect(meta('From agent')).toMatch(/^agent · \d\d:\d\d · \d+ms$/)
    // The palette is where a run usually comes from, so it is not said.
    expect(meta('From palette')).toMatch(/^\d\d:\d\d · \d+ms$/)
  })

  it('says what a running script last said in place of where it came from', () => {
    const id = began({ source: 'agent' })
    runs.setNote(id, 'Tagging the third note')
    const meta = open().get('.abele-runs__meta').text().replace(/\s+/g, ' ')

    expect(meta).toMatch(/^Tagging the third note · \d\d:\d\d · /)
    expect(meta).not.toContain('agent')
  })

  it('opens and closes a run as a button, by click or Enter', async () => {
    runs.finish(began(), '')
    const wrapper = open()
    const row = wrapper.get('.abele-runs__row')

    expect(row.attributes('role')).toBe('button')
    expect(row.attributes('aria-expanded')).toBe('false')
    await row.trigger('keydown', { key: 'Enter' })
    expect(row.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.abele-runs__detail').exists()).toBe(true)
    await row.trigger('click')
    expect(wrapper.find('.abele-runs__detail').exists()).toBe(false)
  })

  /** Stopped is a decision and failed is a fault; the row must not colour them alike. */
  it('tells a stopped run apart from a failed one', () => {
    runs.markStopped(began({ name: 'Stopped' }))
    runs.fail(began({ name: 'Broken' }), 'boom')
    const wrapper = open()

    expect(rowFor(wrapper, 'Stopped')?.classes()).toContain('abele-runs__run_stopped')
    expect(rowFor(wrapper, 'Broken')?.classes()).toContain('abele-runs__run_failed')
  })
})

describe('opening a run', () => {
  it('shows what it printed, each line with its time', async () => {
    const id = began()
    runs.append(id, 'reading 12 notes')
    runs.finish(id, 'reading 12 notes\ndone')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')

    const line = wrapper.get('p.abele-runs__line')
    expect(line.get('.abele-runs__line-at').text()).toMatch(/^\d\d:\d\d:\d\d$/)
    expect(line.text()).toMatch(/^\d\d:\d\d:\d\d\s+reading 12 notes$/)
  })

  /** `execute` returns the printed lines and the result together; the lines are already above. */
  it('does not print the log a second time as the result', async () => {
    const id = began()
    runs.append(id, 'reading 12 notes')
    runs.finish(id, 'reading 12 notes\n12 tagged')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')

    expect(wrapper.find('.abele-runs__result').text()).toBe('12 tagged')
  })

  it('shows what it was given', async () => {
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')

    const facts = wrapper.get('.abele-runs__facts')
    expect(facts.get('.abele-runs__path').text()).toBe('Scripts/tag.js')
    expect(facts.get('.abele-runs__param').text()).toBe('tag: todo')
  })

  it('shows why it failed, and shows it as an error', async () => {
    runs.fail(began(), 'read is not a function')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')

    expect(wrapper.find('.abele-runs__error').text()).toBe('read is not a function')
  })
})

describe('stopping a run', () => {
  it('is offered only while it is going, and stops it', async () => {
    const stop = vi.fn()
    began({ stop })
    const wrapper = open()

    await expand(wrapper, 'Tag notes')
    expect(rowFor(wrapper, 'Tag notes')!.find('.abele-runs__stop').exists()).toBe(true)
    // While it goes there is nothing to run again or take off the list.
    expect(actionsOf(wrapper, 'Tag notes')).toEqual([STOP, 'Open the script'])
    await press(wrapper, 'Tag notes', STOP)

    expect(stop).toHaveBeenCalled()
  })

  it('is not offered once it has ended', async () => {
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')

    expect(actionsOf(wrapper, 'Tag notes')).toEqual([
      AGAIN,
      AS_NEW,
      'Open the script',
      'Take this run off the list',
    ])
  })
})

describe('running it again', () => {
  it('is not offered for a run an interceptor made, which had a message to run on', async () => {
    runs.finish(began({ source: 'interceptor' }), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')

    expect(actionsOf(wrapper, 'Tag notes')).toEqual([
      'Open the script',
      'Take this run off the list',
    ])
  })

  it.each([AGAIN, AS_NEW])(
    'keeps the captured chat identity and backlink for %s',
    async (button) => {
      const selection = {
        text: 'seed',
        sentence: 'A seed grows.',
        title: 'Sample',
        pathHint: 'Sample.abchat',
        backlink: '[[Sample.abchat#address|Return]]',
        anchorId: 'anchor-1',
        source: {
          kind: 'chat' as const,
          chatId: 'chat-1',
          messageId: 'message-1',
          revisionId: 'revision-1',
          role: 'user' as const,
          author: 'Reader',
          quote: 'seed',
          projectionVersion: 'plain-1',
          range: { space: 'rendered' as const, start: 2, end: 6 },
          context: { before: 'A ', after: ' grows.' },
        },
      }
      showFormModal.mockResolvedValue({ tag: 'later' })
      runs.finish(began({ source: 'chat-selection', selection }), '')
      const wrapper = open()
      expect(wrapper.get('.abele-runs__meta').text()).toMatch(/^chat selection · /)
      await expand(wrapper, 'Tag notes')
      await press(wrapper, 'Tag notes', button)
      expect(execute).toHaveBeenCalledWith(
        'Scripts/tag.js',
        expect.any(Object),
        expect.objectContaining({ source: 'chat-selection', selection })
      )
      wrapper.unmount()
    }
  )

  it('goes with the same values, without asking anything', async () => {
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AGAIN)

    expect(execute).toHaveBeenCalledWith(
      'Scripts/tag.js',
      { tag: 'todo' },
      expect.objectContaining({ source: 'command' })
    )
    expect(showFormModal).not.toHaveBeenCalled()
  })

  it('leaves the run it came from where it is', async () => {
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AGAIN)

    expect(runs.runs.value).toHaveLength(1)
  })
})

describe('running it as new', () => {
  it('still says when the script is gone instead of silently dropping the action', async () => {
    Notice.shown.length = 0
    admit.mockRejectedValue(new Error('Script not found: Scripts/tag.js'))
    runs.finish(began(), '')
    const wrapper = open()
    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AS_NEW)
    expect(Notice.shown).toContain('Script not found: Scripts/tag.js')
    expect(showFormModal).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('admits before the form and runs nothing when the script is left unconfirmed', async () => {
    admit.mockRejectedValue(new Error('Not confirmed'))
    runs.finish(began({ source: 'chat-selection' }), '')
    const wrapper = open()
    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AS_NEW)
    expect(admit).toHaveBeenCalledWith('Scripts/tag.js', 'chat-selection')
    expect(showFormModal).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('asks for the values again, starting from the ones it had', async () => {
    showFormModal.mockResolvedValue(null)
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AS_NEW)

    // The window is named after the script, as when it was first run.
    expect(showFormModal).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'tag', label: 'Tag to add', default: 'todo' })],
      undefined,
      undefined,
      'Tag notes'
    )
  })

  it('runs with the answers given', async () => {
    showFormModal.mockResolvedValue({ tag: 'later' })
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AS_NEW)

    expect(execute).toHaveBeenCalledWith(
      'Scripts/tag.js',
      { tag: 'later' },
      expect.objectContaining({ source: 'command' })
    )
  })

  it('runs nothing when the form was dismissed', async () => {
    showFormModal.mockResolvedValue(null)
    runs.finish(began(), '')
    const wrapper = open()

    await expand(wrapper, 'Tag notes')
    await press(wrapper, 'Tag notes', AS_NEW)

    expect(execute).not.toHaveBeenCalled()
  })
})

describe('clearing the list', () => {
  it('takes away what has ended and keeps what has not', async () => {
    runs.finish(began({ name: 'Done' }), '')
    began({ name: 'Going' })
    const wrapper = open()

    await wrapper.find('.abele-section__actions .abele-obsidian-icon').trigger('click')

    expect(wrapper.findAll('.abele-runs__name').map((n) => n.text())).toEqual(['Going'])
  })
})
