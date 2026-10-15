import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { OPEN_LOCAL_NODE_FORM, CLOSE_LOCAL_NODE_FORM } from '../e2e/helpers/nodeSettingsForm'
import * as messageActions from '../e2e/helpers/messageActions'
import * as selectionPicker from '../e2e/helpers/selectionScriptPicker'
import * as selectionMenus from '../e2e/helpers/selectionMenus'
import * as publication from '../e2e/helpers/canvasPublicationReview'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import { recipientLayoutProbe } from '../helpers/keyDestinationLayoutProbe'
import * as chatProbeInteractions from '../helpers/chatProbeInteractions'
import { NODE_PANEL, NODE_PANEL_FIXTURE } from '../e2e/helpers/nodePanelFixture'

it.each([
  ['dialogRings', 'script'],
  ['phoneLayout', 'probeScript'],
])('parses the emitted %s browser geometry script', (file, variable) => {
  const source = readFileSync(`tests/e2e/${file}.e2e.test.ts`, 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let template = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === variable)
      template = node.initializer!.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(template).not.toBe('')
  const scope = {
    OPEN_LOCAL_NODE_FORM,
    CLOSE_LOCAL_NODE_FORM,
    ...messageActions,
    ...selectionPicker,
    ...selectionMenus,
    ...publication,
    outwardBoxShadowReach,
    recipientLayoutProbe,
    ...chatProbeInteractions,
    shotDir: () => 'sample-shots',
    SHOTS: 'sample-shots',
    WORD_SAMPLE: '',
    fixtureId: 'sample-fixture',
    CANVAS_SCREENS: ['sample review', 'sample confirmation'],
    NODE_PANEL,
    NODE_PANEL_FIXTURE,
    NODE_PANEL_SCREENS: ['node panel', 'node panel files'],
  }
  const script = new Function(...Object.keys(scope), `return ${template}`)(...Object.values(scope))
  expect(() => new Function(`return ${script}`)).not.toThrow()
})
