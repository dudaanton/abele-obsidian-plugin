/**
 * The quick button's rules, apart from any screen: what its settings may hold, where it rests,
 * when it is out of the way, and when it is not there at all. The component and the phone
 * pictures build on these; here they are held to exact numbers.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_QUICK_BUTTON, quickButtonSettingsFrom } from '@/quickButton/settings'
import { buttonTop, restLine, sideFor, liftFor, type Box } from '@/quickButton/placement'
import { ScrollWatch, goneReason, type QuickSignals } from '@/quickButton/visibility'

describe('the settings', () => {
  it('are off by default, on the right, with nothing of the user’s own yet', () => {
    expect(quickButtonSettingsFrom(undefined)).toEqual(DEFAULT_QUICK_BUTTON)
    expect(DEFAULT_QUICK_BUTTON).toMatchObject({ enabled: false, tablet: false, side: 'right' })
    expect(DEFAULT_QUICK_BUTTON.actions).toEqual([])
  })

  it('keep what is valid and drop what is not', () => {
    const s = quickButtonSettingsFrom({
      enabled: true,
      side: 'up' as never,
      lift: -40,
      actions: [
        { id: 'a', type: 'command', commandId: 'app:reload', name: 'Reload', icon: 'refresh' },
        { id: 'b', type: 'script', scriptName: 'Add film' },
        { type: 'command' } as never,
        'nonsense' as never,
      ],
    })
    expect(s.enabled).toBe(true)
    expect(s.side).toBe('right')
    expect(s.lift).toBe(0)
    expect(s.actions.map((a) => a.id)).toEqual(['a', 'b'])
    expect(s.actions[1]).toEqual({
      id: 'b',
      type: 'script',
      scriptName: 'Add film',
      commandId: '',
      name: '',
      icon: '',
    })
  })

  it('never hands out the stored lists themselves', () => {
    const stored = { actions: [{ id: 'a', type: 'command' as const, commandId: 'x' }] }
    const s = quickButtonSettingsFrom(stored)
    s.actions.push({ id: 'z', type: 'script', scriptName: '', commandId: '', name: '', icon: '' })
    expect(stored.actions).toHaveLength(1)
  })
})

const screen = { width: 390, height: 844 }
const navbar: Box = { left: 37, right: 353, top: 760, bottom: 812 }

describe('where it rests', () => {
  it('stands on the highest thing at the bottom its column would meet', () => {
    const column = { left: 322, right: 374 }
    const foot: Box = { left: 0, right: 390, top: 700, bottom: 740 }
    expect(restLine([navbar], column, screen.height)).toBe(760)
    expect(restLine([navbar, foot], column, screen.height)).toBe(700)
  })

  it('ignores what is not under its column, or not in the lower half of the screen', () => {
    const column = { left: 322, right: 374 }
    const leftOnly: Box = { left: 0, right: 200, top: 600, bottom: 640 }
    const header: Box = { left: 0, right: 390, top: 59, bottom: 104 }
    const empty: Box = { left: 0, right: 0, top: 0, bottom: 0 }
    expect(restLine([leftOnly, header, empty], column, screen.height)).toBe(844)
  })

  it('stands a gap above the line, raised by the lift, never above the ceiling', () => {
    expect(buttonTop({ line: 760, size: 52, gap: 12, lift: 0, ceiling: 110 })).toBe(696)
    expect(buttonTop({ line: 760, size: 52, gap: 12, lift: 200, ceiling: 110 })).toBe(496)
    expect(buttonTop({ line: 760, size: 52, gap: 12, lift: 5000, ceiling: 110 })).toBe(110)
  })

  it('goes to the nearer side when let go, and remembers how far above the line', () => {
    expect(sideFor(100, 390)).toBe('left')
    expect(sideFor(300, 390)).toBe('right')
    // Let go with its top at 496 above a line at 760: 200 above where it would rest.
    expect(liftFor({ top: 496, line: 760, size: 52, gap: 12 })).toBe(200)
    // Dragged below its resting place, it rests there.
    expect(liftFor({ top: 740, line: 760, size: 52, gap: 12 })).toBe(0)
  })
})

describe('scrolling', () => {
  it('tucks the button away after a real scroll down, and brings it back on one up', () => {
    const watch = new ScrollWatch(32)
    expect(watch.feed('a', 0)).toBeNull()
    expect(watch.feed('a', 20)).toBeNull()
    expect(watch.feed('a', 40)).toBe('tuck')
    expect(watch.feed('a', 400)).toBeNull()
    expect(watch.feed('a', 380)).toBeNull()
    expect(watch.feed('a', 360)).toBe('show')
  })

  it('shows it at the top of what scrolls, however it got there', () => {
    const watch = new ScrollWatch(32)
    watch.feed('a', 0)
    watch.feed('a', 200)
    expect(watch.feed('a', 2)).toBe('show')
  })

  it('keeps each scroller apart, so a list beside a note does not add to it', () => {
    const watch = new ScrollWatch(32)
    watch.feed('note', 100)
    watch.feed('list', 0)
    expect(watch.feed('note', 120)).toBeNull()
    expect(watch.feed('list', 20)).toBeNull()
    expect(watch.feed('note', 140)).toBe('tuck')
  })
})

const calm: QuickSignals = {
  enabled: true,
  platform: 'phone',
  tablet: false,
  typing: false,
  keyboard: 0,
  selection: false,
  dialog: false,
  drawer: 'closed',
  viewBusy: false,
}

describe('when it is not there at all', () => {
  it('is there on a phone with nothing going on', () => {
    expect(goneReason(calm)).toBeNull()
  })

  it.each<[string, Partial<QuickSignals>]>([
    ['off', { enabled: false }],
    ['desktop', { platform: 'desktop' }],
    ['tablet', { platform: 'tablet' }],
    ['keyboard', { typing: true }],
    ['keyboard', { keyboard: 336 }],
    ['selection', { selection: true }],
    ['dialog', { dialog: true }],
    ['drawer', { drawer: 'other' }],
    ['view', { viewBusy: true }],
  ])('is gone: %s', (reason, change) => {
    expect(goneReason({ ...calm, ...change })).toBe(reason)
  })

  it('is on a tablet only when asked to be', () => {
    expect(goneReason({ ...calm, platform: 'tablet', tablet: true })).toBeNull()
  })

  it('stays in a drawer whose view has a menu of its own — the chat', () => {
    expect(goneReason({ ...calm, drawer: 'quick' })).toBeNull()
  })
})
