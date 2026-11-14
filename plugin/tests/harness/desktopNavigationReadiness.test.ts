import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { settledGeometry } from '../helpers/settledGeometry'

const source = (name: string) =>
  ts.createSourceFile(
    name,
    readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
const compile = (text: string) => ts.transpile(text, { target: ts.ScriptTarget.ESNext })
const evaluate = (expression: string, scope: Record<string, unknown>) =>
  new Function('scope', `with(scope) { ${compile(`return (${expression})`)} }`)(scope)

it('puts the reading card inside a short desktop viewport before sending its native press', async () => {
  const tree = source('canvasChrome')
  let body = '',
    middle = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'middle')
      middle = node.initializer!.getText(tree)
    if (
      ts.isCallExpression(node) &&
      node.arguments[0]?.getText(tree).includes("'reads on in a picked note")
    )
      body = (node.arguments[1] as ts.ArrowFunction).body.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const viewer = {
    camera: { x: -60, y: -180, zoom: 1 },
    graph: { nodes: [{ id: 'reading', x: 0, y: 460, width: 260, height: 180 }] },
    stage: {
      clientWidth: 936,
      clientHeight: 722,
      getBoundingClientRect: () => ({ left: 44, top: 78, width: 936, height: 722 }),
    },
  }
  const view = () => ({
    viewer: {
      ...viewer,
      setCamera: (camera: typeof viewer.camera) => {
        viewer.camera = camera
      },
    },
  })
  const run = (code: string) => new Function('view', code)(view)
  const stop = new Error('native press observed')
  let point: number[] = []
  const scope = {
    reopen: async () => {},
    chrome: { click: async () => {} },
    until: async () => {},
    run,
    middle: evaluate(middle, { run }),
    input: async (at: number[]) => {
      point = at
      throw stop
    },
  }
  await expect(evaluate(`(async () => ${body})()`, scope)).rejects.toBe(stop)
  expect(point[0]).toBeGreaterThan(44)
  expect(point[0]).toBeLessThan(980)
  expect(point[1]).toBeGreaterThan(78)
  expect(point[1]).toBeLessThan(760)
})

it('lets the debugger drawer finish opening before testing navigation out of it', async () => {
  const tree = source('debugJourney')
  let template = ''
  const visit = (node: ts.Node) => {
    if (
      ts.isTemplateExpression(node) &&
      node.getText(tree).includes('const row=()=>') &&
      node.getText(tree).includes('journey-phone-breakpoint-source')
    )
      template = node.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  let time = 0,
    openingAt = Infinity
  const left = {
    collapsed: true,
    backdropEl: { isConnected: false },
    containerEl: { style: { transform: '' } },
  }
  const right = {
    collapsed: false,
    backdropEl: { isConnected: true },
    containerEl: { style: { transform: '' } },
    collapse() {
      this.collapsed = true
      this.backdropEl.isConnected = false
    },
    expand() {
      this.collapsed = false
      this.backdropEl.isConnected = true
      this.containerEl.style.transform = 'translateX(10px)'
      openingAt = time + 400
    },
  }
  const wait = async (ms: number) => {
    time += ms
    if (time >= openingAt) {
      right.collapsed = false
      right.backdropEl.isConnected = true
      right.containerEl.style.transform = ''
      openingAt = Infinity
    }
  }
  const line = { offsetParent: {}, textContent: 'const item = inspectItem(n)' }
  const sourceLeaf = { view: { getState: () => ({ path: 'src/journey.cjs' }) }, detach() {} }
  const debugLeaf = { detach() {} }
  const workspace = {
    activeLeaf: sourceLeaf,
    leftSplit: left,
    rightSplit: right,
    getLeavesOfType: (type: string) =>
      type === 'abele-node-file' ? [sourceLeaf] : type === 'abele-debug-view' ? [debugLeaf] : [],
    revealLeaf: async (leaf: typeof sourceLeaf) => {
      workspace.activeLeaf = leaf
    },
    requestSaveLayout: { run: async () => {} },
  }
  const navigate = {
    click: () => {
      workspace.activeLeaf = sourceLeaf
      right.collapse()
    },
  }
  const row = {
    querySelector: (selector: string) =>
      selector.includes('__text') ? { textContent: 'journey.cjs:6' } : navigate,
  }
  const document = {
    querySelector: (selector: string) => (selector === '.abele-debug-panel_paused' ? {} : null),
    querySelectorAll: (selector: string) =>
      selector.includes('tree-item-self') ? [row] : selector.includes('line_here') ? [line] : [],
  }
  const until = async (read: () => unknown) => {
    for (let n = 0; n < 100; n++) {
      const value = read()
      if (value) return value
      await wait(50)
    }
    throw Error('probe did not converge')
  }
  const program = evaluate(template, {
    prelude: '',
    RUN: () => '',
    settledGeometry,
  })
  const result = await evaluate(program, {
    app: { workspace },
    document,
    wait,
    until,
    press: (element: { click(): void }) => element.click(),
    marginAt: () => ({ click() {} }),
    shot: () => wait(300),
    debugState: () => '',
    settledGeometry,
    Date: { now: () => time },
  })
  expect(result).toEqual({ highlighted: true, drawersClosed: true })
})
