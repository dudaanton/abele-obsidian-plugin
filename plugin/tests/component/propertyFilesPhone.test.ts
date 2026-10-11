/**
 * File properties as cards. On a desktop each card carries an arrow to open the file and a cross
 * to take it out, and pressing the card picks another file in its place. A phone's cell is too
 * narrow for a name and two glyphs a finger can hit: there the card is only its name, and a tap
 * offers what the glyphs do in a menu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { Menu, Platform, TFile } from 'obsidian'
import PropertyFiles from '@/components/properties/PropertyFiles.vue'
import { useVault } from '../helpers/testEnv'

const { pickAnyFile } = vi.hoisted(() => ({ pickAnyFile: vi.fn() }))
vi.mock('@/helpers/suggesters/VaultFilePicker', () => ({ pickAnyFile }))

let openFile: ReturnType<typeof vi.fn>
let wrapper: VueWrapper | undefined

beforeEach(() => {
  const app = useVault([
    { path: 'Samples/plan.md', content: 'A sample plan' },
    { path: 'Samples/other.md', content: 'Another sample' },
  ])
  openFile = vi.fn()
  Object.assign(app.workspace, { getLeaf: () => ({ openFile }) })
  Object.assign(app.metadataCache, { fileToLinktext: (file: TFile) => file.path })
  pickAnyFile.mockResolvedValue(app.vault.getAbstractFileByPath('Samples/other.md'))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  Platform.isPhone = false
  vi.restoreAllMocks()
})

const draw = (props: Record<string, unknown> = {}) =>
  (wrapper = mount(PropertyFiles, {
    props: {
      entries: ['Samples/plan.md', 'Samples/missing.md'],
      sourcePath: 'Samples/note.md',
      multiple: true,
      ...props,
    },
  }))
const cards = () => wrapper!.findAll('.abele-property-files__card')

/** The menu a tap on a card opened, and its items by title. */
async function tap(index: number) {
  const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  await cards()[index].trigger('click')
  const menu = shown.mock.contexts.at(-1) as Menu | undefined
  return menu
}

describe('file cards on a desktop', () => {
  it('keep their open and remove glyphs, and a press picks another file', async () => {
    const menu = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    draw()
    expect(cards()[0].find('.abele-property-files__open').exists()).toBe(true)
    expect(cards()[0].find('.abele-property-files__remove').exists()).toBe(true)

    await cards()[0].trigger('click')
    await flushPromises()
    expect(menu).not.toHaveBeenCalled()
    expect(pickAnyFile).toHaveBeenCalledOnce()
    expect(wrapper!.emitted('change')).toEqual([[['[[Samples/other.md]]', 'Samples/missing.md']]])
  })
})

describe('file cards on a phone', () => {
  beforeEach(() => {
    Platform.isPhone = true
  })

  it('carry no glyphs, and a tap offers open, another file and remove', async () => {
    draw()
    expect(wrapper!.find('.abele-property-files__open').exists()).toBe(false)
    expect(wrapper!.find('.abele-property-files__remove').exists()).toBe(false)

    const menu = await tap(0)
    expect(menu!.items.map((i) => i.title)).toEqual(['Open', 'Choose another file', 'Remove'])
    expect(menu!.items.find((i) => i.title === 'Remove')!.warning).toBe(true)
    // The tap itself changes nothing: it only asks.
    expect(pickAnyFile).not.toHaveBeenCalled()
    expect(wrapper!.emitted('change')).toBeUndefined()
  })

  it('offers no Open for a file that is not there, and says picture for a cover', async () => {
    draw()
    expect((await tap(1))!.items.map((i) => i.title)).toEqual(['Choose another file', 'Remove'])
    wrapper!.unmount()

    draw({ entries: ['Samples/plan.md'], multiple: false, imagesOnly: true })
    expect((await tap(0))!.items.map((i) => i.title)).toContain('Choose another picture')
  })

  it('does what each item says', async () => {
    draw()
    const item = async (index: number, title: string) =>
      (await tap(index))!.items.find((i) => i.title === title)!.handler!()

    await item(0, 'Open')
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'Samples/plan.md' }))

    await item(0, 'Choose another file')
    await flushPromises()
    expect(pickAnyFile).toHaveBeenCalledOnce()
    expect(wrapper!.emitted('change')![0]).toEqual([['[[Samples/other.md]]', 'Samples/missing.md']])

    await item(1, 'Remove')
    expect(wrapper!.emitted('change')![1]).toEqual([['Samples/plan.md']])
  })

  it('opens the menu under a card chosen with Enter', async () => {
    draw()
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    await cards()[0].trigger('keydown', { key: 'Enter' })
    const menu = shown.mock.contexts.at(-1) as Menu
    expect(menu.items.map((i) => i.title)).toEqual(['Open', 'Choose another file', 'Remove'])
  })
})
