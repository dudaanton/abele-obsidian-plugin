import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TIMELINE_READY_PROBE } from '../e2e/helpers/timelineReady'

const settle = new Function(TIMELINE_READY_PROBE + 'return settleTimelineUI')()
it('waits for expected state and five stable geometry samples without correcting displacement', async () => {
  let polls = 0,
    position = 20,
    ready = false
  await settle(
    () => [position],
    () => ready,
    async (ms: number) => {
      expect(ms).toBe(100)
      polls++
      if (polls === 2) ready = true
      if (polls === 4) position = 21
    },
    () => polls * 100
  )
  expect(polls).toBe(9)
  expect(position).toBe(21)
})
it('fails unsettled geometry and absent expected rows at the original readiness deadline', async () => {
  for (const available of [false, true]) {
    let polls = 0
    await expect(
      settle(
        () => [polls],
        () => available,
        async () => {
          polls++
        },
        () => polls * 100
      )
    ).rejects.toThrow('did not settle')
    expect(polls).toBe(150)
  }
})

const viewReady = new Function(TIMELINE_READY_PROBE + 'return settleTimelineView')()
const observe = new Function(TIMELINE_READY_PROBE + 'return observeTimelineMarkdown')()
const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 16))
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})

function viewDouble() {
  const owner = document.createElement('div')
  owner.innerHTML = `<div class="abele-timeline">
    <div class="abele-timeline__date-block" data-abele-anchor="date:2030-01-01">
      <div class="timeline__date abele-markdown"><a data-href="2030-01-01">Sample date</a></div>
      <div class="abele-task-view" data-abele-anchor="task:Sample folder/Sample item.md">
        <div class="abele-task-view__content"><div class="abele-markdown">Sample item</div></div>
      </div>
      <div class="abele-task-view" data-abele-anchor="task:Sample folder/Sample archive.md">
        <div class="abele-task-view__content"><div class="abele-markdown">Sample archive</div></div>
      </div>
    </div>
  </div>`
  const calendar = document.createElement('div'),
    header = document.createElement('div')
  document.body.append(owner, calendar, header)
  const timeline = owner.querySelector<HTMLElement>('.abele-timeline')!
  const block = timeline.querySelector<HTMLElement>('.abele-timeline__date-block')!
  const date = timeline.querySelector<HTMLElement>('.timeline__date')!
  const [row, offscreen] = timeline.querySelectorAll<HTMLElement>('.abele-task-view')
  const state = {
    rowTop: 40,
    offscreenTop: -80,
    blockHeight: 120,
    calendarTop: 30,
    headerTop: 0,
    pending: 0,
    revision: 0,
  }
  owner.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100)
  block.getBoundingClientRect = () => new DOMRect(0, -80, 400, state.blockHeight)
  date.getBoundingClientRect = () => new DOMRect(0, -80, 400, 20)
  row.getBoundingClientRect = () => new DOMRect(0, state.rowTop, 400, 20)
  offscreen.getBoundingClientRect = () => new DOMRect(0, state.offscreenTop, 400, 20)
  calendar.getBoundingClientRect = () => new DOMRect(0, state.calendarTop, 400, 100)
  header.getBoundingClientRect = () => new DOMRect(0, state.headerTop, 400, 20)
  const renders = { pending: () => state.pending, revision: () => state.revision }
  const wait = () =>
    viewReady(
      timeline,
      owner,
      () => true,
      renders,
      () => [calendar, header],
      frame,
      Date.now
    )
  return { state, date, row, calendar, header, wait }
}

it('does not measure before a delayed date header has rendered, even with stable visible titles', async () => {
  vi.useFakeTimers()
  const v = viewDouble()
  v.date.replaceChildren()
  setTimeout(() => {
    v.date.innerHTML = '<a data-href="2030-01-01">Sample date</a>'
    v.state.rowTop = 44
  }, 900)
  const measured = vi.fn(() => v.row.getBoundingClientRect().top)
  const done = v.wait().then(measured)
  await vi.advanceTimersByTimeAsync(600)
  expect(measured).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  await done
  expect(measured).toHaveReturnedWith(44)
})

