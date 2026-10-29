import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import {
  actionCoordinates,
  checkSelectionDestination,
  selectionWindowInfo,
  selectionResize,
  selectionEmulation,
  openSelectionSource,
  prepareSelectionAction,
  readSelectionBar,
  selectionCleanup,
  selectionMenu,
  selectionSetup,
  selectionShot,
  wordCoordinates,
} from '../e2e/helpers/codeSelectionProbe'

const scripts = [
  selectionSetup('Sample selection "quoted" directory'),
  selectionCleanup,
  wordCoordinates,
  readSelectionBar,
  selectionMenu,
  selectionShot('/tmp/abele-code-selection/sample.png'),
  selectionWindowInfo,
  selectionResize(1280, 800),
  selectionResize(390, 844),
  selectionEmulation(true),
  selectionEmulation(false),
  ...(['debugger', 'node-or-local', 'github'] as const).map((surface) =>
    openSelectionSource(surface, 'http://127.0.0.1:1234/acme/widgets/blob/main/src/app.ts')
  ),
  ...(['ask', 'add', 'note', 'code'] as const).flatMap((action) => [
    actionCoordinates(action),
    prepareSelectionAction(action),
    checkSelectionDestination(action),
  ]),
]
it.each(scripts.map((script, index) => ({ script, index })))(
  'browser selection program $index parses',
  ({ script }) => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  }
)

it('transpiles the live driver without evaluating its app probes', () => {
  expect(() =>
    transformSync(readFileSync('tests/e2e/codeSelectionBar.e2e.test.ts', 'utf8'), { loader: 'ts' })
  ).not.toThrow()
})
