import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { SCRIPT_FIXTURE } from '../e2e/helpers/scriptFixture'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'
import { findToolbarScroller, visibleToolbarTarget } from '../helpers/visibleToolbarTarget'
import * as chatProbeInteractions from '../helpers/chatProbeInteractions'

const files = [
  'bookLibraryScript',
  'slidesLive',
  'canvasGeometry',
  'chatNavigation',
  'modelTimeout',
  'rememberKeyApproval',
  'stopping',
  'textComments',
  'zip',
]

it.each(files)('parses emitted browser scripts in %s without contacting a live app', (name) => {
  const source = readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8')
  const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
  const scope: Record<string, unknown> = {
    SCRIPT_FIXTURE,
    WAIT_PRELUDE,
    findToolbarScroller,
    visibleToolbarTarget,
    ...chatProbeInteractions,
    DIR: 'Sample fixture',
    FILE: 'Sample fixture/sample.pdf',
    PATH: 'sample.md',
    SHOTS: 'sample-shots',
    shots: 'sample-shots',
    shot: 'sample-shots/sample.png',
    shotDir: () => 'sample-shots',
    onPhone: () => true,
    body: '',
    layout: 'phone',
    mode: 'phone',
    screen: 'phone',
    binary: '',
    scriptPath: 'Sample fixture/sample.js',
    fixture: null,
    owned: true,
    ownedDeck: true,
    from: [100, 100],
    to: [120, 120],
    size: [390, 844],
    id: 'sample',
    corner: false,
    label: 'Sample',
    screenshots: 'sample-shots',
    expression: 'true',
    path: 'sample.png',
    name: 'sample',
    group: { id: 'sample-group' },
  }
  const render = (node: ts.Node): string =>
    new Function(...Object.keys(scope), `return ${node.getText(tree)}`)(...Object.values(scope))
  // Evaluate only constants that supply browser code, never a test callback or app probe.
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        !declaration.initializer ||
        !['SCRIPT', 'SOURCE', 'NATIVE_TOUCH', 'PRELUDE', 'wait'].includes(
          declaration.name.getText(tree)
        )
      )
        continue
      scope[declaration.name.getText(tree)] = render(declaration.initializer)
    }
  }
  let checked = 0
  const visit = (node: ts.Node) => {
    // The presentation's Markdown fixture includes inline HTML, not a browser program.
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'SOURCE') return
    if (
      (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /app\.|window\.|document\.|await |return /.test(node.getText(tree))
    ) {
      const expression = ts.isTaggedTemplateExpression(node.parent) ? node.parent : node
      const script = render(expression)
      expect(
        () => new Function(`return (async()=>{${script}\n})()`),
        `${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}`
      ).not.toThrow()
      checked++
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(checked).toBeGreaterThan(0)
})
