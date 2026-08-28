/**
 * Choosing the script a header button runs, or the command a link runs.
 *
 * These settings were dropdowns until a vault had enough scripts that scrolling one on a
 * phone stopped being reasonable. What replaced them is Obsidian's fuzzy picker, so the
 * matching itself is Obsidian's — what the plugin still decides is which items are offered,
 * what text the query is matched against, what a row shows, and what the caller is handed
 * when the modal closes without a choice.
 *
 * The modal is reached through its own `open`: the picker is opened for the caller rather
 * than handed to it, so that call is where an instance can be caught.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { App, Command, FuzzyMatch } from 'obsidian'
import { FuzzySuggestModal } from 'obsidian'
import { pickScript, pickCommand, listCommands } from '@/helpers/suggesters/RunnablePicker'
import type { ParsedScript } from '@/scripting/types'

function script(name: string, description = ''): ParsedScript {
  return {
    path: `Scripts/${name}.js`,
    meta: { name, description, params: [] },
    code: '',
    commandId: `abele-script-${name}`,
  }
}

const fetchDetails = script('Fetch details', 'Fills a film note from the API.')
const rename = script('Rename')

const commands: Command[] = [
  { id: 'editor:toggle-bold', name: 'Toggle bold' },
  { id: 'app:go-back', name: 'Navigate back' },
]

let app: App
let openSpy: ReturnType<typeof vi.spyOn>

/** The picker that was opened last, as the modal it is. */
const opened = () =>
  openSpy.mock.contexts[openSpy.mock.contexts.length - 1] as FuzzySuggestModal<unknown>

beforeEach(() => {
  app = { commands: { listCommands: () => commands } } as unknown as App
  openSpy = vi.spyOn(FuzzySuggestModal.prototype, 'open').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * One rendered row, as the modal draws it. Obsidian gives every element a `createDiv`; the
 * DOM the tests run against does not, so the row is given one.
 */
function row(item: unknown): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'createDiv', {
    value: ({ cls, text }: { cls?: string; text?: string } = {}) => {
      const child = document.createElement('div')
      if (cls) child.className = cls
      if (text) child.textContent = text
      el.appendChild(child)
      return child
    },
  })
  opened().renderSuggestion({ item, match: { score: 0, matches: [] } } as FuzzyMatch<unknown>, el)
  return el
}

describe('choosing a script', () => {
  it('offers the scripts it was given, and nothing else', async () => {
    void pickScript(app, [fetchDetails, rename])

    expect(opened().getItems()).toEqual([fetchDetails, rename])
  })

  it('matches the query against the description too, so a script is findable by what it does', () => {
    void pickScript(app, [fetchDetails])

    expect(opened().getItemText(fetchDetails)).toBe('Fetch details Fills a film note from the API.')
  })

  it('shows the description under the name', () => {
    void pickScript(app, [fetchDetails])

    const el = row(fetchDetails)
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('Fetch details')
    expect(el.querySelector('.suggestion-note')?.textContent).toBe(
      'Fills a film note from the API.'
    )
  })

  it('leaves the second line out of a script that describes nothing', () => {
    void pickScript(app, [rename])

    expect(row(rename).querySelector('.suggestion-note')).toBeNull()
  })

  it('hands back what was taken', async () => {
    const picked = pickScript(app, [fetchDetails, rename])

    opened().onChooseItem(rename, new MouseEvent('click'))

    await expect(picked).resolves.toBe(rename)
  })

  it('hands back nothing when the modal is closed without a choice', async () => {
    const picked = pickScript(app, [fetchDetails])

    opened().onClose()

    await expect(picked).resolves.toBeNull()
  })

  it('keeps what was taken even though closing follows the choice', async () => {
    const picked = pickScript(app, [fetchDetails])

    opened().onChooseItem(fetchDetails, new MouseEvent('click'))
    opened().onClose()

    await expect(picked).resolves.toBe(fetchDetails)
  })
})

describe('choosing a command', () => {
  it('offers every command Obsidian knows, by name', () => {
    void pickCommand(app)

    expect(
      opened()
        .getItems()
        .map((c) => (c as Command).name)
    ).toEqual(['Navigate back', 'Toggle bold'])
  })

  it('hands back the command, whose id is what a link stores', async () => {
    const picked = pickCommand(app)

    opened().onChooseItem(commands[0], new MouseEvent('click'))

    await expect(picked).resolves.toBe(commands[0])
  })

  it('is listed unsorted for callers that only need a name for an id', () => {
    expect(listCommands(app)).toBe(commands)
  })
})
