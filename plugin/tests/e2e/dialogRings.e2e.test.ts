/**
 * Focus rings in the chat dialogs, on the desktop.
 *
 * A field draws its ring outside its own box, so every ancestor that clips has to leave room
 * for it. Twice on 2026-09-05 one did not — the dialog's mount point on a phone, its content
 * element on the desktop — and the search field lost 2px off each side: «задолбала меня
 * обрезка содержимого в модалках». This focuses every focusable thing in every tab of the
 * setup dialog, the history, the icon picker, the MCP server form, the list of keys and every
 * other dialog `openDialog` knows, each of its tabs included, and measures its ring against every clipping ancestor. The
 * phone probe does the same at 390×844.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalLong } from './helpers/obsidianCli'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import { evalAsync } from './helpers/githubLive'
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
  const closeDialog = async () => {
    if (!document.querySelector('.modal')) return
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    await until(() => !document.querySelector('.modal'), 3000)
  }

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
    const fields = root.querySelectorAll('input, textarea, select, button, [tabindex="0"]')
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
  await wait(400)

  const chat = [...document.querySelectorAll('.abele-ai-chat')].find(
    (el) => el.getBoundingClientRect().height > 0
  )
  press(chat && chat.querySelector('.lucide-sliders-horizontal'))
  if (!(await until(() => document.querySelector('.modal .abele-chat-setup'), 5000))) {
    return JSON.stringify([{ screen: 'setup', field: '-', by: ['dialog did not open'] }])
  }
  await wait(300)
  for (const tab of [...document.querySelectorAll('.modal .abele-chat-setup .abele-tabs__tab')]) {
    tab.click()
    await wait(400)
    measureAll('setup ' + tab.textContent.trim().toLowerCase(), document.querySelector('.modal'))
  }
  await closeDialog()

  press(chat && chat.querySelector('.lucide-history'))
  if (await until(() => document.querySelector('.modal'), 5000)) {
    await wait(400)
    measureAll('history', document.querySelector('.modal'))
    await closeDialog()
  }

  window.__abeleTest.openIconPicker('calendar')
  if (await until(() => document.querySelector('.modal .abele-icon-picker .abele-icon-picker__icon'), 5000)) {
    await wait(400)
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
      await wait(400)
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
    await wait(400)
    measureAll('secrets list', document.querySelector('.modal'))
    await closeDialog()
  } else {
    cuts.push({ screen: 'secrets list', field: '-', by: ['dialog did not open'] })
  }

  // Every other dialog of the plugin, in the dialog shell, opened by name.
  for (const dialogName of window.__abeleTest.dialogNames()) {
    window.__abeleTest.openDialog(dialogName)
    if (await until(() => document.querySelector('.modal.abele-modal'), 5000)) {
      await wait(300)
      const modal = document.querySelector('.modal.abele-modal')
      measureAll('dialog ' + dialogName, modal)
      // A dialog with tabs, the agent editor's among them, is measured tab by tab.
      for (const tab of [...modal.querySelectorAll('.abele-tabs__tab')].slice(1)) {
        tab.click()
        await wait(300)
        measureAll('dialog ' + dialogName + ' ' + tab.textContent.trim().toLowerCase(), modal)
      }
    } else {
      cuts.push({ screen: 'dialog ' + dialogName, field: '-', by: ['dialog did not open'] })
    }
    await closeDialog()
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

describe.skipIf(!available)('human Canvas focus rings', () => {
  it('keeps creation, link, text, handoff and local-discard controls inside their clipping ancestors', () => {
    const result = evalAsync<string[]>(`(async () => {
      const path='sample-editor-rings.canvas'
      if(app.vault.getAbstractFileByPath(path))throw Error('Synthetic file already exists')
      const layout=app.workspace.getLayout(),file=await app.vault.create(path,'{"nodes":[],"edges":[]}'),leaf=app.workspace.getLeaf('tab'),cuts=[]
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async fn=>{for(let i=0;i<60;i++){if(fn())return;await wait(50)}throw Error('Canvas ring inventory did not open')}
      const measure=(label,root)=>{
        for(const field of root.querySelectorAll('input,textarea,button')){
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
      try{
        await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);await until(()=>leaf.view.editor)
        const root=leaf.view.contentEl
        measure('editor',root)
        root.querySelector('[aria-label="Add link"]').click();await until(()=>document.querySelector('.abele-canvas-input'));measure('link',document.querySelector('.abele-canvas-input'));await close()
        root.querySelector('[aria-label="Add text card"]').click();measure('text',root)
        leaf.view.containerEl.querySelector('[aria-label="Open in Obsidian Canvas"]').click();await until(()=>document.querySelector('.abele-canvas-choice'));measure('native',document.querySelector('.abele-canvas-choice'));await close()
        root.querySelector('[aria-label="Discard local draft"]').click();await until(()=>document.querySelector('.abele-canvas-choice'));measure('discard',document.querySelector('.abele-canvas-choice'));await close()
        app.commands.executeCommandById('abele:new-canvas');await until(()=>document.querySelector('.abele-canvas-input'));measure('creation',document.querySelector('.abele-canvas-input'))
        return cuts
      } finally {await close();leaf.view.documentLease?.document.discardDraft();leaf.detach();await app.vault.delete(file);await app.workspace.changeLayout(layout)}
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
