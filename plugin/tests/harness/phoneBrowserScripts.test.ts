import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { TIMELINE_FIXTURE_PROBE } from '../e2e/helpers/timelineFixture'
import { TIMELINE_READY_PROBE } from '../e2e/helpers/timelineReady'
import { TIMELINE_POSITION_PROBE } from '../e2e/helpers/timelinePosition'
import { PIXEL_PROBE } from '../e2e/helpers/stablePixels'
import { openBasePicker, basePickerGeometry } from '../e2e/helpers/githubBasePicker'
import { selectionDismissPoint } from '../e2e/helpers/selectionDismissPoint'

const files = [
  'githubPhone',
  'githubStickyHeader',
  'githubNotifications',
  'githubPinnedBase',
  'bookPhone',
  'bookSelectionPlace',
  'calendarCompletion',
  'calendarsPhone',
  'footerTaskClick',
  'taskDatePhone',
  'taskTimelineScroll',
  'timelineDrag',
]

it.each(files)('parses %s browser scripts after template emission', (file) => {
  const source = readFileSync(`tests/e2e/${file}.e2e.test.ts`, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const scope: Record<string, unknown> = {
    JSON,
    String,
    Math,
    Date,
    TIMELINE_FIXTURE_PROBE,
    TIMELINE_READY_PROBE,
    TIMELINE_POSITION_PROBE,
    PIXEL_PROBE,
    openBasePicker,
    basePickerGeometry,
    selectionDismissPoint,
    FOLDER: 'Sample probe',
    DIR: 'Sample books',
    BOOK: 'Sample books/sample.epub',
    SHOTS: 'sample-shots',
    shots: 'sample-shots',
    PHASE: 'after',
    comparisonCss: '',
    footer: false,
    short: false,
    width: 390,
    height: 844,
    TASKS: 20,
    PHONE: { width: 390, height: 844 },
    KEYBOARD: 336,
    ROOM: 508,
    gh: { web: 'https://example.test/sample/repo' },
    web: 'https://example.test/sample/repo',
    section: 'markdown',
    kind: 'blob',
    size: [390, 844],
    mobile: true,
    pick: { owner: 'sample-owner' },
    profile: 'sample',
    dir: 'Sample probe',
    state: { size: [390, 844], layout: {} },
    method: 'sample',
    params: {},
    observeSelectionDelivery: () => null,
    script: () => '(async function* () {})()',
  }
  const values = new Proxy(scope, {
    has: () => true,
    get: (object, name) => (typeof name === 'symbol' ? undefined : (object[name] ?? '')),
  })
  const emit = (expression: string) =>
    new Function('scope', `with(scope) { return (${expression}) }`)(values)
  let count = 0
  const visit = (node: ts.Node) => {
    // Keep each file's real preludes; no e2e module is imported or executed.
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isTemplateExpression(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      const name = node.name.getText(tree)
      if (['PRELUDE', 'PANEL', 'REMOVE_TIMELINE_FIXTURE'].includes(name))
        scope[name] = emit(node.initializer.getText(tree))
    }
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const raw =
        ts.isTaggedTemplateExpression(node.parent) && node.parent.tag.getText(tree) === 'String.raw'
      const text = node.getText(tree)
      // Page-local programs, rather than URL/copy templates or host diagnostics.
      if (
        /^(?:`\(async|`\(\(\) =>)/.test(text) ||
        text.includes('const probe=window.__abeleSelectionProbe')
      ) {
        const script = emit((raw ? 'String.raw' : '') + text) as string
        expect(
          () => new Function(`return (async () => {${script}})()`),
          `${file}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}`
        ).not.toThrow()
        count++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(count).toBeGreaterThan(0)
})

it('keeps three-letter weekdays and complete dates in the emitted drag probe', () => {
  const source = readFileSync('tests/e2e/timelineDrag.e2e.test.ts', 'utf8')
  const regex = source.match(/label=>(\/.*\/).test\(label.text.trim\(\)\)/)![1]
  const pattern = new Function(`return ${regex}`)() as RegExp
  for (const label of ['Mon 05.01', 'Today · Tue 06.01', 'Wed 07.01.2030'])
    expect(pattern.test(label)).toBe(true)
  for (const label of ['Mo 05.01', 'Mon', 'Monday 05.01', ' · Mo '])
    expect(pattern.test(label)).toBe(false)
})
