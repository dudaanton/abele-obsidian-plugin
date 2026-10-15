import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { visibleToolbarTarget, findToolbarScroller } from '../helpers/visibleToolbarTarget'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const PATH = 'Text comment sample.md'
const SHOTS = shotDir('abele-phone')
const NATIVE_TOUCH = `
  const host = window.__e2eHost
  const tap = async el => {
    const target = el.matches('.cm-content') ? el.querySelector('.cm-line') ?? el : el
    if(!target.closest('.abele-modal__footer')) target.scrollIntoView({block:'center'})
    let r=target.getBoundingClientRect(), settled=0
    for(let i=0;i<30;i++) { await wait(150); const next=target.getBoundingClientRect(); const stable=next.top===r.top&&next.left===r.left; r=next; settled=stable?settled+1:0; if(settled>=4) break }
    const x=r.left+r.width/2,y=r.top+r.height/2,under=document.elementFromPoint(x,y)
    if(under!==el&&!el.contains(under)) throw new Error('Comment action covered by '+(under?.className??'nothing')+': '+JSON.stringify({target:target.className,rect:r.toJSON(),viewport:[innerWidth,innerHeight,window.visualViewport?.height],keyboard:keyboardHeight(),under:under?.getBoundingClientRect().toJSON(),row:[...(target.closest('.abele-text-comments__reply')?.children??[])].map(n=>n.className+':'+Math.round(n.getBoundingClientRect().width)),editing:!!document.querySelector('.abele-text-comments__entry.is-editing'),entries:document.querySelectorAll('.abele-text-comments__entry').length,chain:(()=>{const out=[];for(let n=target;n&&!n.matches('.modal');n=n.parentElement)out.push(n.className.split(' ')[0]+':'+Math.round(n.getBoundingClientRect().width)+'/'+getComputedStyle(n).display);return out})()}))
    await host.tap(x,y)
  }
  const keyboardHeight = () => Math.max(parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height'))||0,window.innerHeight-(window.visualViewport?.height??window.innerHeight))
  const tapToolbar = async selector => {
    const toolbar = document.querySelector('.mobile-toolbar')
    const glyph = toolbar?.querySelector(selector)
    if(!glyph) throw new Error('Native formatting action is missing: '+selector)
    const control = glyph.closest('.mobile-toolbar-option,.mobile-toolbar-item,.clickable-icon,button') ?? glyph.parentElement
    const scroller = (${findToolbarScroller.toString()})(control,toolbar)
    for(let attempt=0;attempt<10;attempt++) {
      await wait(250)
      const bar=toolbar.getBoundingClientRect(), clip=scroller.getBoundingClientRect(), item=control.getBoundingClientRect()
      const bounds={left:Math.max(bar.left,clip.left),right:Math.min(bar.right,clip.right),top:Math.max(bar.top,clip.top),bottom:Math.min(bar.bottom,clip.bottom)}
      const viewport=window.visualViewport
      const screen={left:viewport?.offsetLeft??0,top:viewport?.offsetTop??0,right:(viewport?.offsetLeft??0)+(viewport?.width??innerWidth),bottom:(viewport?.offsetTop??0)+(viewport?.height??innerHeight)}
      const target=(${visibleToolbarTarget.toString()})(item,bounds,screen)
      if('unavailable' in target) throw new Error('Native formatting toolbar is outside the viewport')
      if('scroll' in target) {
        // Scroll only the native options viewport. scrollIntoView on a toolbar item also
        // scrolls the note/dialog vertically and invalidates the subsequent touch coordinates.
        const delta=target.scroll==='left'?item.right-Math.min(bounds.right,screen.right)+8:item.left-Math.max(bounds.left,screen.left)-8
        scroller.scrollBy({left:delta,behavior:'smooth'})
        // The smooth scroll has started and then held still for three frames (former 400 ms bound).
        const from=scroller.scrollLeft, end=Date.now()+400
        let left=from, still=0
        while(Date.now()<end && !(left!==from && still>=3)) { await new Promise(r=>requestAnimationFrame(r)); still=scroller.scrollLeft===left?still+1:0; left=scroller.scrollLeft }
        continue
      }
      const under=document.elementFromPoint(target.point.x,target.point.y)
      if(under!==control&&!control.contains(under)) throw new Error('Native formatting action is covered')
      await host.tap(target.point.x,target.point.y)
      return control
    }
    await host.shot(${JSON.stringify(SHOTS)}+'/text-comment-toolbar-scroll.png')
    const r=control.getBoundingClientRect(), s=scroller.getBoundingClientRect()
    throw new Error('Native formatting action could not be reached: '+JSON.stringify({selector,item:[r.left,r.right,r.top,r.bottom],scroller:scroller.className,bounds:[s.left,s.right,s.top,s.bottom],offset:scroller.scrollLeft,width:scroller.scrollWidth,client:scroller.clientWidth}))
  }
`
let nativeToolbar:
  | {
      clicked: boolean
      formatted: boolean
      italic: boolean
      selectionKept: boolean
      keyboard: boolean
      sourceUnchanged: boolean
    }
  | undefined
