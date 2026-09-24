/**
 * Choosing an icon by looking at it.
 *
 * A header button's icon used to be a text field wanting a Lucide name, which nobody knows by
 * heart. The picker shows the icons Obsidian carries as a grid to click, narrowed by a search
 * field, and can be driven from that field with the keyboard alone.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { getIconIds } from 'obsidian'
import IconPicker from '@/components/obsidian/IconPicker.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { useVault } from '../helpers/testEnv'

const IDS = [
  'lucide-play',
  'lucide-pause',
  'lucide-calendar',
  'lucide-calendar-days',
  'lucide-calendar-clock',
  'my-own-icon',
]

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getIconIds: vi.fn(),
}))

const mounted: Array<ReturnType<typeof mount>> = []

function open(current = 'play', ids = IDS) {
  useVault([])
  vi.mocked(getIconIds).mockReturnValue(ids as never)
  const wrapper = mount(IconPicker, { props: { current } })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

/** The glyphs in the grid, in order. */
const shown = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAllComponents(Icon)
    .filter((i) => i.classes().includes('abele-icon-picker__icon'))
    .map((i) => i.props('icon') as string)

const field = () => document.body.querySelector<HTMLInputElement>('.abele-icon-picker input')!

async function type(text: string) {
  const input = field()
  input.value = text
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

async function key(name: string) {
  field().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  await nextTick()
}

describe('the icon picker', () => {
  it('shows every icon Obsidian has, by the name a button stores', () => {
    const wrapper = open()

    expect(shown(wrapper)).toEqual([
      'calendar',
      'calendar-clock',
      'calendar-days',
      'my-own-icon',
      'pause',
      'play',
    ])
  })

  it('names each icon on hover, so a glyph can be told from its neighbour', () => {
    const wrapper = open()

    const calendar = wrapper.findAllComponents(Icon).find((i) => i.props('icon') === 'calendar')!
    expect(calendar.props('tooltip')).toBe('calendar')
  })

  it('narrows to the icons whose name holds every word typed, best match first', async () => {
    const wrapper = open()

    await type('days cal')
    expect(shown(wrapper)).toEqual(['calendar-days'])

    await type('calendar')
    expect(shown(wrapper)).toEqual(['calendar', 'calendar-clock', 'calendar-days'])
  })

  it('says so when nothing matches', async () => {
    const wrapper = open()

    await type('zebra')

    expect(shown(wrapper)).toEqual([])
    expect(wrapper.findComponent(EmptyState).exists()).toBe(true)
  })

  it('gives back the icon clicked', async () => {
    const wrapper = open()

    const pause = wrapper.findAllComponents(Icon).find((i) => i.props('icon') === 'pause')!
    await pause.trigger('click')

    expect(wrapper.emitted('choose')).toEqual([['pause']])
  })

  it('marks the current icon, and Enter keeps it', async () => {
    const wrapper = open('pause')
    await nextTick()

    const pressed = wrapper.findAllComponents(Icon).filter((i) => i.props('active'))
    expect(pressed.map((i) => i.props('icon'))).toEqual(['pause'])

    await key('Enter')
    expect(wrapper.emitted('choose')).toEqual([['pause']])
  })

  it('walks the grid with the arrow keys from the search field', async () => {
    const wrapper = open('pause')

    await key('ArrowRight')
    await key('Enter')
    await key('ArrowLeft')
    await key('ArrowLeft')
    await key('Enter')

    expect(wrapper.emitted('choose')).toEqual([['play'], ['my-own-icon']])
  })

  it('starts on the first match once something is typed', async () => {
    const wrapper = open('play')

    await type('calendar')
    await key('Enter')

    expect(wrapper.emitted('choose')).toEqual([['calendar']])
  })

  // On the phone the grid kept the place it had been scrolled to, so the matches for a new
  // search started somewhere down the list with their first row cut off.
  it('goes back to the top of the grid when the search changes', async () => {
    open('play')
    const scroller = document.body.querySelector<HTMLElement>('.abele-icon-picker__scroller')!
    scroller.scrollTop = 120

    await type('cal')
    await nextTick()

    expect(scroller.scrollTop).toBe(0)
  })

  it('draws a long list a page at a time, and draws more when asked', async () => {
    const many = Array.from({ length: 700 }, (_, i) => `lucide-icon-${String(i).padStart(3, '0')}`)
    const wrapper = open('', many)

    const first = shown(wrapper).length
    expect(first).toBeLessThan(700)

    const more = wrapper.findAllComponents(Button).find((b) => b.props('text') === 'Show more')!
    await more.trigger('click')

    expect(shown(wrapper).length).toBeGreaterThan(first)
  })
})
