/**
 * A long script modal scrolls once.
 *
 * The markdown block was given `max-height: 60vh; overflow-y: auto` so that a script printing
 * a document could not grow the modal past the window. Obsidian's modal already does that —
 * it is capped at 85vh and scrolls what it holds — so the second box produced two scrollbars
 * side by side and, worse, stopped the modal short of the height it was allowed: a report
 * read through a 60vh porthole inside a window that had room to show more.
 *
 * Removing that cap moves the question to the horizontal axis, because the block's
 * `overflow-y` had been quietly containing wide content too. Long code wraps — the block
 * breaks words that do not fit — but a table cannot be made narrower than its columns, so it
 * carries its own sideways scroll rather than dragging every line of prose beside it out of
 * view.
 *
 * Only this tier can answer any of it: happy-dom computes no layout, and the modal's own
 * height comes from Obsidian's stylesheet rather than the plugin's.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalJson, evalRaw } from './helpers/obsidianCli'

interface Report {
  /** Everything inside the modal that actually scrolls vertically, outermost first. */
  scrollsDown: string[]
  /** Whether the modal itself can be scrolled sideways. */
  scrollsSideways: boolean
  /** How much of the height Obsidian allows the modal it actually takes, 0–1. */
  heightUsed: number
  /** The markdown block's own vertical overflow and cap. */
  block: { overflowY: string; maxHeight: string }
  /** A long code line wraps instead of running off the side. */
  codeWraps: boolean
  /** A table too wide for the modal scrolls within itself. */
  tableScrollsItself: boolean
}

/**
 * The two shapes a script form takes: a document with nothing to answer, and the mixed form
 * that prompted this — prose, a question, more prose.
 *
 * The text is deliberately taller than any window, and carries the two things that overflow
 * sideways: a code line nothing will wrap and a table wider than the modal.
 */
const SHAPES = ['document', 'mixed'] as const

const probe = (shape: string) => `(() => {
  window.__abeleModalProbe = null
  ;(async () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      '### Entry ' + (i + 1) + '\\n\\nA line of prose that repeats down a long report.\\n'
    ).join('\\n')
    const wide = '| ' + Array.from({ length: 14 }, (_, i) => 'column ' + i).join(' | ') + ' |\\n' +
      '| ' + Array.from({ length: 14 }, () => '---').join(' | ') + ' |\\n' +
      '| ' + Array.from({ length: 14 }, (_, i) => 'value ' + i).join(' | ') + ' |\\n'
    const code = '\\n\`\`\`js\\nconst line = "' + 'x'.repeat(300) + '"\\n\`\`\`\\n'
    const text = '# Report\\n\\n' + wide + code + long

    const prose = { name: 'report', label: 'Report', type: 'markdown', text }
    const question = { name: 'format', label: 'Material format', type: 'select', options: ['Text', 'Audio'] }
    const fields = '${shape}' === 'document' ? [prose] : [prose, question, { ...prose, name: 'more' }]

    const store = window.__abeleTest.GlobalStore.getInstance()
    store.scriptFormFields.value = fields
    store.scriptFormResolve.value = () => {}
    store.scriptFormModalOpened.value = true

    // Markdown renders asynchronously and re-renders once more on a timer of its own, so the
    // heights these questions are about do not exist for another frame or two.
    await new Promise((r) => setTimeout(r, 800))

    const modal = document.querySelector('.modal-container .modal')
    const scrolls = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
      el.scrollHeight > el.clientHeight + 1
    const name = (el) => (el.className || el.tagName).toString().trim().split(/\\s+/)[0]

    const block = modal.querySelector('.abele-script-form__markdown')
    const blockStyle = getComputedStyle(block)
    const code$ = modal.querySelector('.abele-script-form__markdown pre')
    const table$ = modal.querySelector('.abele-script-form__markdown table')

    window.__abeleModalProbe = {
      scrollsDown: [modal, ...modal.querySelectorAll('*')].filter(scrolls).map(name),
      scrollsSideways: modal.scrollWidth > modal.clientWidth + 1,
      heightUsed: modal.clientHeight / parseFloat(getComputedStyle(modal).maxHeight),
      block: { overflowY: blockStyle.overflowY, maxHeight: blockStyle.maxHeight },
      codeWraps: code$.scrollWidth <= code$.clientWidth + 1,
      tableScrollsItself: table$.scrollWidth > table$.clientWidth + 1,
    }

    store.scriptFormResolve.value(null)
    store.scriptFormModalOpened.value = false
  })()
  return 'started'
})()`

const reports: Record<string, Report> = {}

beforeAll(async () => {
  if (!isObsidianRunning() || !hasTestApi()) return

  for (const shape of SHAPES) {
    evalRaw(probe(shape))
    // The probe parks its result on the window and `eval` cannot await one, so it is polled
    // for. The round trip through the CLI costs a few milliseconds, hence the wait between
    // attempts: without it the whole budget is spent before the modal has rendered.
    let result: Report | null = null
    for (let attempt = 0; attempt < 30 && !result; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      result = evalJson<Report | null>('window.__abeleModalProbe ?? null')
    }
    if (result) reports[shape] = result
  }
  evalRaw('delete window.__abeleModalProbe')
}, 120_000)

describe.runIf(isObsidianRunning() && hasTestApi())('a script modal taller than the window', () => {
  it.each(SHAPES)('scrolls in one place, and it is the modal — %s', (shape) => {
    expect(reports[shape].scrollsDown).toEqual(['modal'])
  })

  it.each(SHAPES)('takes the height Obsidian allows it rather than 60vh of it — %s', (shape) => {
    expect(reports[shape].heightUsed).toBeGreaterThan(0.95)
  })

  it.each(SHAPES)('leaves the block itself unbounded and unscrolled — %s', (shape) => {
    expect(reports[shape].block).toEqual({ overflowY: 'visible', maxHeight: 'none' })
  })

  it.each(SHAPES)('never scrolls sideways, whatever it was given — %s', (shape) => {
    expect(reports[shape].scrollsSideways).toBe(false)
  })

  it.each(SHAPES)('wraps a long code line rather than running it off the side — %s', (shape) => {
    expect(reports[shape].codeWraps).toBe(true)
  })

  it.each(SHAPES)('leaves a table too wide to fit scrolling within itself — %s', (shape) => {
    expect(reports[shape].tableScrollsItself).toBe(true)
  })
})
