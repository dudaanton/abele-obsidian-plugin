import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'
import { canvasBackgroundGesture } from '../e2e/helpers/canvasBackgroundGesture'
import { drawingSvg } from '../../src/drawing/drawingFile'

const files = [
  'bookSidebarResize',
  'bookSpeech',
  'canvasAcceptance',
  'canvasExport',
  'canvasInk',
  'drawing',
  'drawingConversion',
  'drawingEmbed',
  'githubProseAsk',
  'githubTree',
  'slidesDesign',
]

it.each(files)('parses %s browser programs without executing the app', (file) => {
  const source = readFileSync(`tests/e2e/${file}.e2e.test.ts`, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const scope: Record<string, unknown> = {
    JSON,
    String,
    Math,
    Date,
    Buffer,
    WAIT_PRELUDE,
    canvasBackgroundGesture,
    drawingSvg,
    directory: 'Sample probe',
    svg: drawingSvg({ items: [] }),
    DIR: 'Sample probe',
    BOOK: 'Sample probe/sample.epub',
    PDF: 'Sample probe/sample.pdf',
    PATH: 'Sample probe/sample.md',
    SOURCE: '# Sample slide',
    SHOTS: 'sample-shots',
    shots: 'sample-shots',
    onPhone: () => false,
    randomUUID: () => 'sample-run',
    gh: { web: 'https://example.test/sample/project' },
    url: 'https://example.test/sample/project',
    files: {},
    reader: {},
    eink: {},
    places: {},
    width: 300,
    size: [1280, 800],
    zoom: 1,
    panels: [true, true],
    from: [100, 100],
    to: [120, 120],
    x: 100,
    y: 100,
    mobile: false,
    otherProvider: true,
    mode: 'desktop',
    theme: 'light',
    expression: 'true',
    body: 'return true',
    label: 'Sample action',
    format: 'png',
    saved: {},
    text: 'sample',
    data: 'sample',
    geometry: 'return null',
    setup: { from: { x: 100, y: 100 }, to: { x: 120, y: 100 } },
    handle: { x: 100, y: 100 },
    before: { id: 'sample', points: [0, 0, 1], bounds: { x: 0, y: 0 } },
    state: {},
    originalNode: { x: 0, y: 0 },
    attached: [{ points: [0, 0, 1] }],
    buildJustifiedEpub: () => new Uint8Array(),
    closeFixtureLeaves: async () => {},
    final: false,
  }
  const values = new Proxy(scope, {
    has: () => true,
    get: (object, name) => (typeof name === 'symbol' ? undefined : (object[name] ?? '')),
  })
  const emit = (expression: string): string => {
    const js = ts.transpile(`const emitted = (${expression}); return emitted`, {
      target: ts.ScriptTarget.ESNext,
    })
    return new Function('scope', `with(scope) { ${js} }`)(values)
  }
  let count = 0
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isTemplateExpression(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      const name = node.name.getText(tree)
      if (['PRELUDE', 'GEOMETRY', 'VIEW'].includes(name))
        scope[name] = emit(node.initializer.getText(tree))
    }
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.getText(tree)
      if (
        /^`\s*(?:\(async|\(\(\)|const |return |await |if\(|if \(|document\.|app\.|window\.)/.test(
          text
        )
      ) {
        const script = emit(text)
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