it('waits for an already-started off-viewport render, so a late anchor shift cannot pass vacuously', async () => {
  vi.useFakeTimers()
  const v = viewDouble()
  v.state.pending = 1
  setTimeout(() => {
    v.state.offscreenTop = -60
    v.state.blockHeight += 20
    v.state.rowTop = 44
    v.state.pending = 0
    v.state.revision++
  }, 900)
  const measured = vi.fn(() => [40, v.row.getBoundingClientRect().top])
  const done = v.wait().then(measured)
  await vi.advanceTimersByTimeAsync(600)
  expect(measured).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  await done
  expect(measured).toHaveReturnedWith([40, 44])
})

it.each(['calendar', 'header'] as const)(
  'waits for the independent %s bounds on consecutive frames before measuring overlap',
  async (moving) => {
    vi.useFakeTimers()
    const v = viewDouble()
    const start = Date.now()
    const motion = setInterval(() => {
      const elapsed = Date.now() - start
      if (moving === 'calendar') v.state.calendarTop = 30 - elapsed / 60
      else v.state.headerTop = elapsed / 75
    }, 16)
    setTimeout(() => {
      clearInterval(motion)
      if (moving === 'calendar') v.state.calendarTop = 15
      else v.state.headerTop = 12
    }, 900)
    const measured = vi.fn(
      () => v.calendar.getBoundingClientRect().top - v.header.getBoundingClientRect().bottom
    )
    const done = v.wait().then(measured)
    await vi.advanceTimersByTimeAsync(600)
    expect(measured).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await done
    expect(measured).toHaveReturnedWith(moving === 'calendar' ? -5 : -2)
  }
)

it('observes the renderer from the existing nested rendering test API', () => {
  const source = readFileSync(resolve(__dirname, '../e2e/taskTimelineScroll.e2e.test.ts'), 'utf8')
  const expression = source.match(/observeTimelineMarkdown\(([^)]+)\)/)![1]
  const renderer = { render: vi.fn() }
  const page = { __abeleTest: { rendering: { MarkdownRenderer: renderer } } }
  expect(new Function('window', 'return ' + expression)(page)).toBe(renderer)
})

it('tracks actual renderer promises through success and rejection and restores the original method', async () => {
  let complete!: () => void, reject!: (error: Error) => void
  const original = vi.fn(
    (..._args: unknown[]) =>
      new Promise<void>((resolve, fail) => {
        complete = resolve
        reject = fail
      })
  )
  const renderer = { render: original }
  const renders = observe(renderer)
  try {
    const success = renderer.render('sample text')
    expect(renders.pending()).toBe(1)
    expect(renders.revision()).toBe(1)
    expect(original.mock.contexts[0]).toBe(renderer)
    expect(original).toHaveBeenCalledWith('sample text')
    complete()
    await success
    expect(renders.pending()).toBe(0)
    expect(renders.revision()).toBe(2)
    const failure = renderer.render()
    const checked = expect(failure).rejects.toThrow('sample render failure')
    expect(renders.pending()).toBe(1)
    reject(Error('sample render failure'))
    await checked
    expect(renders.pending()).toBe(0)
    expect(renders.revision()).toBe(4)
  } finally {
    renders.restore()
  }
  expect(renderer.render).toBe(original)
})

it('retains the 15 s deadline even when the next painted frame never arrives', async () => {
  vi.useFakeTimers()
  const result = settle(
    () => [],
    () => true,
    () => new Promise(() => {}),
    Date.now
  ).catch((error: Error) => error)
  await vi.advanceTimersByTimeAsync(15000)
  expect((await result).message).toBe('timeline UI did not settle')
})
