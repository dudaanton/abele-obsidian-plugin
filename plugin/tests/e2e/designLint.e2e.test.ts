import { afterEach, describe, expect, it } from 'vitest'
import { evalJson, evalLong } from './helpers/obsidianCli'
import { measureDesign } from './helpers/designLint'
import { shotDir } from './helpers/shots'

const pages = [
  'rows',
  'states',
  'details',
  'swatches',
  'images',
  'events',
  'artifact',
  'comment',
  'comment-thread',
  'waiting',
  'controls',
  'navigation',
  'previews',
  'specialized',
  'icon-picker',
  'confirm',
]
const directory = process.env.DESIGN_LINT_OUT_DIR ?? shotDir('design-lint')
afterEach(async () => {
  const result = await evalLong(
    `(() => { window.__abeleTest?.closeDesignCatalogue?.(); return 'closed' })()`
  )
  expect(result).toBe('closed')
})
describe('kit catalogue live design contract', () => {
  it.each(pages)('%s has no measured design violations', async (page) => {
    expect(
      evalJson("typeof window.__abeleTest?.openDesignCatalogue === 'function'"),
      'Install a development build containing the catalogue before running this contract'
    ).toBe(true)
    const opened = await evalLong(`(async () => {
      window.__abeleTest.openDesignCatalogue(${JSON.stringify(page)}, 'disclosed')
      await new Promise(resolve => setTimeout(resolve, 300))
      return 'opened'
    })()`)
    expect(opened).toBe('opened')
    const report = await measureDesign(
      page === 'icon-picker' || page === 'confirm' ? '.modal' : '.abele-design-catalogue',
      `${directory}/${page}`,
      {},
      { requireNative: true }
    )
    expect(report.snapshot.elements.length).toBeGreaterThan(0)
    expect(report.violations, `See ${report.directory}/annotated.png and report.json`).toEqual([])
  })
})