const run = <T>(body: string): T => {
  const result = evalRaw(
    `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for(let i=0;i<80;i++) { if(fn()) return true; await wait(100) } return false }
  // Until measure() holds still for three frames with no finite animation running, at most ms.
  const still = async (measure, ms) => {
    const end = Date.now() + ms
    let last, steady = 0
    while (Date.now() < end && steady < 3) {
      await new Promise(r => requestAnimationFrame(r))
      const now = JSON.stringify(measure())
      const moving = document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity)
      steady = !moving && now === last ? steady + 1 : 0
      last = now
    }
  }
  const button = text => [...([...document.querySelectorAll('.modal')].at(-1) ?? document.querySelector('.abele-anchored-card'))?.querySelectorAll('button') ?? []].find(el => el.textContent.trim() === text)
  const send = () => document.querySelector('.abele-text-comments [aria-label="Send (⌘↵)"]')
  const ownedModals = () => [...document.querySelectorAll('.modal-container')].filter(el => !window.__textCommentBaselineModals.has(el))
  // Obsidian 1.14 draws a dialog's close control as a raised header button.
  const dismiss = () => {
    const panel = document.querySelector('.abele-text-comments')
    const close = panel?.closest('.modal')?.querySelector('.modal-close-button, .modal-header-button.mod-raised')
    if (close) close.click()
    else if (panel?.closest('.abele-anchored-card')) document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}))
  }
  const note = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
  const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === note?.path)?.view
  ${body}
})()`,
    90_000
  )
  if (result.startsWith('Error:')) throw new Error(result)
  return JSON.parse(result)
}

// Closes the comment panel and every dialog this file opened, discarding a draft on the way.
const CLOSE_PANELS = `
    const attempts = []
    for(let i=0;i<6 && document.querySelector('.abele-text-comments');i++) {
      const panel = document.querySelector('.abele-text-comments')
      const seen = panel.__cleanupSeen; panel.__cleanupSeen = true
      const discard = button('Discard')
      attempts.push({ discard: !!discard, close: !!panel.closest('.modal')?.querySelector('.modal-close-button, .modal-header-button.mod-raised'), card: !!panel.closest('.abele-anchored-card'), seen: !!seen })
      if (discard) discard.click(); else dismiss()
      // Closed, or a fresh Discard asked for, within the former 150 ms.
      for(let t=0;t<15 && document.querySelector('.abele-text-comments') && (!button('Discard') || button('Discard') === discard);t++) await wait(10)
    }
    await until(() => !document.querySelector('.abele-text-comments') && !ownedModals().length)
`

