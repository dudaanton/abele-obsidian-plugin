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
import HeaderView from '@/components/Header.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { Header } from '@/entities/Header'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
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
  useVault([
    {
      path: FILM,
      frontmatter: { type: 'movie', status: 'watched' },
      content: 'Body.',
    },
    { path: 'Notes/Plain.md', content: 'No type here.' },
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

    expect(execute).toHaveBeenCalledWith('Scripts/Fetch.js', {
      query: 'The Third Man',
      mode: 'full',
    })
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
