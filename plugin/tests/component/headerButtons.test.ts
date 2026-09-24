/**
 * Buttons a note's header shows, in the header itself.
 *
 * Which buttons belong to which note, and what they pass, is settled in
 * `tests/unit/headerButtons.test.ts`. What is left — and it is the part that makes the
 * feature exist at all — is that the header draws them, and that pressing one runs the
 * configured script with the note it is sitting on filled into the parameters.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import HeaderView from '@/components/Header.vue'
import TaskHeaderView from '@/components/TaskHeader.vue'
import { TaskHeader } from '@/entities/TaskHeader'
import Icon from '@/components/obsidian/Icon.vue'
import { Header } from '@/entities/Header'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { showFormModal } from '@/scripting/formModal'
import type { ParsedScript } from '@/scripting/types'
import { useVault, configureAbele } from '../helpers/testEnv'

const FILM = 'Films/The Third Man.md'

const fetchDetails: ParsedScript = {
  path: 'Scripts/Fetch.js',
  meta: {
    name: 'Fetch',
    description: '',
    params: [
      { name: 'query', type: 'string', required: false, description: '' },
      { name: 'mode', type: 'string', required: false, description: '', default: 'full' },
    ],
  },
  code: '',
  commandId: 'abele-script-fetch',
}

let execute: ReturnType<typeof vi.fn>
let vault: ReturnType<typeof useVault>

function configureButtons(buttons: Partial<HeaderButtonDefinition>[]) {
  AbeleConfig.getInstance().headerButtons = buttons.map((b, i) => ({
    id: `b${i}`,
    name: 'Fetch details',
    icon: 'download',
    noteTypes: ['movie'],
    scriptName: 'Fetch',
    params: {},
    ...b,
  }))
}

/** A header for the film note, loaded so it knows the note's type. */
async function headerFor(path: string): Promise<Header> {
  const header = new Header({ id: 'h1', filePath: path })
  await header.load()
  return header
}

