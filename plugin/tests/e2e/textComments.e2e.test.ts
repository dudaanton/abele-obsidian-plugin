import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const PATH = 'Text comment sample.md'
const SHOTS = shotDir('abele-phone')
const run = <T>(body: string): T => {
  const result = evalRaw(
    `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for(let i=0;i<80;i++) { if(fn()) return true; await wait(100) } return false }
  const button = text => [...(document.querySelectorAll('.modal').length ? [...document.querySelectorAll('.modal')].at(-1).querySelectorAll('button') : [])].find(el => el.textContent.trim() === text)
  const note = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
  const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === note?.path)?.view
  ${body}
})()`,
    90_000
  )
  if (result.startsWith('Error:')) throw new Error(result)
  return JSON.parse(result)
}

describe.skipIf(!available)('ordinary-note text comments', () => {
  afterEach(() =>
    expect(
      run<boolean>(`
    for(let i=0;i<6 && document.querySelector('.abele-text-comments');i++) {
      const top=[...document.querySelectorAll('.modal')].at(-1)
      const buttons=[...top.querySelectorAll('button')]
      const close=buttons.find(el=>el.textContent.trim()==='Discard') ?? buttons.find(el=>el.textContent.trim()==='Close') ?? buttons.find(el=>el.textContent.trim()==='Cancel')
      close?.click(); await wait(150)
    }
    return JSON.stringify(!document.querySelector('.abele-text-comments'))
  `)
    ).toBe(true)
  )
  beforeAll(() =>
    run(`
    if (!note) await app.vault.create(${JSON.stringify(PATH)}, 'A **sample passage** and another sentence.')
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
    await app.workspace.getLeaf('tab').openFile(file)
    window.__textCommentAi = window.__abeleTest.AbeleConfig.getInstance().ai.enabled
    window.__abeleTest.AbeleConfig.getInstance().ai.enabled = false
    return JSON.stringify(true)
  `)
  )
  afterAll(() =>
    run(`
    window.__abeleTest.AbeleConfig.getInstance().ai.enabled = window.__textCommentAi
    delete window.__textCommentAi
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
      await until(() => button('Save') && !button('Save').disabled)
      button('Save')?.click()
      await until(() => document.querySelector('.abele-text-comments__entry'))
      const source = await app.vault.read(note)
      const id = /%%c:([a-z0-9]{6})/.exec(source)?.[1]
      const file = id && app.vault.getAbstractFileByPath(window.__abeleTest.ChatStorage.commentsFolder() + '/' + id + '.abcomment')
      const thread = file ? JSON.parse(await app.vault.read(file)) : null
      button('Close')?.click(); await until(() => !document.querySelector('.abele-text-comments'))
      await until(() => view.contentEl.querySelector('[data-comment-kind="human"]'))
      view.contentEl.querySelector('[data-comment-kind="human"]')?.click()
      const reopened = await until(() => document.querySelector('.abele-text-comments__entry'))
      button('Close')?.click()
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
    expect(
      run<{ closed: boolean; visible: boolean }>(`
      window.__abeleTest.openDialog('text-comment-edit')
      await until(() => document.querySelector('.abele-text-comments .cm-content'))
      const field = document.querySelector('.abele-text-comments .cm-content')
      await wait(400)
      const line = field?.querySelector('.cm-line')?.getBoundingClientRect()
      const visible = !!line && line.top >= 0 && line.top < (window.visualViewport?.height ?? window.innerHeight)
      field?.focus()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      return JSON.stringify({closed:await until(() => !document.querySelector('.abele-text-comments')),visible})
    `)
    ).toEqual({ closed: true, visible: true })
  })
  // BUG: native toolbar taps have not delivered a click in device validation. Keep every
  // assertion: passing layout/storage checks is not formatting or native-edit acceptance.
  it.skipIf(!onPhone()).fails(
    'BUG: native keyboard toolbar formatting and edit-save touch workflow is not yet accepted',
    () => {
      const result = run<{
        keyboard: boolean
        room: number
        geometry: unknown
        toolbar: boolean
        saved: boolean
        formatted: boolean
        formatText: string
        toolbarClick: boolean
        toolbarContext: unknown
        sourceUnchanged: boolean
        edited: boolean
        shots: string[]
      }>(`
      await view.setState({ mode: 'source' }, {})
      app.workspace.setActiveLeaf(view.leaf, { focus: true })
      view.editor.setSelection(view.editor.offsetToPos(2), view.editor.offsetToPos(20))
      app.commands.executeCommandById('abele:add-text-comment')
      await until(() => document.querySelector('.abele-text-comments'))
      const host = window.__e2eHost
      const tap = async el => {
        const target = el.matches('.cm-content') ? el.querySelector('.cm-line') ?? el : el
        target.scrollIntoView({block:'center'})
        let r=target.getBoundingClientRect()
        for(let i=0;i<30;i++) { await wait(150); const next=target.getBoundingClientRect(); const stable=next.top===r.top&&next.left===r.left; r=next; if(stable) break }
        const x=r.left+r.width/2,y=r.top+r.height/2,under=document.elementFromPoint(x,y)
        if(under!==el&&!el.contains(under)) throw new Error('Comment action covered by '+(under?.className??'nothing'))
        await host.tap(x,y)
      }
      const keyboardHeight = () => Math.max(parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height'))||0,window.innerHeight-(window.visualViewport?.height??window.innerHeight))
      const field = document.querySelector('.abele-text-comments .cm-content')
      field.blur(); await wait(200)
      await tap(field)
      await until(() => keyboardHeight() > 100)
      const keyboard = keyboardHeight() > 100
      await wait(500)
      const body = document.querySelector('.abele-text-comments').closest('.abele-modal__body')
      const room = body.clientHeight
      const panel = body.closest('.modal')
      const geometry = [panel.parentElement, panel, panel.querySelector('.modal-content'), body, panel.querySelector('.abele-modal__footer')].map(el => { const s=getComputedStyle(el); return {class:el.className,height:el.getBoundingClientRect().height,top:el.getBoundingClientRect().top,cssHeight:s.height,max:s.maxHeight,flex:s.flex,keyboard:s.getPropertyValue('--keyboard-height'),room:s.getPropertyValue('--abele-room-height')} })
      const toolbar = !![...document.querySelectorAll('.mobile-toolbar')].find(el => el.getBoundingClientRect().height > 0)
      const shots = [await host.shot(${JSON.stringify(SHOTS)} + '/text-comment-keyboard-open.png')]
      await host.type('Native second comment\\nwith another line')
      shots.push(await host.shot(${JSON.stringify(SHOTS)} + '/text-comment-keyboard.png'))
      const cm = window.__abeleTest.noteFieldView(document.querySelector('.abele-text-comments .abele-note-editor-field__editor'))
      cm.focus()
      cm.dispatch({selection:{anchor:0,head:6}})
      const sourceBeforeToolbar = view.editor.getValue()
      const glyph = document.querySelector('.mobile-toolbar .lucide-bold')
      const bold = glyph.closest('.mobile-toolbar-option, .mobile-toolbar-item, .clickable-icon, button') ?? glyph.parentElement
      let toolbarClick = false
      bold.addEventListener('click', () => { toolbarClick = true }, {once:true,capture:true})
      const toolbarContext = { control: bold.className, inert: bold.closest('[inert]')?.className ?? '', owner: app.workspace.activeEditor?.editor?.cm === cm, focused: document.activeElement === cm.contentDOM }
      await tap(bold)
      await until(() => cm.state.doc.toString().startsWith('**Native**'))
      const formatText = cm.state.doc.toString()
      const formatted = formatText.startsWith('**Native**')
      const sourceUnchanged = view.editor.getValue() === sourceBeforeToolbar
      await host.swipe(window.innerWidth/2, window.innerHeight-keyboardHeight()-100, window.innerWidth/2, 160)
      await tap(button('Save'))
      await until(() => document.querySelectorAll('.abele-text-comments__entry').length === 2)
      const saved = document.querySelectorAll('.abele-text-comments__entry').length === 2
      shots.push(await host.shot(${JSON.stringify(SHOTS)} + '/text-comment-saved.png'))
      const edit = [...document.querySelectorAll('.abele-text-comments button')].find(el => el.textContent.trim() === 'Edit')
      await tap(edit); await wait(400)
      const editor = window.__abeleTest.noteFieldView(document.querySelector('.abele-text-comments .abele-note-editor-field__editor'))
      editor.dispatch({ selection: { anchor: editor.state.doc.length } })
      if(document.activeElement !== editor.contentDOM) throw new Error('Edit did not focus the comment editor')
      await host.type(' Updated')
      await tap(button('Save'))
      await until(() => document.querySelector('.abele-text-comments__time')?.textContent.includes('Edited'))
      const id = /%%c:([a-z0-9]{6})/.exec(await app.vault.read(note))[1]
      const savedFile = app.vault.getAbstractFileByPath(window.__abeleTest.ChatStorage.commentsFolder()+'/'+id+'.abcomment')
      const editedThread = JSON.parse(await app.vault.read(savedFile))
      const edited = !!editedThread.entries[0].editedAt && editedThread.entries[0].body.endsWith(' Updated')
      await tap(button('Close'))
      return JSON.stringify({keyboard, room, geometry, toolbar, formatted, formatText, toolbarClick, toolbarContext, sourceUnchanged, saved, edited, shots})
    `)
      console.log('Native comment editor:', result)
      expect(result.keyboard).toBe(true)
      expect(result.room).toBeGreaterThan(150)
      expect(result.toolbar).toBe(true)
      expect(result.sourceUnchanged).toBe(true)
      expect(result.toolbarClick).toBe(true)
      expect(result.formatted).toBe(true)
      expect(result.saved).toBe(true)
      expect(result.edited).toBe(true)
      expect(result.shots.every((path) => !path.startsWith('no picture'))).toBe(true)
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
      button('Close')?.click()
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
      const save = async () => { await until(() => button('Save') && !button('Save').disabled); button('Save').click(); await wait(300) }
      field().dispatch({changes:{from:0,insert:'Another entry'}}); await save()
      const stacked = JSON.parse(await app.vault.read(file)).entries.length === original.entries.length + 1
      button('Edit').click(); await wait(200)
      const cm = field(); cm.dispatch({changes:{from:0,to:cm.state.doc.length,insert:'Edited entry'}}); await save()
      const select = document.querySelector('.abele-text-comments select'); select.value='underline'; select.dispatchEvent(new Event('change',{bubbles:true})); await save()
      const edited = JSON.parse(await app.vault.read(file))
      const createdStable = edited.entries[0].createdAt === original.entries[0].createdAt && !!edited.entries[0].editedAt
      const appearance = edited.appearance
      button('Delete').click(); await wait(100); button('Delete').click(); await wait(300)
      const sibling = JSON.parse(await app.vault.read(file)).entries.length === original.entries.length
      for(let i=0;i<original.entries.length;i++) { button('Delete').click(); await wait(100); button('Delete').click(); await wait(300) }
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
