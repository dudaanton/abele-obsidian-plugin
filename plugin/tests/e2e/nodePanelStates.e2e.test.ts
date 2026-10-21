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

const committedDiff = (device: string) =>
  evalAsync<boolean>(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  ${NODE_PANEL_FIXTURE}
  try {
    const panel = await nodePanel.open('feature')
    await nodePanel.mode('Changes')
    const row = panel.querySelector('[data-path="src/sample-committed.ts"]')
    if (!row) throw Error('Committed file row missing')
    row.click()
    let diff
    for (let i = 0; i < 100; i++) {
      diff = document.querySelector('.abele-node-main .abele-diff')
      if (diff?.textContent.includes('export const sample = false') && diff.textContent.includes('export const sample = true')) break
      await wait(100)
    }
    if (!diff) throw Error('Committed diff did not open')
    await wait(300)
    const box = diff.getBoundingClientRect()
    const visible = box.width > 100 && box.height > 20 && box.left >= 0 && box.left < innerWidth
    require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/${device}-committed-diff.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
    return visible && diff.textContent.includes('export const sample = false') && diff.textContent.includes('export const sample = true')
  } finally {
    const registrationId = window.__abeleNodePanelFixture?.registration.id
    for (const leaf of app.workspace.getLeavesOfType('abele-node-file')) {
      if (leaf.getViewState().state?.target?.registrationId === registrationId) leaf.detach()
    }
    await nodePanel.close()
  }
})()`)

it('opens the committed group in the existing diff view on desktop', () => {
  expect(committedDiff('desktop')).toBe(true)
})

it('opens the committed group in the existing diff view in the phone layout', async () => {
  expect(await withEmulatedPhone(async () => committedDiff('phone'))).toBe(true)
})

type States = Record<string, boolean>
const probe = (device: string) =>
  evalAsync<States>(`(async () => {
    const device = ${JSON.stringify(device)}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const fs = require('fs'), win = require('@electron/remote').getCurrentWindow()
    // A picture is of the panel only when the panel is what is on screen: a phone's drawer that
    // closed under a dismissed menu leaves the DOM in place and the picture an empty tab.
    // A menu or search opened from the panel is pictured over it: then the overlay is what must be
    // on top and whole inside the window, with the panel's drawer still open beneath it.
    const inside = (box) => box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1
    const onScreen = (overlay) => {
      const el = nodePanel.root(), box = el?.getBoundingClientRect()
      if (!box || box.width < 50 || box.height < 50) return false
      if (!overlay) return !!el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 200)))
      const over = overlay.getBoundingClientRect()
      if (app.workspace.leftSplit.collapsed || box.left < 0 || box.right > innerWidth + 1) return false
      if (over.width < 50 || over.height < 50 || !inside(over)) return false
      return !!overlay.contains(document.elementFromPoint(over.left + over.width / 2, over.top + Math.min(over.height / 2, 200)))
    }
    const shot = async (name, overlay) => { await wait(300); seen['onScreen ' + name] = onScreen(overlay); fs.writeFileSync(${JSON.stringify(SHOTS)} + '/${device}-' + name + '.png', (await win.webContents.capturePage()).toPNG()) }
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
      const { model } = window.__abeleNodePanelFixture
      const inspected = model.inspections.value
      model.inspections.value = {}
      seen.initialLoading = await until(() => panel.querySelector('[aria-busy="true"]')?.textContent.includes('Loading the file changes'))
      if (panel.querySelector('.abele-file-tree')) throw Error('Uninitialized status rendered as a file list')
      await shot('changes-loading')
      model.inspections.value = inspected
      await wait(100)
      await nodePanel.mode('Files'); seen.files = !!panel.querySelector('.abele-file-tree .tree-item-self[data-path]'); await shot('files')
      await nodePanel.mode('History'); seen.history = !!panel.querySelector('.abele-node-sidebar__history .abele-history__row-subject'); await shot('history')
      await nodePanel.mode('Pull requests'); seen.pulls = text(panel).includes('does not say which remote'); await shot('pulls')
      await nodePanel.mode('Sessions'); seen.sessions = !!panel.querySelector('.abele-session-row'); await shot('sessions')
      await nodePanel.mode('Changes')
      const places = await nodePanel.places(); seen.places = !!places.querySelector('.suggestion-item'); await shot('place-search', places); await nodePanel.dismiss()
      await shot('place-menu', await nodePanel.menu()); await nodePanel.dismiss()
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
      if (device === 'phone') {
        const names = [...panel.querySelectorAll('.abele-file-tree__group .abele-tree-item__text')]
          .filter((name) => name.closest('[data-path]'))
        seen.readableNames = names.length > 0 && names.every((name) => name.getBoundingClientRect().width >= 130)
      }
      await shot('changes-long')
      panel = await reopen({}, 'notes')
      // A folder without git has its files and its sessions, nothing of git.
      seen.plain = [...panel.querySelectorAll('.abele-node-modes [role="tab"]')].map((t) => t.getAttribute('aria-label').split(':')[0]).join() === 'Files,Sessions'
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
  expect(shown.length).toBe(14)
  expect(shown.filter(([, ok]) => !ok)).toEqual([])
  expect(
    Object.fromEntries(Object.entries(seen).filter(([key]) => !key.startsWith('onScreen ')))
  ).toEqual({
    changes: true,
    initialLoading: true,
    aheadBehind: true,
    files: true,
    history: true,
    pulls: true,
    sessions: true,
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
  expect(Object.keys(seen).filter((key) => key.startsWith('onScreen ')).length).toBe(14)
  expect(Object.entries(seen).filter(([, ok]) => !ok)).toEqual([])
})
