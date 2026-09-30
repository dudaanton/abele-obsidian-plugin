import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import dayjs from 'dayjs'
import { TimeEntry } from '@/entities/TimeEntry'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useTimerButton, toggleTimerFor } from '@/composables/useTimerButton'
import { useDate } from '@/composables/useDate'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { configureAbele, useVault } from '../helpers/testEnv'

vi.mock('@/commands/createTimeEntry', () => ({
  createTimeEntry: vi.fn(),
  stopActiveTimeEntry: vi.fn(),
}))
// Isolate the elapsed-clock contract from the known extension mismatch. The unmodified
// matching helper is tested separately in timerMatching.test.ts with expected failures.
// Without this adapter, no ordinary note can reach the interval branch at all.
vi.mock('@/helpers/pathsHelpers', async (original) => {
  const real = await original<typeof import('@/helpers/pathsHelpers')>()
  return {
    ...real,
    wikilinkToPath: (value: string) => real.wikilinkToPath(value)?.replace(/\.md$/, '') ?? null,
  }
})

let wrapper: VueWrapper | undefined
let oldTZ: string | undefined
beforeEach(() => {
  oldTZ = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-03-01T00:00:00+01:00'))
  useVault([])
  configureAbele()
  GlobalStore.getInstance().timeEntryList.value = null
  vi.mocked(createTimeEntry).mockClear()
  vi.mocked(stopActiveTimeEntry).mockClear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  GlobalStore.getInstance().timeEntryList.value = null
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (oldTZ === undefined) delete process.env.TZ
  else process.env.TZ = oldTZ
})

function timerHarness(
  groups: string[] = ['[[Notes/Orchard]]'],
  start = dayjs().subtract(3661, 'second')
) {
  const active = ref([new TimeEntry({ wikilink: '[[Timers/Harvest]]', groups, start })])
  // The store's normal ref deeply unwraps TimeEntryList.activeEntries for the composable.
  GlobalStore.getInstance().timeEntryList.value = {
    activeEntries: active,
  } as unknown as TimeEntryList
  const path = ref('Notes/Orchard.md')
  const type = ref<string | null>('task')
  let state!: ReturnType<typeof useTimerButton>
  wrapper = mount(
    defineComponent({
      setup() {
        state = useTimerButton(path, type)
        return () => h('span', state.timerElapsedText.value)
      },
    })
  )
  return { active, path, type, state }
}

describe('timer button controls and elapsed clock (matching seam adapted)', () => {
  it('starts for this note without focus and delegates Stop to the all-active command', () => {
    toggleTimerFor('Notes/Orchard.md', false)
    expect(createTimeEntry).toHaveBeenCalledWith({ groups: ['[[Notes/Orchard|Orchard]]'] }, false)
    toggleTimerFor('Notes/Orchard.md', true)
    expect(stopActiveTimeEntry).toHaveBeenCalledTimes(1)
  })

  it('asks configuration about ordinary note types but always hides on time-entry notes', async () => {
    const allowed = vi
      .spyOn(AbeleConfig.getInstance(), 'isTimeTrackable')
      .mockImplementation((type) => type === 'task')
    const { type, state } = timerHarness([])
    expect(state.showTimerButton.value).toBe(true)
    type.value = null
    expect(state.showTimerButton.value).toBe(false)
    type.value = 'time-entry'
    allowed.mockClear()
    expect(state.showTimerButton.value).toBe(false)
    expect(allowed).not.toHaveBeenCalled()
  })

  it('shows zero without a global list', () => {
    let state!: ReturnType<typeof useTimerButton>
    wrapper = mount(
      defineComponent({
        setup() {
          state = useTimerButton(ref('Notes/Orchard.md'), ref(null))
          return () => h('span')
        },
      })
    )
    expect(state.isTimerActiveForNote.value).toBe(false)
    expect(state.timerElapsedText.value).toBe('00:00:00')
  })

  it('formats hours/minutes/seconds immediately, ticks through window timers, and clears on unmount', async () => {
    const set = vi.spyOn(window, 'setInterval')
    const clear = vi.spyOn(window, 'clearInterval')
    const { state } = timerHarness()
    expect(state.isTimerActiveForNote.value).toBe(true)
    expect(state.timerElapsedText.value).toBe('01:01:01')
    expect(set).toHaveBeenCalledWith(expect.any(Function), 1000)
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(wrapper!.text()).toBe('01:01:02')
    state.toggleTimer()
    expect(stopActiveTimeEntry).toHaveBeenCalledTimes(1)
    wrapper!.unmount()
    wrapper = undefined
    expect(clear).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('selects the first matching timer, allows more than 24 hours, and restarts after a path change', async () => {
    const { active, path, state } = timerHarness(['[[Elsewhere]]'])
    active.value.push(
      new TimeEntry({
        wikilink: '[[Timers/Long]]',
        groups: ['[[Notes/Orchard]]'],
        start: dayjs().subtract(100, 'hour'),
      })
    )
    await nextTick()
    expect(state.timerElapsedText.value).toBe('100:00:00')
    path.value = 'Elsewhere.md'
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(state.timerElapsedText.value).toBe('01:01:02')
    active.value = []
    await nextTick()
    expect(state.isTimerActiveForNote.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // Current behaviour retains the last text while the timer is inactive.
    expect(state.timerElapsedText.value).toBe('01:01:02')
    state.toggleTimer()
    expect(createTimeEntry).toHaveBeenCalledWith({ groups: ['[[Elsewhere|Elsewhere]]'] }, false)
  })
})

describe('useDate local day clock', () => {
  it('keeps the same value during a day, rolls at local midnight, and disposes its clock', async () => {
    vi.setSystemTime(new Date('2024-02-29T23:59:59+01:00'))
    let state!: ReturnType<typeof useDate>
    wrapper = mount(
      defineComponent({
        setup() {
          state = useDate()
          return () => h('span', state.now.value.format('YYYY-MM-DD'))
        },
      })
    )
    const original = state.now.value
    vi.advanceTimersByTime(32)
    await nextTick()
    expect(state.now.value).toBe(original)
    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(wrapper.text()).toBe('2024-03-01')
    expect(state.now.value).not.toBe(original)
    wrapper.unmount()
    wrapper = undefined
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['2025-01-01T00:00:01+01:00', '2024-04-01T00:00:01+02:00'])(
    'detects a resumed clock at %s even with the same day of month',
    async (instant) => {
      let state!: ReturnType<typeof useDate>
      wrapper = mount(
        defineComponent({
          setup() {
            state = useDate()
            return () => h('span')
          },
        })
      )
      vi.setSystemTime(new Date(instant))
      vi.advanceTimersByTime(32)
      await nextTick()
      expect(state.now.value.format('YYYY-MM-DD')).toBe(instant.slice(0, 10))
    }
  )
})
