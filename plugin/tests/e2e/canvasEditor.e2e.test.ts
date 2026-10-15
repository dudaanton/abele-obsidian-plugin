import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap, typeText, screenshot } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'
import { CANVAS_TRACE_DUMP, CANVAS_TRACE_INSTALL } from './helpers/canvasTrace'
import { dismissOwnNotices } from './helpers/ownNotices'
import { canvasChrome, menuItem } from './helpers/canvasChrome'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = `Sample human canvas ${randomUUID()}`
const SHOTS = shotDir('canvas-editor')
const PRELUDE = `
  const path = ${JSON.stringify(`${DIR}/Sample diagram.canvas`)}
  const view = () => app.workspace.getLeavesOfType('abele-canvas').find(leaf => leaf.view.file?.path === path)?.view
  const read = async () => JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
  const button = label => view()?.contentEl.querySelector('[aria-label="'+label+'"]')
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE} return JSON.stringify(await (async () => { ${body} })()) })()`
  )
const until = async (expression: string) => {
  try {
    await expect
      .poll(() => run<boolean>(`return !!(${expression})`), { timeout: 10_000 })
      .toBe(true)
  } catch (error) {
    console.info('Canvas trace at a failed wait:', expression, JSON.stringify(traced()))
    throw error
  }
}
const traced = () => {
  try {
    return run<unknown>(CANVAS_TRACE_DUMP)
  } catch (error) {
    return String(error)
  }
}
const trace = () => run<boolean>(CANVAS_TRACE_INSTALL)
// Direct driver touches avoid an in-page HTTP request being cancelled when a native mobile
// prompt closes. No touch is retried. Desktop down/up still hold the shared native-input lock.
const press = async (expression: string, corner = false) => {
  const geometry = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect();
    if(!r.width||!r.height||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return null;
    const x=Math.round(r.left+${corner ? '10' : 'r.width/2'}),y=Math.round(r.top+${corner ? '10' : 'r.height/2'}),hit=document.elementFromPoint(x,y);
    // Notices cover the mobile header after a failed save. Wait for a genuinely reachable
    // action rather than tapping the Notice. Card frames intentionally pass input to the stage.
    if(!el.contains(hit)&&!(el.matches('.abele-canvas-card-frame')&&el.closest('.abele-canvas-stage')?.contains(hit)))return null;
    return [x,y]`
  // A long menu is a sheet on a phone that scrolls: an item below its fold (Remove from canvas,
  // last in a card's More) is scrolled to, as a person swipes the sheet up, then pressed in sight.
  const reach = `const at=(()=>{${geometry}})();if(!at){const el=${expression};if(el?.closest('.menu'))el.scrollIntoView({block:'nearest'})}return at`
  // The place found when it was first reachable, not asked again: a control can move between.
  let found: number[] | null = null
  await expect
    .poll(() => (found = run<number[] | null>(reach)), { timeout: 10_000 })
    .not.toBeNull()
    .catch((error: unknown) => {
      console.info(
        'Canvas press found no reachable point:',
        expression,
        JSON.stringify(
          run(`const el=${expression},r=el?.getBoundingClientRect();return {rect:r?.toJSON(),inner:[innerWidth,innerHeight],
            hit:r&&document.elementFromPoint(Math.round(r.left+${corner ? '10' : 'r.width/2'}),Math.round(r.top+${corner ? '10' : 'r.height/2'}))?.outerHTML?.slice(0,160)}`)
        ),
        JSON.stringify(traced())
      )
      throw error
    })
  const [x, y] = found!
  if (onPhone()) tap(x, y)
  else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try {await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:${x},y:${y},button:'left',buttons:1,clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${x},y:${y},button:'left',buttons:0,clickCount:1})}
    finally {if(owned)cdp.detach()}return true
  `)
    )
}
/** A tap or click at a point of the screen. */
const at = async ([x, y]: number[]) => {
  if (onPhone()) tap(x, y)
  else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try {await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:${x},y:${y},button:'left',buttons:1,clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${x},y:${y},button:'left',buttons:0,clickCount:1})}
    finally {if(owned)cdp.detach()}return true
  `)
    )
}
const chrome = canvasChrome({ run, press: (e) => press(e), until, at, phone: onPhone() })
/**
 * Presses what does `label` on the canvas's tool bar, its column, the bar over the picked or a menu.
 * Leaving a field is a press on empty canvas in sight: on a phone, not on the keyboard over it.
 */
const click = (label: string, allowDisabled = false) =>
  label === 'Save text'
    ? at(chrome.emptySpotInSight() ?? chrome.emptySpot())
    : chrome.click(label, allowDisabled)
/** How far down the page a person sees: above a phone's keyboard when it is up. */
const SEEN = `Math.min(innerHeight-(parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height'))||0),window.visualViewport?visualViewport.offsetTop+visualViewport.height:innerHeight)`
const type = async (text: string) => {
  if (onPhone()) {
    // DOM focus precedes the native keyboard. Wait for it, then use its keys directly:
    // a failed XCUITest focused-field attempt can partially type before falling back.
    // `typeText` itself waits until the keyboard takes input.
    await until(`document.activeElement?.matches('input,textarea') &&
      (parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height')) > 1 ||
       innerHeight - (window.visualViewport?.height ?? innerHeight) > 1)`)
    const expected = run<string>(`const field=document.activeElement;
      return field.value.slice(0,field.selectionStart)+${JSON.stringify(text)}+field.value.slice(field.selectionEnd)`)
    // The keyboard-keys way has no key for Backspace; the field's own typing deletes.
    if (text === '\b') typeText(text, 'focus')
    else {
      typeText(text, 'keys')
      await expect
        .poll(() => run<string>('return document.activeElement?.value'), { timeout: 10_000 })
        .toBe(expected)
    }
  } else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try {
      if(${JSON.stringify(text)}==='\\b') {
        await cdp.sendCommand('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8})
        await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8})
      } else await cdp.sendCommand('Input.insertText',{text:${JSON.stringify(text)}})
    }finally {if(owned)cdp.detach()}return true
  `)
    )
}
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
const textButton = (root: string, text: string) =>
  `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(el=>el.textContent===${JSON.stringify(text)})`
const saved = () =>
  until(
    "view()?.documentLease && !view().documentLease.document.session.dirty && !button('Add text card').disabled"
  )
const restoreProcess = () =>
  run(
    'app.vault.process=window.__humanCanvas.process;delete window.__humanCanvas.process;return true'
  )
const failSave = () =>
  run(`
  window.__humanCanvas.process=app.vault.process
  app.vault.process=async function(file,fn){if(file.path===path)throw Error('Sample known-unwritten save failure');return window.__humanCanvas.process.call(this,file,fn)}
  return true
`)
/** Card is the placing tool: in hand from its slot in the row, or from More tools on a phone. */
const takeCard = async () => {
  const slot = `view().contentEl.querySelector('.abele-canvas-chrome__tools [aria-label="Card (T)"]')`
  if (run<boolean>(`const el=${slot};return !!el&&el.getBoundingClientRect().width>0`))
    await press(slot)
  else {
    const more = `view().contentEl.querySelector('.abele-canvas-chrome__tools [aria-label="More tools"]')`
    await press(more)
    await until(menuItem('Card'))
    await press(menuItem('Card'))
  }
  await until("view().editor.controls.tool()==='card'")
}
/**
 * Where a person puts a card down: a free place with room for the whole card on screen, nearest
 * the middle. A card is centred on the press at its default size (260 by 120 at zoom 1), and its
 * text field is laid over it; pressed near the stage's edge, half the field hangs off the screen.
 */
const roomForCard = () =>
  run<number[] | null>(`
    const v=view().viewer,s=v.stage.getBoundingClientRect(),c=v.camera,g=v.graph
    const w=130*c.zoom+12,h=60*c.zoom+12
    const left=Math.max(s.left,0),right=Math.min(s.right,innerWidth),top=Math.max(s.top,0),bottom=Math.min(s.bottom,${SEEN})
    const clear=(x,y)=>{const hit=document.elementFromPoint(x,y);return !!hit&&v.stage.contains(hit)&&!hit.closest('.abele-canvas-chrome,[data-frame-id],[data-card-id]')}
    const spots=[];for(let fy=0.1;fy<0.95;fy+=0.05)for(let fx=0.1;fx<0.95;fx+=0.05)spots.push([Math.round(s.left+s.width*fx),Math.round(s.top+s.height*fy)])
    const mid=[(left+right)/2,(top+bottom)/2];spots.sort((a,b)=>Math.hypot(a[0]-mid[0],a[1]-mid[1])-Math.hypot(b[0]-mid[0],b[1]-mid[1]))
    for(const [x,y] of spots){
      if(x-w<left||x+w>right||y-h<top||y+h>bottom)continue
      const x0=c.x+(x-w-s.left)/c.zoom,x1=c.x+(x+w-s.left)/c.zoom,y0=c.y+(y-h-s.top)/c.zoom,y1=c.y+(y+h-s.top)/c.zoom
      if(g.nodes.some(n=>n.x-20<x1&&n.x+n.width+20>x0&&n.y-20<y1&&n.y+n.height+20>y0))continue
      if(![[x,y],[x-w,y-h],[x+w,y-h],[x-w,y+h],[x+w,y+h]].every(([px,py])=>clear(px,py)))continue
      return [x,y]}
    // A phone at the zoom a new canvas opens with has no room for a whole card: press the middle.
    const x=Math.round(mid[0]),y=Math.round(mid[1]);return clear(x,y)?[x,y]:null`)
/**
 * Presses the card's text field where it is on screen. A card put down near an edge, or wider
 * than a phone at the canvas's zoom, has part of its field off screen; a person presses the part
 * they see, so only that part has to be reachable. On a phone the press is what brings the
 * keyboard up: a field opened by a tap (Edit text) already has it and its caret, and a person
 * just types; the part of a field under the keyboard is not in sight.
 */
const pressField = async () => {
  if (
    onPhone() &&
    run<boolean>(`const field=view().contentEl.querySelector("textarea"),up=()=>document.activeElement===field&&innerHeight-(${SEEN})>1
      const end=Date.now()+2000;while(Date.now()<end&&!up())await new Promise(r=>setTimeout(r,100));return up()`)
  )
    return
  const geometry = `const el=view().contentEl.querySelector("textarea");if(!el)return null;const r=el.getBoundingClientRect()
    const l=Math.max(r.left,0),t=Math.max(r.top,0),rr=Math.min(r.right,innerWidth),b=Math.min(r.bottom,${SEEN})
    if(rr-l<20||b-t<20)return null
    const x=Math.round((l+rr)/2),y=Math.round((t+b)/2);return el.contains(document.elementFromPoint(x,y))?[x,y]:null`
  await expect.poll(() => run<number[] | null>(geometry), { timeout: 10_000 }).not.toBeNull()
  await at(run<number[]>(geometry))
}
const beginText = async () => {
  await takeCard()
  const spot = roomForCard()
  expect(spot, 'No free place on the canvas to put a card down').not.toBeNull()
  await chrome.at(spot!)
  console.info(
    'Add text transition:',
    run(`const el=view().contentEl.querySelector('textarea'),r=el?.getBoundingClientRect();return {
    enabled:!button('Add text card').disabled,editing:view().editor.editing,draft:!!view().documentLease.document.draftPath,
    focused:document.activeElement===el,rect:r?.toJSON(),hit:r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML}`)
  )
  await until(
    'view().editor.editing && !view().contentEl.querySelector(".abele-canvas-text-editor").hidden && document.activeElement===view().contentEl.querySelector("textarea")'
  )
}
/**
 * Card text saves itself, with no Save button: the file gets the typed text while the card is
 * still open, and tapping the canvas leaves it.
 */
const leaveText = async (text?: string, written = true) => {
  if (text !== undefined && written)
    await until(
      `view().editor.editing && (await read()).nodes.some(n=>n.text?.includes(${JSON.stringify(text)}))`
    )
  // A write that fails while typing offers Retry with the card still open.
  if (!written)
    await until("view().editor.editing && button('Retry save') && !button('Retry save').hidden")
  // The canvas's own corner: the card itself can sit below the window once Retry shows.
  await press('view().viewer.stage', true)
  await until('!view().editor.editing')
}
const addText = async (text: string, written = true) => {
  await beginText()
  await pressField()
  await type(text)
  await leaveText(text, written)
}
const reopen = async () => {
  run(
    `const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true`
  )
  await until('view()?.editor')
  trace()
}

describe.skipIf(!available)('human canvas creation and editing with real input', () => {
  let creationStarted = false
  let created = false
  beforeEach(({ task }) => {
    if (creationStarted && !created) {
      // Only the native-handoff guarantee is expected to fail, not a missing fixture.
      task.fails = false
      expect(created, 'Canvas creation failed; dependent edits cannot run').toBe(true)
    }
  })
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__humanCanvas={layout:app.workspace.getLayout(),preference:window.__abeleTest.AbeleConfig.getInstance().canvasViewer,location:app.vault.getConfig('newFileLocation')}
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer=true
      if(!${onPhone()}){app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()}
      app.vault.setConfig('newFileLocation','current')
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__humanCanvas.owned=true
      const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},'A note inserted by a person.')
      const leaf=app.workspace.getLeaf('tab');await leaf.openFile(note);await app.workspace.revealLeaf(leaf);return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      const fixture=window.__humanCanvas
      if(fixture?.process)app.vault.process=fixture.process
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      const leaves=[];app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(leaf)})
      for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
      if(fixture?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
      if(fixture){window.__abeleTest.AbeleConfig.getInstance().canvasViewer=fixture.preference;app.vault.setConfig('newFileLocation',fixture.location);await app.workspace.changeLayout(fixture.layout)}
      delete window.__humanCanvas;return true
    `)
    dismissOwnNotices('Canvas updated ')
  }, 120_000)

  it('creates an empty canvas from the palette and completes a card with keyboard input', async () => {
    creationStarted = true
    // Navigation opens the palette; creation itself is chosen with real input.
    run("app.commands.executeCommandById('command-palette:open');return true")
    await press('document.querySelector(".prompt-input")')
    // Select the query, then delete through the native keyboard; never assign the DOM value.
    run('document.querySelector(".prompt-input").select();return true')
    await type('\b')
    await until('document.querySelector(".prompt-input")?.value === ""')
    await type('new canvas')
    await until('document.querySelector(".prompt-input")?.value === "new canvas"')
    shot('creation-palette')
    const command =
      '[...document.querySelectorAll(".suggestion-item")].find(el=>/Abele.*New canvas/i.test(el.textContent))'
    await until(command)
    await press(command)
    await press('document.querySelector(\'[aria-label="Canvas name"]\')')
    await type('Sample diagram')
    await press(textButton('.abele-canvas-input', 'Create'))
    await until('view()?.editor')
    trace()
    const empty = run<boolean>('return (await read()).nodes.length===0')
    await beginText()
    const focused = run<boolean>(
      'return document.activeElement===view().contentEl.querySelector("textarea")'
    )
    await pressField()
    await type('Human concept')
    shot('text-keyboard')
    expect(run<boolean>('return !button("Save text") && !button("Keep text draft")')).toBe(true)
    await leaveText('Human concept')
    await saved()
    const result = run<{ text: string; undo: number }>(
      'return {text:(await read()).nodes[0].text,undo:view().documentLease.document.session.history.undo}'
    )
    // Every pause in typing is its own undo step, written as it happens. Desktop input arrives
    // at once, one step; the phone driver presses one key at a time, slower than the longest
    // wait, so there it is a step per write: at least one, never more than one per key.
    const undo = onPhone() ? Math.min(Math.max(result.undo, 1), 'Human concept'.length) : 1
    expect({ ...result, focused, empty }).toEqual({
      text: 'Human concept',
      undo,
      focused: true,
      empty: true,
    })
    created = true
  }, 120_000)

  it('inserts a note through the native picker, selects a card by pointer, and deletes/undoes/redoes', async () => {
    await click('Add note or attachment')
    await press('document.querySelector(".prompt-input")')
    await type('sample-note')
    await press(
      `[...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes(${JSON.stringify(DIR + '/sample-note.md')}))`
    )
    await saved()
    await until('view().viewer.graph.nodes.length===2')
    const note = run<string>("return (await read()).nodes.find(node=>node.type==='file').file")
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(node=>node.type==='file').id+'"]')`
    )
    const selected = run<boolean>(
      "return !button('Open selected card').disabled && button('Edit card text').disabled"
    )
    await click('Delete selected card')
    await saved()
    const deleted = run<boolean>('return (await read()).nodes.length===1')
    await click('Undo canvas change')
    await saved()
    const restored = run<boolean>(
      `return (await read()).nodes.some(node=>node.file===${JSON.stringify(note)})`
    )
    await click('Redo canvas change')
    await saved()
    const redone = run<boolean>('return (await read()).nodes.length===1')
    await click('Undo canvas change')
    await saved()
    shot('cards-history')
    expect({ note, selected, deleted, restored, redone }).toEqual({
      note: `${DIR}/sample-note.md`,
      selected: true,
      deleted: true,
      restored: true,
      redone: true,
    })
  }, 120_000)

  it('leaves unchanged text without writing and keeps redo available', async () => {
    const before = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    const history = run<{ undo: number; redo: number }>(
      'return view().documentLease.document.session.history'
    )
    expect(history.redo).toBe(1)
    run(`window.__humanCanvas.process=app.vault.process;window.__humanCanvas.noopWrites=0;
      app.vault.process=function(file,fn){if(file.path===path)window.__humanCanvas.noopWrites++;return window.__humanCanvas.process.call(this,file,fn)};return true`)
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(node=>node.type==='text').id+'"]')`,
      true
    )
    await click('Edit card text')
    await until('view().editor.editing')
    await leaveText()
    await saved()
    const result = run<{ same: boolean; writes: number; history: typeof history }>(
      `return {same:${JSON.stringify(before)}===await app.vault.read(app.vault.getAbstractFileByPath(path)),writes:window.__humanCanvas.noopWrites,history:view().documentLease.document.session.history}`
    )
    expect(result).toEqual({ same: true, writes: 0, history })
    restoreProcess()
    await click('Redo canvas change')
    await saved()
    expect(run<number>('return (await read()).nodes.length')).toBe(1)
    await click('Undo canvas change')
    await saved()
    expect(run<number>('return (await read()).nodes.length')).toBe(2)
  }, 120_000)

  it('edits selected canvas text without editing the inserted note and adds a web link', async () => {
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(node=>node.type==='text').id+'"]')`,
      true
    )
    await click('Edit card text')
    await pressField()
    await type(' revised')
    await leaveText(' revised')
    await saved()
    const text = run<string>("return (await read()).nodes.find(node=>node.type==='text').text")
    const note = run<string>(
      `return await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/sample-note.md')}))`
    )
    await click('Add link')
    await press('document.querySelector(\'[aria-label="Web address"]\')')
    await type('https://sample.example/diagram')
    await press(textButton('.abele-canvas-input', 'Create'))
    await saved()
    const link = run<string>("return (await read()).nodes.find(node=>node.type==='link').url")
    expect(text).toContain('Human concept')
    expect(text).toContain('revised')
    expect(note).toBe('A note inserted by a person.')
    expect(link).toBe('https://sample.example/diagram')
  }, 120_000)

  it('keeps a failed write of an undo visible as local work, then discards it explicitly', async () => {
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(node=>node.type==='text').id+'"]')`,
      true
    )
    const before = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    const history = run<{ undo: number; redo: number }>(
      'return view().documentLease.document.session.history'
    )
    failSave()
    try {
      // Undo applies at once in memory; its batched write fails and the work stays local.
      await click('Undo canvas change')
      await until("button('Retry save')&&!button('Retry save').hidden")
      expect(run<boolean>("return view().contentEl.textContent.includes('not saved')")).toBe(true)
      expect(run('return view().documentLease.document.session.history')).toEqual(history)
    } finally {
      restoreProcess()
    }
    await click('Discard local draft')
    await press(textButton('.abele-canvas-choice', 'Discard local draft'))
    await saved()
    expect(run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')).toBe(
      before
    )
  }, 120_000)

  it('retries a known-unwritten human save on the same source and reopens saved content', async () => {
    failSave()
    // Use ordinary words: the native keyboard autocorrects a made-up adjective on space.
    await addText('Pending human text', false)
    // Retry shows once the write has failed.
    await until(
      "button('Retry save')&&!button('Retry save').hidden&&!button('Retry save').disabled"
    )
    const pending = run<boolean>(
      "return view().viewer.graph.nodes.some(node=>node.text==='Pending human text')&&view().contentEl.textContent.includes('not saved')"
    )
    restoreProcess()
    await click('Retry save')
    await saved()
    const written = run<boolean>(
      "return (await read()).nodes.some(node=>node.text==='Pending human text')"
    )
    run('view().leaf.detach();return true')
    await reopen()
    const reopened = run<boolean>(
      "return view().viewer.graph.nodes.some(node=>node.text==='Pending human text')"
    )
    expect({ pending, saved: written, reopened }).toEqual({
      pending: true,
      saved: true,
      reopened: true,
    })
  }, 120_000)

  // BUG: native Canvas rewrites only JSON whitespace on unload. The strict byte revision
  // correctly blocks a retained draft's retry, even without a semantic native edit. Do not
  // cancel native saves or acknowledge matching content to make this guarantee pass.
  it.fails(
    'keeps a failed human save visible, asks before native handoff, and reopens retained text for retry',
    async ({ task }) => {
      let result: {
        unsaved: boolean
        sourceSame: boolean
        retained: boolean
        native: boolean
        reopened: boolean
        saved: boolean
      }
      try {
        const before = run<string>(
          'return await app.vault.read(app.vault.getAbstractFileByPath(path))'
        )
        failSave()
        await addText('Retained human text', false)
        await until("button('Retry save')&&!button('Retry save').hidden")
        const unsaved = run<boolean>(
          "return view().contentEl.textContent.includes('not saved')&&view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
        )
        const sourceSame = run<boolean>(
          `return ${JSON.stringify(before)}===await app.vault.read(app.vault.getAbstractFileByPath(path))`
        )
        shot('failed-save')
        await press('view().containerEl.querySelector(\'[aria-label="Open in Obsidian Canvas"]\')')
        await until("document.querySelector('.abele-canvas-choice')")
        shot('native-handoff')
        await press(textButton('.abele-canvas-choice', 'Retain draft and open native'))
        await until(
          "app.workspace.getLeavesOfType('canvas').some(leaf=>leaf.view.file?.path===path)"
        )
        const native = true
        restoreProcess()
        // Closing/reopening is navigation, not a canvas edit. Native unload may write formatting.
        run(
          "app.workspace.getLeavesOfType('canvas').find(leaf=>leaf.view.file?.path===path).detach();return true"
        )
        await reopen()
        const retained = run<boolean>(
          "return view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
        )
        const reopened = run<boolean>("return !button('Retry save').disabled")
        await click('Retry save', true)
        await new Promise((resolve) => setTimeout(resolve, 500))
        const written = run<boolean>(
          "return (await read()).nodes.some(node=>node.text==='Retained human text')"
        )
        shot('reopened-saved')
        expect({ unsaved, sourceSame, retained, native }).toEqual({
          unsaved: true,
          sourceSame: true,
          retained: true,
          native: true,
        })
        result = { unsaved, sourceSame, retained, native, reopened, saved: written }
      } catch (error) {
        // Expected failure belongs only to the known byte-revision assertion below.
        // A blocked native action or broken setup must fail normally, not hide under it.fails.
        task.fails = false
        throw error
      } finally {
        run(
          'if(window.__humanCanvas?.process){app.vault.process=window.__humanCanvas.process;delete window.__humanCanvas.process}return true'
        )
      }
      expect(result).toEqual({
        unsaved: true,
        sourceSame: true,
        retained: true,
        native: true,
        reopened: true,
        saved: true,
      })
    },
    120_000
  )

  it('honestly blocks a changed-source draft after native handoff and discards only local pending work', async () => {
    const before = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    const retained = run<boolean>(
      "return view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
    )
    // The preceding retry settles asynchronously (slower on a phone): witness its outcome
    // before reading it, and still report the state reached when it never comes.
    await until(
      "button('Retry save')?.disabled&&view().contentEl.textContent.includes('source changed')"
    ).catch(() => undefined)
    const blocked = run<boolean>(
      "return button('Retry save').disabled&&view().contentEl.textContent.includes('source changed')"
    )
    await click('Discard local draft')
    await press(textButton('.abele-canvas-choice', 'Discard local draft'))
    await saved()
    const sourceSame = run<boolean>(
      `return ${JSON.stringify(before)}===await app.vault.read(app.vault.getAbstractFileByPath(path))`
    )
    const discarded = run<boolean>(
      "return !view().viewer.graph.nodes.some(node=>node.text==='Retained human text')"
    )
    expect({ retained, blocked, sourceSame, discarded }).toEqual({
      retained: true,
      blocked: true,
      sourceSame: true,
      discarded: true,
    })
  }, 120_000)

  it('keeps inserted attachments usable after native rename and folder move, including pointer-driven undo', async () => {
    run(`
      await app.vault.createFolder(${JSON.stringify(DIR + '/sample-assets')})
      for(const name of ['sample-image.svg','sample-drawing.svg'])await app.vault.create(${JSON.stringify(DIR + '/sample-assets/')}+name,'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0 0L40 40"/></svg>')
      // Discard the preceding retained failure via its normal user action before this scenario.
      return true
    `)
    // The preceding native-handoff test deliberately leaves a conflicted draft.
    if (run<boolean>('return view().documentLease.document.session.dirty')) {
      await click('Discard local draft')
      await press(textButton('.abele-canvas-choice', 'Discard local draft'))
      await saved()
    }
    for (const name of ['sample-image.svg', 'sample-drawing.svg']) {
      await click('Add note or attachment')
      await press('document.querySelector(".prompt-input")')
      await type(name)
      await press(
        `[...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes(${JSON.stringify(DIR + '/sample-assets/')}+${JSON.stringify(name)}))`
      )
      await saved()
    }
    // Opening the host rename dialog is navigation; its text and Save use real input.
    run(
      `app.fileManager.promptForFileRename(app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/sample-assets/sample-image.svg')}));return true`
    )
    await until('document.activeElement?.matches(".rename-textarea")')
    await type('sample-renamed')
    await press('document.querySelector(".mod-file-rename button.mod-cta")')
    await until(
      `!document.querySelector('.mod-file-rename') && !!app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/sample-assets/sample-renamed.svg')})`
    )
    await until(
      `view().viewer.graph.nodes.some(n=>n.file===${JSON.stringify(DIR + '/sample-assets/sample-renamed.svg')})`
    )
    // Host event stimulus, shared by desktop and physical-phone checks.
    run(
      `await app.fileManager.renameFile(app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/sample-assets')}),${JSON.stringify(DIR + '/sample-moved')});return true`
    )
    await until(
      `view().viewer.graph.nodes.some(n=>n.file===${JSON.stringify(DIR + '/sample-moved/sample-drawing.svg')})`
    )
    await click('Fit diagram')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(n=>n.file?.endsWith('/sample-drawing.svg')).id+'"]')`
    )
    await click('Delete selected card')
    await saved()
    await click('Undo canvas change')
    await saved()
    const result = run<{ image: boolean; drawing: boolean; stale: boolean }>(
      `const data=await read();return {image:data.nodes.some(n=>n.file===${JSON.stringify(DIR + '/sample-moved/sample-renamed.svg')}),drawing:data.nodes.some(n=>n.file===${JSON.stringify(DIR + '/sample-moved/sample-drawing.svg')}),stale:data.nodes.some(n=>n.file?.includes('/sample-assets/'))}`
    )
    shot('renamed-attachments')
    expect(result).toEqual({ image: true, drawing: true, stale: false })
    await press(
      `view().contentEl.querySelector('[data-card-id="'+view().viewer.graph.nodes.find(n=>n.file?.endsWith('/sample-drawing.svg')).id+'"]')`
    )
    await click('Open selected card')
    await until(
      `app.workspace.getActiveFile()?.path===${JSON.stringify(DIR + '/sample-moved/sample-drawing.svg')}`
    )
    await reopen()
  }, 120_000)
})
