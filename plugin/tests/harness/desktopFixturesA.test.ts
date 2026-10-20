import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'
import { SCRIPT_FIXTURE } from '../e2e/helpers/scriptFixture'
import { OPEN_LOCAL_NODE_FORM } from '../e2e/helpers/nodeSettingsForm'
import { probePrelude } from '../e2e/helpers/layoutProbe'
import { RESTORE_PHONE_SCRIPT } from '../e2e/helpers/phoneState'
import { checkNodeFileMenuGeometry } from '../helpers/nodeFileMenuGeometry'
import { checkNodeChatGeometry } from '../helpers/nodeChatGeometry'

it('opens the node chat fixture form with its real poller and settings document', async () => {
  const prelude = source('nodeChat').match(/const PRELUDE = (`[\s\S]*?`)\n/)![1]
  const settings = document.createElement('div')
  const add = document.createElement('button')
  const row = document.createElement('div')
  row.className = 'setting-item'
  row.innerHTML = '<div class="setting-item-name">Add the node on this computer</div>'
  row.append(add)
  add.textContent = 'Add'
  // The settings tab mounts on Vue's next update, after its navigation click.
  const mount = setTimeout(() => settings.append(row), 25)
  const form = document.createElement('div')
  form.className = 'modal'
  const url = document.createElement('input')
  url.setAttribute('aria-label', 'Node URL')
  form.append(url)
  add.onclick = () => document.body.append(form)
  const api = { getInstance: () => ({}) }
  const setup = source('nodeChat').match(
    /const settingsRoot = .*?;\n([\s\S]*?)\n {6}const fill/
  )![1]
  const open = new Function(
    'window',
    'settingsRoot',
    'document',
    `return (async () => {
    ${new Function(`return ${prelude}`)()}
    ${new Function('OPEN_LOCAL_NODE_FORM', `return \`${setup}\``)(OPEN_LOCAL_NODE_FORM)}
    return nodeForm
  })()`
  )
  try {
    expect(
      await open({ __abeleTest: { ChatService: api, NodeService: api } }, settings, document)
    ).toBe(form)
  } finally {
    clearTimeout(mount)
    form.remove()
  }
})

const source = (name: string) => readFileSync(`tests/e2e/${name}.e2e.test.ts`, 'utf8')

it.each(['agentRights', 'interceptorScriptReplyOnly'])(
  'gives %s exact-byte fixture authority',
  (name) => {
    const code = source(name)
    for (const action of [
      'saveScriptFixture()',
      'enableScriptFixture(',
      'approveScriptFixture(',
      'restoreScriptFixture(',
    ])
      expect(code).toContain(action)
    expect(code).not.toContain("config.ai.scriptsFolder || DIR + '/Scripts'")
  }
)

it.each([
  'nodeChat',
  'nodePaired',
  'nodePath',
  'bookScripts',
  'scriptApproval',
  'actionConfirmations',
  'agentRights',
  'interceptorScriptReplyOnly',
  'proxyTimeout',
])('parses emitted browser programs in %s without a live app', (name) => {
  const tree = ts.createSourceFile(name, source(name), ts.ScriptTarget.Latest, true)
  const scope: Record<string, unknown> = {
    JSON,
    String,
    Boolean,
    resolve,
    WAIT_PRELUDE,
    SCRIPT_FIXTURE,
    OPEN_LOCAL_NODE_FORM,
    RESTORE_PHONE_SCRIPT,
    probePrelude,
    checkNodeFileMenuGeometry,
    checkNodeChatGeometry,
    shotDir: () => 'sample-shots',
    DIR: 'Sample fixture',
    BOOK: 'Sample fixture/sample.epub',
    PDF: 'Sample fixture/sample.pdf',
    SCRIPTS: 'Sample fixture/Scripts',
    CARDS: 'Sample fixture/Cards',
    SHOTS: 'sample-shots',
    shots: 'sample-shots',
    label: 'Sample',
    mode: 'desktop',
    modes: ['silent', 'closed'],
    failing: (one: string) => one === 'closed',
    place: 'migrate-dataview',
    port: 1234,
    token: 'sample-token',
    registrationId: 'sample-registration',
    registration: 'sample-registration',
    invite: { node_id: 'sample-node', node_fingerprint: 'sample-pin' },
    ids: {
      root: 'sample-root',
      external: 'sample-worktree',
      project: 'sample-project',
      plain: 'sample-plain',
    },
    selector: '.sample-code',
    projectPaths: ['sample-repository'],
    i: 0,
    width: 1100,
    height: 850,
    line: 1,
    endLine: 1,
    path: 'sample.js',
    files: {},
    saved: {},
    ECHOES: ['one'],
    body: '',
    how: '',
    desktopChecks: true,
    baseUrl: 'http://127.0.0.1:1234/v1',
    realpathSync: (path: string) => path,
  }
  const values = new Proxy(scope, {
    has: () => true,
    get: (object, key) => (typeof key === 'symbol' ? undefined : (object[key] ?? '')),
  })
  const emit = (text: string) => {
    const javascript = ts.transpile(`const value = (${text})`, { target: ts.ScriptTarget.ES2022 })
    return new Function('scope', `with(scope) { ${javascript}; return value }`)(values)
  }
  // Keep the actual preludes and script fixtures, never import an e2e module.
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (
        decl.initializer &&
        ['PRELUDE', 'prelude', 'SCRIPT', 'ECHO', 'measure'].includes(decl.name.getText(tree))
      )
        scope[decl.name.getText(tree)] = emit(decl.initializer.getText(tree))
    }
  }
  let checked = 0
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.getText(tree)
      if (/^`\((?:async|\(\))/.test(text)) {
        const raw =
          ts.isTaggedTemplateExpression(node.parent) &&
          node.parent.tag.getText(tree) === 'String.raw'
        let code: string
        try {
          code = emit((raw ? 'String.raw' : '') + text)
        } catch (error) {
          throw new Error(
            `${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}: ${String(error)}`
          )
        }
        expect(
          () => new Function(`return (async () => {${code}\n})()`),
          `${name}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}`
        ).not.toThrow()
        checked++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(checked).toBeGreaterThan(0)
})
