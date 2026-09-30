import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import {
  FOOTER_FOLDS_KEY,
  forgetFooterFolds,
  moveFooterFolds,
  provideFooterFold,
  resetFooterFolds,
  useFooterFold,
} from '@/composables/useFooterFold'
import {
  FOOTER_VIEW_KEY,
  forgetFooterView,
  moveFooterView,
  resetFooterView,
  useFooterPages,
  useFooterTaskOpen,
  useFooterTimeline,
} from '@/composables/useFooterView'
import { configureAbele, useVault } from '../helpers/testEnv'

/** Real provide/inject boundaries, with no list or DOM geometry involved. */
describe('footer state — storage, shared tabs and path lifecycle', () => {
  let app: ReturnType<typeof useVault>
  const wrappers: VueWrapper[] = []
  const readState = (task: Ref<string>) => ({
    fold: useFooterFold('backlinks'),
    pages: useFooterPages('backlinks'),
    task: useFooterTaskOpen(() => task.value),
    timeline: useFooterTimeline(),
  })
  function probe(path: Ref<string> | null = ref('Notes/Orchard.md'), task = ref('Tasks/Water.md')) {
    let state!: ReturnType<typeof readState>
    const Child = defineComponent({
      setup() {
        state = readState(task)
        return () => h('span')
      },
    })
    wrappers.push(
      mount(
        defineComponent({
          setup() {
            if (path) provideFooterFold(() => path.value)
            return () => h(Child)
          },
        })
      )
    )
    return state
  }
  const forget = (path: string) => {
    forgetFooterFolds(path)
    forgetFooterView(path)
  }
  const move = (from: string, to: string) => {
    moveFooterFolds(from, to)
    moveFooterView(from, to)
  }

  beforeEach(() => {
    app = useVault([])
    configureAbele().rememberNotePlaces = true
    resetFooterFolds()
    resetFooterView()
  })
  afterEach(() => {
    wrappers.splice(0).forEach((w) => w.unmount())
    resetFooterFolds()
    resetFooterView()
    vi.restoreAllMocks()
  })

  it('is inert outside a footer and never touches storage', () => {
    const read = vi.spyOn(app, 'loadLocalStorage')
    const save = vi.spyOn(app, 'saveLocalStorage')
    const s = probe(null)
    expect(s.fold.enabled).toBe(false)
    expect(s.fold.collapsed.value).toBe(false)
    expect(s.pages.initial).toBe(1)
    expect(s.task.initial).toBe(false)
    expect(s.timeline.pastRevealed).toBe(false)
    s.fold.toggle()
    s.pages.record(4)
    s.task.record(true)
    s.timeline.recordPast(true)
    expect(read).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('shares folds between tabs, remembers pages, open tasks and revealed history on remount', () => {
    const read = vi.spyOn(app, 'loadLocalStorage')
    const a = probe()
    const b = probe()
    a.fold.toggle()
    expect(b.fold.collapsed.value).toBe(true)
    a.pages.record(3)
    a.task.record(true)
    a.timeline.record(2)
    a.timeline.recordPast(true)
    const again = probe()
    expect(again.pages.initial).toBe(3)
    expect(again.task.initial).toBe(true)
    expect(again.timeline.initial).toBe(2)
    expect(again.timeline.pastRevealed).toBe(true)
    expect(probe(ref('Notes/Other.md')).pages.initial).toBe(1)
    // Each module lazily reads its own storage once, not once per mounted list.
    expect(read.mock.calls).toHaveLength(2)
    expect(read.mock.calls).toEqual(expect.arrayContaining([[FOOTER_FOLDS_KEY], [FOOTER_VIEW_KEY]]))
  })

  it('reloads validated state after reset and suppresses identical storage writes', () => {
    app.saveLocalStorage(FOOTER_FOLDS_KEY, { 'Notes/Orchard.md': ['backlinks', 'unknown'] })
    app.saveLocalStorage(FOOTER_VIEW_KEY, {
      'Notes/Orchard.md': {
        pages: { backlinks: 3 },
        open: ['Tasks/Water.md'],
        calendarStart: '2028-02-29',
      },
    })
    const s = probe()
    expect(s.fold.collapsed.value).toBe(true)
    expect(s.timeline.pastRevealed).toBe(true)
    expect(s.pages.initial).toBe(3)
    expect(s.task.initial).toBe(true)
    const save = vi.spyOn(app, 'saveLocalStorage')
    s.pages.record(3)
    s.task.record(true)
    s.timeline.recordPast(true)
    forget('Missing')
    move('Missing.md', 'Also missing.md')
    expect(save).not.toHaveBeenCalled()
    resetFooterFolds()
    resetFooterView()
    expect(probe().pages.initial).toBe(3)
  })

  it('disables restoration, not recording or folding, when rememberNotePlaces is off', () => {
    const s = probe()
    s.fold.toggle()
    s.pages.record(4)
    s.task.record(true)
    s.timeline.recordPast(true)
    configureAbele().rememberNotePlaces = false
    const off = probe()
    expect(off.pages.initial).toBe(1)
    expect(off.task.initial).toBe(false)
    expect(off.timeline.pastRevealed).toBe(false)
    expect(off.fold.collapsed.value).toBe(true)
    off.pages.record(2)
    configureAbele().rememberNotePlaces = true
    expect(probe().pages.initial).toBe(2)
  })

  it('records through the current note and task paths after a rename', () => {
    const path = ref('Notes/Orchard.md')
    const task = ref('Tasks/Water.md')
    const s = probe(path, task)
    s.fold.toggle()
    s.pages.record(3)
    s.task.record(true)
    move(path.value, 'Archive/Orchard.md')
    path.value = 'Archive/Orchard.md'
    task.value = 'Tasks/Prune.md'
    expect(s.fold.collapsed.value).toBe(true)
    s.task.record(true)
    s.pages.record(4)
    expect(probe(path, task).task.initial).toBe(true)
    expect(probe(path).pages.initial).toBe(4)
    expect(probe(ref('Notes/Orchard.md')).fold.collapsed.value).toBe(false)
    expect(probe(ref('Notes/Orchard.md')).pages.initial).toBe(1)
  })

  it('forgets a note or whole folder, without touching a similarly prefixed sibling', () => {
    for (const path of ['Notes/A.md', 'Notes/Sub/B.md', 'NotesExtra/C.md']) {
      const s = probe(ref(path))
      s.fold.toggle()
      s.pages.record(2)
      s.task.record(true)
    }
    forget('Notes/A.md')
    expect(probe(ref('Notes/A.md')).pages.initial).toBe(1)
    expect(probe(ref('Notes/Sub/B.md')).pages.initial).toBe(2)
    forget('Notes')
    expect(probe(ref('Notes/Sub/B.md')).fold.collapsed.value).toBe(false)
    expect(probe(ref('Notes/Sub/B.md')).pages.initial).toBe(1)
    expect(probe(ref('NotesExtra/C.md')).fold.collapsed.value).toBe(true)
    expect(probe(ref('NotesExtra/C.md')).task.initial).toBe(true)
  })
})
