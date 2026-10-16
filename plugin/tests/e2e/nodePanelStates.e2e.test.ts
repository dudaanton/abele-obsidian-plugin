/**
 * The node panel in each of its states, on a computer and in the phone layout, as pictures to
 * look at beside the design: files, changes (staged, nothing staged, a long list, a conflict),
 * the branch ahead and behind its base, history, pull requests, a folder without git, a node
 * with no folder open, and a node that dropped. Each state also has a plain check, so a state
 * that did not show fails rather than leaving a wrong picture.
 */
import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
targets('desktop')
const SHOTS = shotDir('abele-node-panel-states')

type States = Record<string, boolean>
const probe = (device: string) =>
  evalAsync<States>(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const fs = require('fs'), win = require('@electron/remote').getCurrentWindow()
    // A picture is of the panel only when the panel is what is on screen: a phone's drawer that
    // closed under a dismissed menu leaves the DOM in place and the picture an empty tab.
    const onScreen = () => {
      const el = nodePanel.root(), box = el?.getBoundingClientRect()
      if (!box || box.width < 50 || box.height < 50) return false
      return !!el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 200)))
    }
    const shot = async (name) => { await wait(300); seen['onScreen ' + name] = onScreen(); fs.writeFileSync(${JSON.stringify(SHOTS)} + '/${device}-' + name + '.png', (await win.webContents.capturePage()).toPNG()) }
    const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return true; await wait(50) } return false }
    const seen = {}
    ${NODE_PANEL_FIXTURE}
    // One panel throughout, its node's answers changed under it and read again: a phone's
    // drawer does not come back for a panel opened anew.
    const reopen = async (variant, place = 'feature') => {
      for (const key of Object.keys(nodePanel.variant)) delete nodePanel.variant[key]
      Object.assign(nodePanel.variant, variant)
      if (!window.__abeleNodePanelFixture) return nodePanel.open(place)
      const { model } = window.__abeleNodePanelFixture
      // As a node reconnecting with other answers: its capabilities are read anew.
      model.capabilities.value = [...model.capabilities.value]
      await model.refreshCurrent()
      const panel = await nodePanel.select(place)
      // The branch is read again on a new observation; the fixture's observation stays the same.
      await model.loadPanelBranch()
      await wait(300)
      return panel
    }
    const text = (panel) => panel.textContent
    try {
      let panel = await reopen({})
      seen.changes = !!panel.querySelector('.abele-file-tree__group')
      seen.aheadBehind = panel.querySelector('.abele-branch-codes__drift')?.textContent.replace(/\\s/g, '') === '21'
      await shot('changes-staged')
      await nodePanel.mode('Files'); seen.files = !!panel.querySelector('.abele-file-tree .tree-item-self[data-path]'); await shot('files')
      await nodePanel.mode('History'); seen.history = !!panel.querySelector('.abele-node-sidebar__history .abele-history__row-subject'); await shot('history')
      await nodePanel.mode('Pull requests'); seen.pulls = text(panel).includes('does not say which remote'); await shot('pulls')
      await nodePanel.mode('Changes')
      const places = await nodePanel.places(); seen.places = !!places.querySelector('.suggestion-item'); await shot('place-search'); await nodePanel.dismiss()
      await nodePanel.menu(); await shot('place-menu'); await nodePanel.dismiss()
      panel = await reopen({ git: true })
      seen.commitBox = await until(() => panel.querySelector('.abele-commit-box textarea'))
      seen.stageGlyphs = !!panel.querySelector('[aria-label="Unstage"]')
      await shot('git-staged-commit')
      panel = await reopen({ git: true, staged: false })
      seen.step = await until(() => panel.querySelector('.abele-node-sidebar__step button')?.textContent.trim() === 'Push 1')
      await shot('git-nothing-staged-step')
      panel = await reopen({ git: true, conflict: true })
      seen.conflict = await until(() => panel.querySelector('.abele-node-sidebar__stopped')?.textContent.includes('rebase'))
      await shot('git-conflict')
      panel = await reopen({ many: 120 })
      seen.long = panel.querySelectorAll('.abele-file-tree__group .tree-item-self').length > 40
      await shot('changes-long')
      panel = await reopen({}, 'notes')
      seen.plain = panel.querySelectorAll('.abele-node-modes [role="tab"]').length === 1
      await shot('folder-without-git')
      await reopen({ empty: true }).catch(() => {})
      const root = nodePanel.root()
      seen.empty = await until(() => root?.textContent.includes('to see its files and changes'))
      await shot('empty')
      return seen
    } finally {
      await nodePanel.close()
    }
  })()`)

it('pictures every state of the node panel on a computer', () => {
  const seen = probe('desktop')
  const shown = Object.entries(seen).filter(([key]) => key.startsWith('onScreen '))
  expect(shown.length).toBe(12)
  expect(shown.filter(([, ok]) => !ok)).toEqual([])
  expect(Object.fromEntries(Object.entries(seen).filter(([key]) => !key.startsWith('onScreen ')))).toEqual({
    changes: true,
    aheadBehind: true,
    files: true,
    history: true,
    pulls: true,
    places: true,
    commitBox: true,
    stageGlyphs: true,
    step: true,
    conflict: true,
    long: true,
    plain: true,
    empty: true,
  })
})

it('pictures every state of the node panel in the phone layout', async () => {
  const seen = await withEmulatedPhone(async () => probe('phone'))
  expect(Object.keys(seen).filter((key) => key.startsWith('onScreen ')).length).toBe(12)
  expect(Object.entries(seen).filter(([, ok]) => !ok)).toEqual([])
})
