import { openChatSetup } from '../helpers/chatProbeInteractions'
/**
 * Focus rings in the chat dialogs, on the desktop.
 *
 * A field draws its ring outside its own box, so every ancestor that clips has to leave room
 * for it. Twice on 2026-09-05 one did not — the dialog's mount point on a phone, its content
 * element on the desktop — and the search field lost 2px off each side: «задолбала меня
 * обрезка содержимого в модалках». This focuses every focusable thing in every tab of the
 * setup dialog, the history, the icon picker, the MCP server form, the list of keys and every
 * other dialog `openDialog` knows, each of its tabs included, and the node panel with its place
 * search, place menu and agent choice, and measures its ring against every clipping ancestor. The
 * phone probe does the same at 390×844.
 *
 * Publication confirmation uses a presentation-only fixture here. Other sync dialogs require
 * a vault paired with a server, which this file does not make. `syncPhone.e2e.test.ts` and `syncDialogs.e2e.test.ts` measure their rings on the
 * desktop as well as on a phone, in vaults of their own.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalLong } from './helpers/obsidianCli'
import { MESSAGE_ACTIONS_SETUP, MESSAGE_ACTIONS_CLEANUP } from './helpers/messageActions'
import { shotDir } from './helpers/shots'
import { CATALOGUE_PROBE } from './helpers/designCatalogueProbe'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import {
  evalAsync,
  PRELUDE as BASE_PRELUDE,
  startFakeGithub,
  enableGithub,
  restoreGithub,
} from './helpers/githubLive'
import { openBasePicker, basePickerGeometry } from './helpers/githubBasePicker'
import { OPEN_LOCAL_NODE_FORM, CLOSE_LOCAL_NODE_FORM } from './helpers/nodeSettingsForm'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { SELECTION_PICKER_OPEN, SELECTION_PICKER_CLOSE } from './helpers/selectionScriptPicker'
import {
  SELECTION_MENUS_SETUP,
  SELECTION_MENUS_OPEN,
  SELECTION_MENUS_CLEANUP,
} from './helpers/selectionMenus'
import {
  PUBLICATION_SETUP,
  PUBLICATION_PRELUDE,
  PUBLICATION_CLEANUP,
  PUBLICATION_MEASURE,
  publicationFault,
} from './helpers/canvasPublicationReview'

interface Cut {
  screen: string
  field: string
  by: string[]
}

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const name = (el) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)
  const press = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  // Obsidian's own prompts (a fixture may be one) are dialogs too.
  const anyDialog = () => document.querySelector('.modal, .modal-container > .prompt')
  const closeDialog = async () => {
    if (!anyDialog()) return
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    if (await until(() => !anyDialog(), 3000)) return
    // A native prompt is dismissed by a press outside it.
    document.querySelector('.modal-container > .prompt')?.parentElement?.querySelector('.modal-bg')?.click()
    await until(() => !anyDialog(), 3000)
  }
  // Two frames of the window \`el\` is in, or a moment where it draws none.
  const frame = (el) => new Promise((r) => {
    const view = el.ownerDocument.defaultView
    const t = setTimeout(r, 250)
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => { clearTimeout(t); r() }))
  })
  // What was opened or chosen, drawn: \`ready\` holds, and the elements under \`rootOf()\` and its
  // box are the same two frames running. Past the allowance it is measured as it is.
  const settle = async (rootOf, ready = () => true) => {
    let last = null
    for (const deadline = Date.now() + 5000; Date.now() < deadline; ) {
      const root = rootOf()
      await frame(root || document.body)
      if (!root || !root.isConnected || !ready()) { last = null; continue }
      const r = root.getBoundingClientRect()
      const now = [root.getElementsByTagName('*').length, root.scrollWidth, root.scrollHeight, r.left, r.top, r.width, r.height].join(' ')
      if (now === last) return true
      last = now
    }
    return false
  }
  const chosen = (tab) => () => tab.classList.contains('abele-tabs__tab_active') || tab.classList.contains('abele-tabs__tab_disabled')
  const theModal = () => document.querySelector('.modal')

  const ringClipped = (field) => {
    const cs = getComputedStyle(field)
    const shadow = (${outwardBoxShadowReach.toString()})(cs.boxShadow)
    const outline = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0') : 0
    const reach = Math.max(shadow, outline)
    if (reach <= 0) return []
    const r = field.getBoundingClientRect()
    const ring = { left: r.left - reach, right: r.right + reach, top: r.top - reach, bottom: r.bottom + reach }
    const cut = []
    for (let el = field.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const b = el.getBoundingClientRect()
      const left = b.left + el.clientLeft, top = b.top + el.clientTop
      const box = { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
      // A scrolling box may legitimately have the field scrolled out of it vertically; the
      // sides are what a ring loses to a box that stands flush with the content.
      const by = Math.max(box.left - ring.left, ring.right - box.right)
      if (by > 0.5) cut.push(name(el) + ' ' + Math.round(by) + 'px')
    }
    return cut
  }

  const cuts = []
  const measureAll = (screen, root) => {
    const fields = root.querySelectorAll('input, textarea, select, button, summary, [tabindex="0"], .cm-content[contenteditable="true"]')
    for (const field of fields) {
      const s = getComputedStyle(field)
      if (s.display === 'none' || s.visibility === 'hidden') continue
      if (field.getBoundingClientRect().width === 0) continue
      field.focus()
      const by = ringClipped(field)
      if (by.length) cuts.push({ screen, field: name(field) + (field.placeholder ? ' "' + field.placeholder + '"' : ''), by })
      field.blur()
    }
  }

  await closeDialog()
  app.commands.executeCommandById('abele:show-ai-sidebar')
  await until(
    () => [...document.querySelectorAll('.abele-ai-chat')].some((el) => el.getBoundingClientRect().height > 0),
    5000
  )
  await settle(() => [...document.querySelectorAll('.abele-ai-chat')].find((el) => el.getBoundingClientRect().height > 0))

  ${MESSAGE_ACTIONS_SETUP}
  try {
    measureAll('message actions', actionRow)
    const dir = ${JSON.stringify(shotDir('abele-desktop'))}
    const fs = require('fs'), win = require('@electron/remote').getCurrentWindow()
    fs.writeFileSync(dir + '/message-actions.png', (await win.webContents.capturePage()).toPNG())
    actionRow.querySelector('[aria-label="More message actions"]').click()
    await until(() => document.querySelector('.menu'), 3000)
    await frame(document.body)
    if (!document.querySelector('.menu')) throw Error('Message actions menu did not open')
    fs.writeFileSync(dir + '/message-actions-menu.png', (await win.webContents.capturePage()).toPNG())
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))
    actionService.getSession(actionSourceId).preparingClone.value = true
    await until(() => {
      const c = [...document.querySelectorAll('.abele-ai-chat')].find(root=>root.getBoundingClientRect().width)
      return c && !c.querySelector('.abele-chat-input, .abele-ai-chat__header')
    }, 3000)
    await frame(document.body)
    const pendingChat = [...document.querySelectorAll('.abele-ai-chat')].find(root=>root.getBoundingClientRect().width)
    if (pendingChat.querySelector('.abele-chat-input, .abele-ai-chat__header')) throw Error('Pending copy is editable')
    measureAll('chat copy pending', pendingChat)
    fs.writeFileSync(dir + '/chat-copy-pending.png', (await win.webContents.capturePage()).toPNG())
    actionService.getSession(actionSourceId).preparingClone.value = false
  } finally { ${MESSAGE_ACTIONS_CLEANUP} }

  const chat = [...document.querySelectorAll('.abele-ai-chat')].find(
    (el) => el.getBoundingClientRect().height > 0
  )
  await (${openChatSetup.toString()})(chat, until)
  if (!(await until(() => document.querySelector('.modal .abele-chat-setup'), 5000))) {
    return JSON.stringify([{ screen: 'setup', field: '-', by: ['dialog did not open'] }])
  }
  await settle(theModal)
  for (const tab of [...document.querySelectorAll('.modal .abele-chat-setup .abele-tabs__tab')]) {
    tab.click()
    await settle(theModal, chosen(tab))
    measureAll('setup ' + tab.textContent.trim().toLowerCase(), document.querySelector('.modal'))
  }
  await closeDialog()

  press(chat && chat.querySelector('.lucide-history'))
  if (await until(() => document.querySelector('.modal'), 5000)) {
    await settle(theModal)
    measureAll('history', document.querySelector('.modal'))
    await closeDialog()
  }

  {
    ${SELECTION_PICKER_OPEN}
    measureAll('selection script picker', selectionPrompt)
    ${SELECTION_PICKER_CLOSE}
  }

  window.__abeleTest.openIconPicker('calendar')
  if (await until(() => document.querySelector('.modal .abele-icon-picker .abele-icon-picker__icon'), 5000)) {
    await settle(theModal)
    measureAll('icon picker', document.querySelector('.modal'))
    await closeDialog()
  } else {
    cuts.push({ screen: 'icon picker', field: '-', by: ['dialog did not open'] })
  }

  // The MCP server's form with its tools fetched, from a stub: fields above a body that scrolls,
  // and Save in the row under it.
  const service = window.__abeleTest.McpService.getInstance()
  const fetchTools = service.fetchTools
  try {
    service.fetchTools = async () =>
      Array.from({ length: 12 }, (_, i) => ({ name: 'tool-' + i, description: 'A tool.', inputSchema: { type: 'object', properties: {} } }))
    window.__abeleTest.openMcpServer()
    if (await until(() => document.querySelector('.modal .abele-mcp-server'), 5000)) {
      const modal = document.querySelector('.modal .abele-mcp-server').closest('.modal')
      ;[...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fetch tools').click()
      await until(() => modal.querySelectorAll('.abele-mcp-server .setting-item').length > 12, 5000)
      await settle(() => modal)
      measureAll('mcp server', modal)
      await closeDialog()
    } else {
      cuts.push({ screen: 'mcp server', field: '-', by: ['dialog did not open'] })
    }
  } finally {
    service.fetchTools = fetchTools
  }

  window.__abeleTest.openSecretsList()
  if (await until(() => document.querySelector('.modal .abele-secrets-list'), 5000)) {
    await settle(theModal)
    measureAll('secrets list', document.querySelector('.modal'))
    await closeDialog()
  } else {
    cuts.push({ screen: 'secrets list', field: '-', by: ['dialog did not open'] })
  }

  app.setting.open()
  app.setting.openTabById('abele')
  const settingsDoc = app.setting.activeTab.containerEl.ownerDocument
  if (await until(() => settingsDoc.querySelector('.abele-settings__nav .abele-tabs__tab'), 5000)) {
    ;[...settingsDoc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'Nodes')?.click()
    const settingsRoot = app.setting.activeTab.containerEl
    measureAll('settings nodes overview', settingsRoot)
    ${OPEN_LOCAL_NODE_FORM}
    await settle(() => nodeForm)
    measureAll('settings nodes', nodeForm)
    ${CLOSE_LOCAL_NODE_FORM}
  } else cuts.push({ screen: 'settings nodes', field: '-', by: ['settings did not open'] })
  app.setting.close()

  // The node panel, which took over the node workspaces window: its place row and modes in each
  // mode, a folder without git, the place search, the place menu and the agent choice a new chat
  // opens, on invented data with no node running.
  {
    ${NODE_PANEL_FIXTURE}
    try {
      const panel = await nodePanel.open('feature')
      await settle(() => panel)
      measureAll('node panel changes', panel)
      for (const mode of ['Files', 'History', 'Pull requests']) {
        await nodePanel.mode(mode)
        await settle(() => panel)
        measureAll('node panel ' + mode.toLowerCase(), panel)
      }
      const places = await nodePanel.places()
      await settle(() => places)
      measureAll('node panel places', places)
      await nodePanel.dismiss()
      const menu = await nodePanel.menu()
      measureAll('node panel place menu', menu)
      await nodePanel.dismiss()
      const agents = await nodePanel.newChat()
      await settle(() => agents)
      measureAll('node panel new chat', agents)
      await nodePanel.dismiss()
      await nodePanel.select('notes')
      await settle(() => panel)
      measureAll('node panel folder', panel)
    } catch (error) {
      cuts.push({ screen: 'node panel', field: '-', by: [String(error?.message || error)] })
    } finally {
      await nodePanel.close()
    }
  }

  // Every other dialog of the plugin, including the agents search/open/seen buttons,
  // in the dialog shell, opened by name.
  for (const dialogName of window.__abeleTest.dialogNames()) {
    try {
      let openingError
      const completion = window.__abeleTest.openDialog(dialogName)
      completion?.catch(error => { openingError = error })
      if (['node-files', 'node-diffs', 'node-review', 'node-history'].includes(dialogName)) await completion
      // The choice of a chat tab to close is Obsidian's own prompt, the quick switcher's list.
      const opened = () => document.querySelector('.modal.abele-modal, .modal-container > .prompt[data-abele-fixture="' + dialogName + '"]')
      if (await until(() => openingError || opened(), 5000)) {
        if (openingError) throw openingError
        await settle(opened)
        const modal = opened()
        // Empty, populated and long-path artifact fixtures must all retain their three sections.
        if (dialogName.startsWith('chat-artifacts') && !(dialogName === 'chat-artifacts-empty'
          ? modal.querySelectorAll('.abele-chat-artifacts section').length === 0 && modal.querySelector('.abele-chat-artifacts .abele-empty-state')
          : modal.querySelectorAll('.abele-chat-artifacts > section:not(.abele-chat-artifacts__changes)').length === 3 && modal.querySelector('.abele-chat-artifacts__changes')))
          cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['artifact sections did not open'] })
        // A chat's navigation opens fork by fork, not in separate tabs.
        if (dialogName === 'chat-navigation') {
          // Each newly mounted continuation can reveal one further fork, just as a user expands it.
          for (let level = 0; level < 4; level++) {
            for (const details of modal.querySelectorAll('details')) details.open = true
            for (const row of modal.querySelectorAll('.tree-item.is-collapsed > .tree-item-self > .collapse-icon')) row.click()
            await settle(() => modal)
          }
        }
        // Pairing input, owner-waiting and pin-recovery are distinct screens; do not
        // accidentally measure an empty shell while their asynchronous enrollment loads.
        if (dialogName === 'node-pairing-waiting' && !modal.querySelector('[aria-label="Device key fingerprint"]'))
          cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['device fingerprint did not open'] })
        if (dialogName === 'node-pairing-recovery' && !modal.querySelector('[aria-label="Owner verified new node key"]'))
          cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['pin recovery did not open'] })
        if (dialogName === 'node-pairing-endpoint' && !modal.querySelector('[aria-label="Owner verified new endpoint"]'))
          cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['endpoint recovery did not open'] })
        if (dialogName === 'node-delegation-grants' && !modal.querySelector('[aria-label="Delegation parent chat"]'))
          cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['delegation grant fields did not open'] })
        if (dialogName === 'node-delegation-card' && !modal.querySelector('[aria-label="Node delegation"]'))
          cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['delegation card did not open'] })
        // Node file/code/diff/review/history fixtures each exercise a separate view.
        measureAll('dialog ' + dialogName, modal)
        // A dialog with tabs, the agent editor's among them, is measured tab by tab.
        for (const tab of [...modal.querySelectorAll('.abele-tabs__tab')].slice(1)) {
          tab.click()
          await settle(() => modal, chosen(tab))
          measureAll('dialog ' + dialogName + ' ' + tab.textContent.trim().toLowerCase(), modal)
        }
      } else {
        cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['dialog did not open'] })
      }
    } catch (error) {
      cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: [String(error?.message || error)] })
    } finally {
      await closeDialog()
    }
  }

  return JSON.stringify(cuts)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('focus rings in the chat dialogs on the desktop', () => {
  let cuts: Cut[] = []

  beforeAll(async () => {
    cuts = JSON.parse(await evalLong(script, 240_000)) as Cut[]
  }, 270_000)

  it('no box in any dialog of the plugin cuts the ring off a focused field', () => {
    expect(cuts.map((c) => `${c.screen}: ${c.field} — ${c.by.join(', ')}`)).toEqual([])
  })
})

describe.skipIf(!available)('selection-menu focus rings', () => {
  it('keeps every Books and Chats field and action inside its clipping ancestors', async () => {
    const cuts = JSON.parse(
      await evalLong(
        `(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const until = async (fn, ms) => { for (let i = 0; i < ms / 50; i++) { if (fn()) return true; await wait(50) } return false }
      ${SELECTION_MENUS_SETUP}
      const cuts = []
      try {
        ${SELECTION_MENUS_OPEN}
        for (const [surface, label] of [['book', 'Books'], ['chat', 'Chats']]) {
          ;[...menuDoc.querySelectorAll('.abele-settings__selection-menus .abele-tabs__tab')].find(t => t.textContent.trim() === label)?.click()
          if (!await until(() => menuDoc.querySelector('.abele-selection-scripts-settings[data-surface="' + surface + '"]'), 5000)) throw Error('Surface did not open: ' + surface)
          await wait(300)
          const fields = menuDoc.querySelectorAll('.abele-settings__scripts input, .abele-settings__scripts button, .abele-settings__scripts [tabindex="0"]')
          for (const field of fields) {
            if (!field.getBoundingClientRect().width) continue
            field.focus()
            const style = getComputedStyle(field)
            const reach = Math.max((${outwardBoxShadowReach.toString()})(style.boxShadow), style.outlineStyle !== 'none' ? parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset || '0') : 0)
            const r = field.getBoundingClientRect()
            for (let el = field.parentElement; el && el !== menuDoc.documentElement; el = el.parentElement) {
              const s = getComputedStyle(el)
              if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
              const b = el.getBoundingClientRect(), left = b.left + el.clientLeft
              if (Math.max(left - (r.left - reach), r.right + reach - (left + el.clientWidth)) > 0.5) cuts.push(surface + ': ' + field.className + ' by ' + el.className)
            }
            field.blur()
          }
        }
        return JSON.stringify(cuts)
      } finally {
        ${SELECTION_MENUS_CLEANUP}
      }
    })()`,
        30_000
      )
    )
    expect(cuts).toEqual([])
  })
})

describe.skipIf(!available)('human Canvas focus rings', () => {
  it('keeps creation, pen, shapes, connection styles, text and handoff controls inside their clipping ancestors', () => {
    const result = evalAsync<string[]>(`(async () => {
      const path='sample-editor-rings.canvas'
      if(app.vault.getAbstractFileByPath(path))throw Error('Synthetic file already exists')
      const layout=app.workspace.getLayout(),file=await app.vault.create(path,JSON.stringify({nodes:[
        {id:'alpha',type:'text',text:'Input',x:0,y:0,width:220,height:120},
        {id:'beta',type:'text',text:'Result',x:360,y:0,width:220,height:120}
      ],edges:[{id:'flow',fromNode:'alpha',toNode:'beta',label:'Next'}]})),leaf=app.workspace.getLeaf('tab'),cuts=[]
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async fn=>{for(let i=0;i<60;i++){if(fn())return;await wait(50)}throw Error('Canvas ring inventory did not open: '+String(fn).slice(0,90))}
      const measure=(label,root)=>{
        for(const field of root.querySelectorAll('input,textarea,select,button,summary')){
          if(!field.getBoundingClientRect().width)continue
          field.focus()
          const reach=(${outwardBoxShadowReach.toString()})(getComputedStyle(field).boxShadow),r=field.getBoundingClientRect()
          for(let el=field.parentElement;el&&el!==document.documentElement;el=el.parentElement){
            const style=getComputedStyle(el);if(style.overflowX==='visible'&&style.overflowY==='visible')continue
            const b=el.getBoundingClientRect(),left=b.left+el.clientLeft
            if(Math.max(left-(r.left-reach),r.right+reach-(left+el.clientWidth))>.5)cuts.push(label+': '+field.getAttribute('aria-label'))
          }
          field.blur()
        }
      }
      const close=async()=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(200)}
      // Canvas work is written by itself, and native handoff writes it first; only a failed write
      // leaves work for the handoff choice and Discard to act on, so the write fails on purpose.
      const process=app.vault.process
      const failWrites=()=>{app.vault.process=async function(target,fn){if(target.path===path)throw Error('Sample known-unwritten save failure');return process.call(this,target,fn)}}
      try{
        await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);await until(()=>leaf.view.editor)
        const root=leaf.view.contentEl
        measure('editor',root)
        root.querySelector('[aria-label="Canvas drawing tools"]').click()
        root.querySelector('[aria-label="Draw with pen"]').click();measure('pen',root)
        root.querySelector('[aria-label="Draw with marker"]').click();measure('marker',root)
        root.querySelector('[aria-label="Erase whole strokes"]').click();measure('whole eraser',root)
        root.querySelector('[aria-label="Erase part of strokes"]').click();measure('partial eraser',root)
        root.querySelector('[aria-label="Lasso canvas objects"]').click()
        {const v=leaf.view.viewer,c=v.camera,r=v.stage.getBoundingClientRect(),n=v.graph.nodes[0],init={pointerId:1,pointerType:'touch',clientX:r.left+(n.x+n.width/2-c.x)*c.zoom,clientY:r.top+(n.y+n.height/2-c.y)*c.zoom,bubbles:true}
          for(const type of ['pointerdown','pointerup'])v.stage.dispatchEvent(new PointerEvent(type,init))}
        root.querySelector('.abele-canvas-ink-selection').open=true;measure('lasso selection actions',root)
        root.querySelector('.abele-canvas-ink-selection').open=false
        root.querySelector('[aria-label="Canvas drawing tools"]').click()
        root.querySelector('[aria-label="Shapes and connections"]').click();measure('shapes',root)
        root.querySelector('[aria-label="Shapes and connections"]').click()
        {const v=leaf.view.viewer,c=v.camera,r=v.stage.getBoundingClientRect(),init={pointerId:1,pointerType:'touch',clientX:r.left+(290-c.x)*c.zoom,clientY:r.top+(60-c.y)*c.zoom,bubbles:true}
          for(const type of ['pointerdown','pointerup'])v.stage.dispatchEvent(new PointerEvent(type,init))}
        root.querySelector('.abele-canvas-connection-properties').open=true;measure('connection style',root)
        root.querySelector('.abele-canvas-connection-properties').open=false
        root.querySelector('[aria-label="Add link"]').click();await until(()=>document.querySelector('.abele-canvas-input'));measure('link',document.querySelector('.abele-canvas-input'));await close()
        failWrites()
        root.querySelector('[aria-label="Add text card"]').click();measure('text',root)
        await until(()=>!root.querySelector('[aria-label="Retry save"]').hidden)
        leaf.view.containerEl.querySelector('[aria-label="Open in Obsidian Canvas"]').click();await until(()=>document.querySelector('.abele-canvas-choice'));measure('native',document.querySelector('.abele-canvas-choice'));await close()
        root.querySelector('[aria-label="Discard local draft"]').click();await until(()=>document.querySelector('.abele-canvas-choice'));measure('discard',document.querySelector('.abele-canvas-choice'));await close()
        app.vault.process=process
        app.commands.executeCommandById('abele:new-canvas');await until(()=>document.querySelector('.abele-canvas-input'));measure('creation',document.querySelector('.abele-canvas-input'))
        return cuts
      } finally {app.vault.process=process;await close();leaf.view.documentLease?.document.discardDraft();leaf.detach();await app.vault.delete(file);await app.workspace.changeLayout(layout)}
    })()`)
    expect(result).toEqual([])
  })
})

describe('Canvas publication review focus inventory', () => {
  it('keeps local review and affirmative confirmation rings inside their clipping ancestors', () => {
    const run = <T>(body: string): T =>
      evalAsync<T>(`(async () => JSON.stringify(await (async () => { ${body} })()))()`)
    run(PUBLICATION_SETUP)
    try {
      run(publicationFault('persisted'))
      run(`${PUBLICATION_PRELUDE}
        fixture.view.containerEl.querySelector('[aria-label="Recover failed canvas change"]').click()
        await until(() => modal()); return true
      `)
      for (const screen of ['review', 'confirmation']) {
        if (screen === 'confirmation')
          run(`${PUBLICATION_PRELUDE}
          [...modal().querySelectorAll('button')].find(button => button.textContent === 'Discard local pending copy…').click(); return true
        `)
        const result = run<{ cuts: string[]; outside: string[]; bodyOverflow: boolean }>(
          PUBLICATION_MEASURE
        )
        expect(result.cuts).toEqual([])
        expect(result.outside).toEqual([])
        expect(result.bodyOverflow).toBe(false)
      }
    } finally {
      run(PUBLICATION_CLEANUP)
    }
  })
})

describe.skipIf(!available)('GitHub comparison base focus', () => {
  it('keeps the native base picker field ring inside its clipping ancestors', async () => {
    const gh = await startFakeGithub()
    try {
      enableGithub(gh.origin)
      const result = evalAsync<{ clipped: string[]; over: string[] }>(`(async () => {
        ${BASE_PRELUDE}
        ${openBasePicker(gh.web)}
        ${basePickerGeometry}
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
        return pickerReport
      })()`)
      expect(result.clipped).toEqual([])
      expect(result.over).toEqual([])
    } finally {
      restoreGithub()
      await gh.stop()
    }
  }, 90000)
})

describe.skipIf(!available)('changelog controls', () => {
  it('keeps view and Notice focus rings inside their clipping ancestors', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const cuts = []
      const measure = root => {
        for (const button of root.querySelectorAll('button')) {
          button.focus()
          const win = button.ownerDocument.defaultView
          const style = win.getComputedStyle(button)
          const nums = (style.boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
          const shadow = nums.length >= 4 ? Math.max(0,nums[2]) + Math.max(0,nums[3]) : 0
          const outline = style.outlineStyle !== 'none' ? parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset || '0') : 0
          const reach = Math.max(shadow, outline), r = button.getBoundingClientRect()
          for (let el=button.parentElement; el && el !== button.ownerDocument.documentElement; el=el.parentElement) {
            const s=win.getComputedStyle(el)
            if(s.overflowX === 'visible' && s.overflowY === 'visible') continue
            const b=el.getBoundingClientRect(), left=b.left+el.clientLeft
            if(Math.max(left-(r.left-reach), r.right+reach-(left+el.clientWidth)) > .5) cuts.push(button.textContent.trim())
          }
          button.blur()
        }
      }
      app.commands.executeCommandById('abele:open-changelog'); await wait(300)
      const leaf=app.workspace.getLeavesOfType('abele-changelog')[0]
      if(!leaf) throw Error('changelog did not open')
      try {
        measure(leaf.view.contentEl)
        await leaf.setViewState({type:'abele-changelog',state:{range:{from:'1.56.0',to:'1.58.0'}},active:true}); await wait(150)
        measure(leaf.view.contentEl)
        const hide=window.__abeleTest.showChangelogOffer(app,{from:'1.56.0',to:'1.58.0'})
        try { const notice=[...document.querySelectorAll('.notice')].find(n=>n.textContent.includes("What's new")); if(!notice) throw Error('notice missing'); measure(notice) } finally {hide()}
      } finally {leaf.detach()}
      return JSON.stringify(cuts)
    })()`)
    ) as string[]
    expect(result).toEqual([])
  })
})

describe.skipIf(!available)('design catalogue desktop keyboard contracts', () => {
  it('inventories actions independently of focus selectors and isolates native activation', async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      const api = window.__abeleTest;
      const wait = () => new Promise(r => setTimeout(r, 150));
      const win = require('@electron/remote').getCurrentWindow();
      api.openDesignCatalogue('rows'); await wait();
      try {
        const main = document.querySelector('.abele-list-row__main');
        main.focus();
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
        win.webContents.sendInputEvent({type:'char',keyCode:String.fromCharCode(13)});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await wait();
        if (!document.querySelector('.abele-design-catalogue > [role="status"]')?.textContent.includes('sample.md')) throw Error('Native Enter did not open row');
        // A row that opens carries its fold once per platform, only one of them shown: the shown one.
        const control = [...document.querySelectorAll('.abele-disclosure__control')].find(el => el.getClientRects().length);
        control.focus();
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
        win.webContents.sendInputEvent({type:'char',keyCode:' '});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'}); await wait();
        if(control.getAttribute('aria-expanded') !== 'true') throw Error('Native Space did not expand detail');
        const more = document.querySelector('.abele-design-catalogue .abele-sheet-header-actions [aria-haspopup="menu"]');
        // Programmatic click leaves focus on the preceding disclosure. Activate the trigger
        // as a keyboard user does, so native dismissal has a real trigger to return to.
        more.focus();
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
        win.webContents.sendInputEvent({type:'char',keyCode:String.fromCharCode(13)});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await wait();
        const menu = document.querySelector('.menu'); if (!menu) throw Error('Native menu absent');
        const refresh = [...menu.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('Refresh')); refresh.click(); await wait();
        if(document.activeElement !== more) throw Error('Menu did not return focus');
        const feedback = document.querySelector('.abele-design-catalogue > [role="status"]');
        if(feedback?.textContent !== 'refresh') throw Error('Menu did not execute isolated action');
        ${CATALOGUE_PROBE}
      } finally { api.closeDesignCatalogue(); }
    })()`)
    ) as { failures: string[]; actions: number }
    expect(result.failures).toEqual([])
    expect(result.actions).toBeGreaterThanOrEqual(14)
  })
})
