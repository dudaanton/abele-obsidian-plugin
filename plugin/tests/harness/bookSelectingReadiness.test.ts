import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookSelecting.e2e.test.ts'), 'utf8')
// Run the actual scrolled-chapter preparation, not a second copy of its predicate.
const scenario = source.slice(source.indexOf("it('in a chapter scrolled"))
const preparation = scenario.slice(
  scenario.indexOf('          if (view.model.panel)'),
  scenario.indexOf('          const s = box(view)')
)

function prepare() {
  const page = { title: 'Chapter 3' }
  const renderer = { scrolled: true, start: 900 }
  const view = {
    model: { panel: false, toc: [{ href: 'chapter-1' }] },
    engine: { goTo: async () => {} },
    contentEl: { querySelector: () => null },
  }
  const doc = { querySelector: () => ({ textContent: page.title }) }
  const run = new Function(
    'view',
    'R',
    'docOf',
    `${WAIT_PRELUDE}; return (async () => { ${preparation} })()`
  )
  return {
    page,
    renderer,
    run: () =>
      run(
        view,
        () => renderer,
        () => doc
      ) as Promise<void>,
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('does not measure the previous chapter when navigation takes longer than the old sleep', async () => {
  vi.useFakeTimers()
  const { page, renderer, run } = prepare()
  const done = vi.fn()
  setTimeout(() => {
    page.title = 'Chapter 1'
    renderer.start = 0
  }, 1400)
  void run().then(done)
  await vi.advanceTimersByTimeAsync(1000)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects navigation which never reaches the chapter start', async () => {
  vi.useFakeTimers()
  const result = prepare()
    .run()
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/chapter.*start/i)
})
