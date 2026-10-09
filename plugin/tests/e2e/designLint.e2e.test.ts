import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong } from './helpers/obsidianCli'
import { measureDesign, type DesignReport } from './helpers/designLint'
import { shotDir } from './helpers/shots'

const pages = [
  { page: 'rows', bug: 'line-alignment and text-left-edge' },
  { page: 'states', bug: 'native-parity' },
  { page: 'details', bug: 'clipping' },
  { page: 'swatches' },
  { page: 'images', bug: 'line-alignment and native-parity' },
  { page: 'events', bug: 'text-left-edge and hierarchy-order' },
  { page: 'artifact', bug: 'line-alignment and row-column' },
  { page: 'comment' },
  { page: 'comment-thread', bug: 'spacing-scale and row-spacing' },
  { page: 'waiting', bug: 'line-alignment, text-left-edge and hierarchy-order' },
  { page: 'controls', bug: 'clipping and spacing-scale' },
  { page: 'navigation', bug: 'row-column and hierarchy-consistency' },
  { page: 'previews' },
  { page: 'specialized' },
  { page: 'icon-picker', bug: 'spacing-scale and sibling-overlap' },
  { page: 'confirm', bug: 'sibling-overlap' },
]
const directory = process.env.DESIGN_LINT_OUT_DIR ?? shotDir('design-lint')
describe('kit catalogue live design contract', () => {
  for (const { page, bug } of pages)
    describe(page, () => {
      let report: DesignReport
      // Suite-hook errors stay red; test-level hooks are also inverted by it.fails.
      beforeAll(async () => {
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
        report = await measureDesign(
          page === 'icon-picker' || page === 'confirm' ? '.modal' : '.abele-design-catalogue',
          `${directory}/${page}`,
          {},
          { requireNative: true }
        )
        expect(report.snapshot.elements.length).toBeGreaterThan(0)
        expect(report.snapshot.native, 'A visible native reference pane is required').toBeDefined()
      })
      afterAll(async () => {
        const result = await evalLong(
          `(() => { window.__abeleTest?.closeDesignCatalogue?.(); return 'closed' })()`
        )
        expect(result).toBe('closed')
      })
      const assertClean = () =>
        expect(report.violations, `See ${report.directory}/annotated.png and report.json`).toEqual(
          []
        )
      // An unexpected pass fails the batch: remove the BUG marker once the page is fixed.
      if (bug) it.fails(`BUG: ${page} — ${bug}`, assertClean)
      else it(`${page} has no measured design violations`, assertClean)
    })
})