describe.skipIf(!available)('ordinary-note text comments', () => {
  afterEach(() =>
    expect(
      run<boolean>(`${CLOSE_PANELS}
    // Name whatever is still open, so a leftover dialog explains itself.
    const panel = document.querySelector('.abele-text-comments')?.closest('.abele-anchored-card,.modal')?.className ?? null
    return JSON.stringify({ panel, owned: ownedModals().map(el => el.className + ': ' + el.textContent.trim().slice(0, 120)), attempts: panel ? attempts : [] })
  `)
    ).toEqual({ panel: null, owned: [], attempts: [] })
  )
  beforeEach(() =>
    expect(
      run<unknown>(
        `await until(() => !document.querySelector('.abele-text-comments') && !ownedModals().length)
        return JSON.stringify({ panel: document.querySelector('.abele-text-comments')?.closest('.abele-anchored-card,.modal')?.className ?? null,
          owned: ownedModals().map(el => el.className + ': ' + el.textContent.trim().slice(0, 120)) })`
      )
    ).toEqual({ panel: null, owned: [] })
  )
  beforeAll(() =>
    run(`
    if (note) throw Error('Synthetic note already exists')
    window.__textCommentBaselineModals = new Set(document.querySelectorAll('.modal-container'))
    await app.vault.create(${JSON.stringify(PATH)}, 'A **sample passage** and another sentence.')
    window.__textCommentOwned = true
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
    await app.workspace.getLeaf('tab').openFile(file)
    window.__textCommentAi = window.__abeleTest.AbeleConfig.getInstance().ai.enabled
    window.__abeleTest.AbeleConfig.getInstance().ai.enabled = false
    return JSON.stringify(true)
  `)
  )
  afterAll(() =>
    run(`
    if (!window.__textCommentOwned) return JSON.stringify(true)
    // A case whose own cleanup failed must not leave its dialog over the next file.
    if (window.__textCommentBaselineModals) {
      ${CLOSE_PANELS}
      for (const modal of ownedModals()) modal.querySelector('.modal-close-button, .modal-header-button.mod-raised')?.click()
      await until(() => !ownedModals().length)
    }
    window.__abeleTest.AbeleConfig.getInstance().ai.enabled = window.__textCommentAi
    delete window.__textCommentAi
    delete window.__textCommentOwned
    delete window.__textCommentBaselineModals
    for(const leaf of app.workspace.getLeavesOfType('markdown')) if(leaf.view.file?.path === note?.path) leaf.detach()
    if(note) {
      const source = await app.vault.read(note)
      for(const match of source.matchAll(/%%c:([a-z0-9,]+)%%/g)) for(const id of match[1].split(',')) {
        const folder = window.__abeleTest.ChatStorage.commentsFolder()
        const file = app.vault.getAbstractFileByPath(folder + '/' + id + '.abcomment')
        if(file) await app.vault.delete(file)
      }
      await app.vault.delete(note)
    }
    return JSON.stringify(true)
  `)
  )
  it('selection → Add comment → rich save → reopen works with AI disabled', () => {
    const result = run<{
      opened: boolean
      rich: boolean
      entries: number
      body: string
      ai: number
      reopened: boolean
    }>(`
      await view.setState({ mode: 'source' }, {})
      app.workspace.setActiveLeaf(view.leaf, { focus: true })
      view.editor.setSelection(view.editor.offsetToPos(2), view.editor.offsetToPos(20))
      const chats = app.vault.getFiles().filter(file => file.extension === 'abchat').length
      app.commands.executeCommandById('abele:add-text-comment')
      const opened = await until(() => document.querySelector('.abele-text-comments'))
      if(!opened) return JSON.stringify({ opened, rich:false, entries:0, body:'', ai:0, reopened:false })
      const host = document.querySelector('.abele-text-comments .abele-note-editor-field__editor')
      const cm = window.__abeleTest.noteFieldView(host)
      if(cm) cm.dispatch({ changes: { from: 0, insert: '**First comment**\\nSecond line' } })
      await until(() => send() && !send().disabled)
      send()?.click()
      await until(() => document.querySelector('.abele-text-comments__entry'))
      const source = await app.vault.read(note)
      const id = /%%c:([a-z0-9]{6})/.exec(source)?.[1]
      const file = id && app.vault.getAbstractFileByPath(window.__abeleTest.ChatStorage.commentsFolder() + '/' + id + '.abcomment')
      const thread = file ? JSON.parse(await app.vault.read(file)) : null
      dismiss(); await until(() => !document.querySelector('.abele-text-comments'))
      await until(() => view.contentEl.querySelector('[data-comment-kind="human"]'))
      view.contentEl.querySelector('[data-comment-kind="human"]')?.click()
      const reopened = await until(() => document.querySelector('.abele-text-comments__entry'))
      dismiss()
      return JSON.stringify({ opened, rich: !!cm, entries: thread?.entries.length ?? 0, body: thread?.entries[0].body ?? '', ai: app.vault.getFiles().filter(file => file.extension === 'abchat').length - chats, reopened })
    `)
    expect(result).toEqual({
      opened: true,
      rich: true,
      entries: 1,
      body: '**First comment**\nSecond line',
      ai: 0,
      reopened: true,
    })
  })
  it('dismisses a pristine edit with Escape while the embedded editor owns focus', () => {
    // A comment is changed where it stands: Escape there gives the comment back unchanged and
    // keeps the thread open; Escape in the reply field then closes the thread.
    expect(
      run<{
        edited: boolean
        visible: boolean
        dismissed: boolean
        unchanged: boolean
        closed: boolean
      }>(`
      const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      window.__abeleTest.openDialog('text-comment-edit')
      const edited = await until(() => document.querySelector('.abele-text-comments__entry.is-editing .cm-content'))
      const field = document.querySelector('.abele-text-comments__entry.is-editing .cm-content')
      await still(() => field?.querySelector('.cm-line')?.getBoundingClientRect().top, 400)
      const line = field?.querySelector('.cm-line')?.getBoundingClientRect()
      const visible = !!line && line.top >= 0 && line.top < (window.visualViewport?.height ?? window.innerHeight)
      field?.focus()
      escape()
      const dismissed = await until(() => document.querySelector('.abele-text-comments') && !document.querySelector('.abele-text-comments__entry.is-editing'))
      const unchanged = !!document.querySelector('.abele-text-comments__entry[data-entry-id="000001"]')?.textContent.includes('rain gauge')
      const reply = document.querySelector('.abele-text-comments .cm-content')
      reply?.focus()
      escape()
      return JSON.stringify({edited, visible, dismissed, unchanged, closed:await until(() => !document.querySelector('.abele-text-comments'))})
    `)
    ).toEqual({ edited: true, visible: true, dismissed: true, unchanged: true, closed: true })
  })
  it('draws one outline round the focused reply field, not one round the editor inside it too', () => {
    // The note editor inside the reply drops its own border, ring and ground; only the field's
    // frame shows. Every box from the field down that paints an edge is counted.
    const shotPath = `${SHOTS}/reply-field-${onPhone() ? 'phone' : 'desktop'}.png`
    const r = run<{ edges: string[]; focused: boolean; shot: boolean }>(`
      // The thread as it opens, no comment being changed, so nothing else takes the focus back.
      window.__abeleTest.openDialog('text-comment-list')
      await until(() => document.querySelector('.abele-text-comments__reply .cm-content'))
      const reply = document.querySelector('.abele-text-comments__reply')
      const field = reply.querySelector('.cm-content')
      // Under a long thread the field is at the end of the list: in sight for its picture.
      reply.scrollIntoView({ block: 'end' })
      field.focus()
      await still(() => reply.getBoundingClientRect().height, 600)
      const edges = []
      const paints = (s) =>
        ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none' && !/rgba\\(.*, 0\\)$|transparent/.test(s['border' + side + 'Color'])) ||
        (s.boxShadow && s.boxShadow !== 'none') ||
        (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
      for (const el of [reply, ...reply.querySelectorAll('*')]) {
        const box = el.getBoundingClientRect()
        // Only what frames the writing: the boxes as wide as the field, not its buttons or words.
        if (box.width < reply.getBoundingClientRect().width * 0.6 || box.height < 16) continue
        if (paints(getComputedStyle(el))) edges.push(el.className.split(' ')[0] || el.tagName)
      }
      const focused = reply.contains(document.activeElement)
      // The real phone has no Node in its page: its host takes the picture.
      let shot = false
      if (window.__e2eHost) shot = !(await window.__e2eHost.shot(${JSON.stringify(shotPath)})).startsWith('no picture')
      else {
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(shotPath)}, image.toPNG())
        shot = !image.isEmpty()
      }
      // Give the focus back, so the next case starts with no field and no keyboard up.
      document.activeElement?.blur?.()
      return JSON.stringify({ edges, focused, shot })
    `)
    expect(r.focused).toBe(true)
    expect(r.edges).toHaveLength(1)
    expect(r.shot).toBe(true)
  })
  it.skipIf(!onPhone())('native keyboard geometry, save and edit preserve the source note', () => {
    const result = run<{
      keyboard: boolean
      room: number
      geometry: unknown
      toolbar: boolean
      saved: boolean
      sourceUnchanged: boolean
      edited: boolean
      shots: string[]
    }>(`
      await view.setState({ mode: 'source' }, {})
      app.workspace.setActiveLeaf(view.leaf, { focus: true })
      view.editor.setSelection(view.editor.offsetToPos(2), view.editor.offsetToPos(20))
      app.commands.executeCommandById('abele:add-text-comment')
      await until(() => document.querySelector('.abele-text-comments'))
      ${NATIVE_TOUCH}
      const sourceBefore = view.editor.getValue()
      const field = document.querySelector('.abele-text-comments .cm-content')
      field.blur(); await wait(200)
      await tap(field)
      await until(() => keyboardHeight() > 100)
      const keyboard = keyboardHeight() > 100
      await still(() => [keyboardHeight(), document.querySelector('.abele-text-comments')?.closest('.abele-modal__body')?.getBoundingClientRect().toJSON()], 500)
      const body = document.querySelector('.abele-text-comments').closest('.abele-modal__body')
      const room = body.clientHeight
      const panel = body.closest('.modal')
      const geometry = [panel.parentElement, panel, panel.querySelector('.modal-content'), body, panel.querySelector('.abele-text-comments__reply')].map(el => { const s=getComputedStyle(el); return {class:el.className,height:el.getBoundingClientRect().height,top:el.getBoundingClientRect().top,cssHeight:s.height,max:s.maxHeight,flex:s.flex,keyboard:s.getPropertyValue('--keyboard-height'),room:s.getPropertyValue('--abele-room-height')} })
      const toolbar = !![...document.querySelectorAll('.mobile-toolbar')].find(el => el.getBoundingClientRect().height > 0)
      const shots = [await host.shot(${JSON.stringify(SHOTS)} + '/text-comment-keyboard-open.png')]
      await host.type('Native second comment\\nwith another line')
      shots.push(await host.shot(${JSON.stringify(SHOTS)} + '/text-comment-keyboard.png'))
      await host.swipe(window.innerWidth/2, window.innerHeight-keyboardHeight()-100, window.innerWidth/2, 160)
      await tap(send())
      await until(() => document.querySelectorAll('.abele-text-comments__entry').length === 2)
      const saved = document.querySelectorAll('.abele-text-comments__entry').length === 2
      shots.push(await host.shot(${JSON.stringify(SHOTS)} + '/text-comment-saved.png'))
      const edit = document.querySelector('.abele-text-comments [aria-label="Edit this comment"]')
      await tap(edit)
      if(!await until(() => keyboardHeight()>100)) throw new Error('Native edit keyboard did not open: '+JSON.stringify({editing:!!document.querySelector('.abele-text-comments__entry.is-editing'),active:document.activeElement?.className,editDisabled:edit?.getAttribute('aria-disabled')??edit?.disabled,keyboard:keyboardHeight()}))
      await still(() => [keyboardHeight(), document.querySelector('.abele-text-comments .abele-note-editor-field__editor')?.getBoundingClientRect().toJSON()], 500)
      const editor = window.__abeleTest.noteFieldView(document.querySelector('.abele-text-comments .abele-note-editor-field__editor'))
      editor.focus()
      editor.dispatch({ selection: { anchor: editor.state.doc.length } })
      for(let t=0;t<15 && document.activeElement !== editor.contentDOM;t++) await wait(10)
      if(document.activeElement !== editor.contentDOM) throw new Error('Edit did not focus the comment editor')
      await host.type(' Updated')
      if(!await until(() => editor.state.doc.toString().endsWith(' Updated'))) throw new Error('Native edit text did not arrive: '+JSON.stringify({edit:editor.state.doc.toString(),reply:window.__abeleTest.noteFieldView(document.querySelector('.abele-text-comments__reply .abele-note-editor-field__editor'))?.state.doc.toString(),active:document.activeElement?.closest('.abele-text-comments__reply,.abele-text-comments__entry')?.className??document.activeElement?.className}))
      await until(() => button('Save') && !button('Save').disabled)
      await tap(button('Save'))
      await until(() => document.querySelector('.abele-text-comments__time')?.textContent.includes('edited'))
      const id = /%%c:([a-z0-9]{6})/.exec(await app.vault.read(note))[1]
      const savedFile = app.vault.getAbstractFileByPath(window.__abeleTest.ChatStorage.commentsFolder()+'/'+id+'.abcomment')
      const editedThread = JSON.parse(await app.vault.read(savedFile))
      const edited = !!editedThread.entries[0].editedAt && editedThread.entries[0].body.endsWith(' Updated')
      dismiss(); await until(() => !document.querySelector('.abele-text-comments'))
      return JSON.stringify({keyboard, room, geometry, toolbar, sourceUnchanged:view.editor.getValue()===sourceBefore, saved, edited, shots})
    `)
    console.log('Native comment editor:', result)
    expect(result.keyboard).toBe(true)
    expect(result.room).toBeGreaterThan(150)
    expect(result.toolbar).toBe(true)
    expect(result.sourceUnchanged).toBe(true)
    expect(result.saved).toBe(true)
    expect(result.edited).toBe(true)
    expect(result.shots.every((path) => !path.startsWith('no picture'))).toBe(true)
  })
  it.skipIf(!onPhone())('native toolbar actions cannot change the underlying note', () => {
    nativeToolbar = run<{
      clicked: boolean
      formatted: boolean
      italic: boolean
      selectionKept: boolean
      keyboard: boolean
      sourceUnchanged: boolean
    }>(`
      ${NATIVE_TOUCH}
      await view.setState({mode:'source'}, {})
      app.workspace.setActiveLeaf(view.leaf, {focus:true})
      view.editor.setSelection(view.editor.offsetToPos(2), view.editor.offsetToPos(20))
      app.commands.executeCommandById('abele:add-text-comment')
      await until(() => document.querySelector('.abele-text-comments'))
      const cm = window.__abeleTest.noteFieldView(document.querySelector('.abele-text-comments .abele-note-editor-field__editor'))
      cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'Native toolbar probe'}})
      await tap(cm.contentDOM)
      await until(() => keyboardHeight()>100)
      await still(() => [keyboardHeight(), cm.dom.getBoundingClientRect().toJSON()], 500)
      cm.focus()
      cm.dispatch({selection:{anchor:0,head:6}})
      await wait(100)
      const sourceBefore = view.editor.getValue()
      let clicked = false
      const toolbar=document.querySelector('.mobile-toolbar')
      toolbar.addEventListener('click',()=>{clicked=true},{once:true,capture:true})
      await tapToolbar('.lucide-bold')
      await until(() => cm.state.doc.toString().startsWith('**Native**'))
      const formatted=cm.state.doc.toString().startsWith('**Native**')
      await host.shot(${JSON.stringify(SHOTS)}+'/text-comment-bold.png')
      await tapToolbar('.lucide-italic')
      await until(() => /^(?:\\*\\*\\*Native\\*\\*\\*|\\*\\*_Native_\\*\\*)/.test(cm.state.doc.toString()))
      const italic=/^(?:\\*\\*\\*Native\\*\\*\\*|\\*\\*_Native_\\*\\*)/.test(cm.state.doc.toString())
      const selected=cm.state.selection.main
      const selectionKept=cm.state.sliceDoc(selected.from,selected.to)==='Native'
      await host.shot(${JSON.stringify(SHOTS)}+'/text-comment-italic.png')
      return JSON.stringify({clicked,formatted,italic,selectionKept,keyboard:keyboardHeight()>100,sourceUnchanged:view.editor.getValue()===sourceBefore})
    `)
    expect(nativeToolbar.sourceUnchanged).toBe(true)
  })
  it.skipIf(!onPhone())(
    'native toolbar formats the selected comment text after horizontal scrolling',
    () => {
      expect(nativeToolbar?.clicked).toBe(true)
      expect(nativeToolbar?.formatted).toBe(true)
      expect(nativeToolbar?.italic).toBe(true)
      expect(nativeToolbar?.selectionKept).toBe(true)
      expect(nativeToolbar?.keyboard).toBe(true)
    }
  )
  it('reading mode paints formatted passages and reopens the same thread', () => {
    const result = run<{ icon: boolean; quote: string; reopened: boolean }>(`
      await view.setState({ mode: 'preview' }, {})
      await until(() => view.contentEl.querySelector('.markdown-preview-view [data-comment-kind="human"]'))
      const preview = view.contentEl.querySelector('.markdown-preview-view')
      const icon = preview?.querySelector('[data-comment-kind="human"]')
      const quote = [...(preview?.querySelectorAll('[data-abele-note-comment-quote]') ?? [])].map(el => el.textContent).join('')
      icon?.click(); const reopened = await until(() => document.querySelector('.abele-text-comments__entry'))
      dismiss()
      return JSON.stringify({ icon: !!icon, quote, reopened })
    `)
    expect(result.icon).toBe(true)
    expect(result.quote).toBe('sample passage')
    expect(result.reopened).toBe(true)
  })
  it('stacks, edits, changes appearance and confirms deletion without deleting selected prose', () => {
    const result = run<{
      stacked: boolean
      createdStable: boolean
      appearance: string
      sibling: boolean
      clean: string
      removed: boolean
    }>(`
      const preview = view.contentEl.querySelector('.markdown-preview-view')
      preview.querySelector('[data-comment-kind="human"]')?.click()
      await until(() => document.querySelector('.abele-text-comments'))
      const originalSource = await app.vault.read(note)
      const id = /%%c:([a-z0-9]{6})/.exec(originalSource)[1]
      const file = app.vault.getAbstractFileByPath(window.__abeleTest.ChatStorage.commentsFolder()+'/'+id+'.abcomment')
      const original = JSON.parse(await app.vault.read(file))
      const field = () => window.__abeleTest.noteFieldView(document.querySelector('.abele-text-comments .abele-note-editor-field__editor'))
      // A write has landed once the thread's file changed (or went), then the panel repaints.
      const written = async m => { await until(() => !app.vault.getAbstractFileByPath(file.path) || file.stat.mtime !== m); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))) }
      const save = async () => { const action = () => button('Save') ?? send(); await until(() => action() && !action().disabled); const m = file.stat.mtime; action().click(); await written(m); await until(() => !button('Save')) }
      field().dispatch({changes:{from:0,insert:'Another entry'}}); await save()
      const stacked = JSON.parse(await app.vault.read(file)).entries.length === original.entries.length + 1
      document.querySelector('.abele-text-comments [aria-label="Edit this comment"]').click(); await until(() => button('Save'))
      const cm = field(); cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'Edited entry'}}); await save()
      document.querySelector('.abele-text-comments__mark').click(); await until(() => document.querySelector('.abele-text-comments [role="radio"][aria-label="underlined"]'))
      const marked = file.stat.mtime
      document.querySelector('.abele-text-comments [role="radio"][aria-label="underlined"]').click(); await until(() => document.querySelector('.abele-text-comments__mark')?.getAttribute('aria-label')?.includes('underlined')); await written(marked)
      const edited = JSON.parse(await app.vault.read(file))
      const createdStable = edited.entries[0].createdAt === original.entries[0].createdAt && !!edited.entries[0].editedAt
      const appearance = edited.appearance
      document.querySelector('.abele-text-comments [aria-label="Delete this comment"]').click(); await until(() => button('Delete')); const deleted = file.stat.mtime; button('Delete').click(); await written(deleted); await until(() => !button('Delete'))
      const sibling = JSON.parse(await app.vault.read(file)).entries.length === original.entries.length
      for(let i=0;i<original.entries.length;i++) { document.querySelector('.abele-text-comments [aria-label="Delete this comment"]').click(); await until(() => button('Delete')); const m = file.stat.mtime; button('Delete').click(); await written(m); await until(() => !button('Delete')) }
      await until(() => !document.querySelector('.abele-text-comments'))
      return JSON.stringify({stacked,createdStable,appearance,sibling,clean:await app.vault.read(note),removed:!app.vault.getAbstractFileByPath(file.path)})
    `)
    expect(result).toEqual({
      stacked: true,
      createdStable: true,
      appearance: 'underline',
      sibling: true,
      clean: 'A **sample passage** and another sentence.',
      removed: true,
    })
  })
})