beforeEach(() => {
  vault = useVault([
    {
      path: FILM,
      frontmatter: { type: 'movie', status: 'watched' },
      content: 'Body.',
    },
    { path: 'Notes/Plain.md', content: 'No type here.' },
    { path: 'Tasks/Water plants.md', frontmatter: { type: 'task', status: 'todo' }, content: '' },
  ])
  // `Header.load` walks the configured journals before it looks at frontmatter, and the
  // header's timer button asks which types are time-trackable — neither is what these are
  // about, so both are given an empty baseline.
  configureAbele()
  const config = AbeleConfig.getInstance()
  config.timeTrackableNoteTypes = []
  config.timeTrackAllNotes = false
  config.headerButtons = []
  execute = vi.fn().mockResolvedValue('')
  const service = ScriptService.getInstance()
  vi.spyOn(service, 'getAll').mockReturnValue([fetchDetails])
  vi.spyOn(service, 'execute').mockImplementation(execute as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The header's own buttons, by the label each shows. */
function buttonLabels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAllComponents(Icon)
    .map((icon) => String(icon.props('textRight') ?? ''))
    .filter(Boolean)
}

describe('a note of a configured type', () => {
  // The settings object is not reactive; the header follows its `version`, which every save
  // and every reload from disk moves.
  it('shows a button configured while the header is already on screen', async () => {
    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })
    expect(buttonLabels(wrapper)).not.toContain('Fetch details')

    configureButtons([{ name: 'Fetch details' }])
    AbeleConfig.getInstance().version.value++
    await nextTick()

    expect(buttonLabels(wrapper)).toContain('Fetch details')
  })

  it('shows the button in its header', async () => {
    configureButtons([{ name: 'Fetch details' }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    expect(buttonLabels(wrapper)).toContain('Fetch details')
  })

  it('runs the configured script when the button is pressed', async () => {
    configureButtons([{ params: { query: '{{title}}' } }])
    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    await wrapper
      .findAllComponents(Icon)
      .find((icon) => icon.props('textRight') === 'Fetch details')!
      .trigger('click')

    expect(execute).toHaveBeenCalledWith(
      'Scripts/Fetch.js',
      {
        query: 'The Third Man',
        mode: 'full',
      },
      { source: 'note', formHandler: showFormModal }
    )
  })

  it('fills the note into the parameters, so the same button means this note', async () => {
    configureButtons([{ params: { query: '{{title}} ({{status}})' } }])
    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    await wrapper
      .findAllComponents(Icon)
      .find((icon) => icon.props('textRight') === 'Fetch details')!
      .trigger('click')

    expect(execute.mock.calls[0][1].query).toBe('The Third Man (watched)')
  })

  it('keeps its buttons together rather than spread across the note', async () => {
    // They were laid out like the journal row, whose three groups belong at the edges and the
    // middle. Two script buttons pushed that far apart read as two unrelated things.
    configureButtons([{ name: 'Fetch details' }, { name: 'Refresh poster' }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    const row = wrapper
      .findAll('.abele-header-view')
      .find((el) => el.text().includes('Fetch details'))!
    expect(row.classes()).not.toContain('abele-header-view--spread')
  })

  it('shows every button configured for that type', async () => {
    configureButtons([{ name: 'Fetch details' }, { name: 'Refresh poster' }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    expect(buttonLabels(wrapper)).toEqual(
      expect.arrayContaining(['Fetch details', 'Refresh poster'])
    )
  })
})

describe('a note of another type', () => {
  it('shows nothing configured for a type it does not have', async () => {
    configureButtons([{ name: 'Fetch details', noteTypes: ['book'] }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    expect(buttonLabels(wrapper)).not.toContain('Fetch details')
  })

  it('shows nothing at all on a note without a type', async () => {
    configureButtons([{ name: 'Fetch details' }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor('Notes/Plain.md') } })

    expect(buttonLabels(wrapper)).not.toContain('Fetch details')
  })
})

describe('a button set up beyond its note types', () => {
  it('shows on a note in its folder, typed or not', async () => {
    configureButtons([{ name: 'Tidy', noteTypes: [], folders: ['Notes'] }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor('Notes/Plain.md') } })

    expect(buttonLabels(wrapper)).toContain('Tidy')
  })

  it('shows on every note when set to', async () => {
    configureButtons([{ name: 'Tidy', noteTypes: [], allNotes: true }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor('Notes/Plain.md') } })

    expect(buttonLabels(wrapper)).toContain('Tidy')
  })

  it('shows nowhere while switched off', async () => {
    configureButtons([{ name: 'Fetch details', enabled: false }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    expect(buttonLabels(wrapper)).not.toContain('Fetch details')
  })

  it('shows only its icon when asked to, and says its name on hover', async () => {
    configureButtons([{ name: 'Fetch details', icon: 'download', iconOnly: true }])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    expect(buttonLabels(wrapper)).not.toContain('Fetch details')
    const icon = wrapper.findAllComponents(Icon).find((i) => i.props('icon') === 'download')!
    expect(icon.props('tooltip')).toBe('Fetch details')
  })
})

describe('a button that asks for properties', () => {
  it('shows only on the notes whose properties it fits', async () => {
    configureButtons([
      { name: 'Rate', conditions: [{ property: 'status', test: 'equals', value: 'watched' }] },
      { id: 'q', name: 'Queue', conditions: [{ property: 'status', test: 'empty', value: '' }] },
    ])

    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    expect(buttonLabels(wrapper)).toContain('Rate')
    expect(buttonLabels(wrapper)).not.toContain('Queue')
  })

  // A property is changed in the note with the header on screen; the header has to follow it
  // without the note being reopened, or the button would answer to what the note used to say.
  it('comes and goes as the property is changed in the open note', async () => {
    configureButtons([
      { name: 'Rate', conditions: [{ property: 'status', test: 'equals', value: 'watched' }] },
    ])
    const wrapper = mount(HeaderView, { props: { header: await headerFor(FILM) } })

    vault.setFrontmatter(FILM, { type: 'movie', status: 'queued' })
    vault.emit('metadataCache', 'changed', vault.vault.getAbstractFileByPath(FILM))
    await nextTick()
    expect(buttonLabels(wrapper)).not.toContain('Rate')

    vault.setFrontmatter(FILM, { type: 'movie', status: 'watched' })
    vault.emit('metadataCache', 'changed', vault.vault.getAbstractFileByPath(FILM))
    await nextTick()
    expect(buttonLabels(wrapper)).toContain('Rate')
  })

  it('asks a task note too', async () => {
    configureButtons([
      {
        name: 'Start',
        noteTypes: ['task'],
        conditions: [{ property: 'status', test: 'equals', value: 'todo' }],
      },
      {
        id: 'done',
        name: 'Archive',
        noteTypes: ['task'],
        conditions: [{ property: 'status', test: 'equals', value: 'done' }],
      },
    ])
    const task = new TaskHeader({ id: 't1', filePath: 'Tasks/Water plants.md' })
    task.loaded = true

    const wrapper = mount(TaskHeaderView, { props: { task } })

    expect(buttonLabels(wrapper)).toContain('Start')
    expect(buttonLabels(wrapper)).not.toContain('Archive')
  })
})

describe('a task note', () => {
  // A task has a header of its own — done, dates, recurrence — and it used to draw no script
  // buttons at all, so a button configured for `task` never appeared anywhere.
  it('shows the buttons configured for tasks, and runs them', async () => {
    configureButtons([{ name: 'Postpone', noteTypes: ['task'], params: { query: '{{title}}' } }])
    // Loading a task reads it out of an open editor, which there is none of here; what the
    // buttons need is only the path, so the task is marked loaded as the editor would leave it.
    const task = new TaskHeader({ id: 't1', filePath: 'Tasks/Water plants.md' })
    task.loaded = true

    const wrapper = mount(TaskHeaderView, { props: { task } })
    await wrapper
      .findAllComponents(Icon)
      .find((icon) => icon.props('textRight') === 'Postpone')!
      .trigger('click')

    expect(execute.mock.calls[0][1].query).toBe('Water plants')
  })
})
