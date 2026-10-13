import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleDocx, sampleBody, paragraph } from '../fixtures/docx/sampleDocx'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { measureWordControls } from '../helpers/wordControlsLayout'

targets('desktop')
const PATH = 'sample-word-controls-e2e.docx'
const picture = sampleBody.slice(sampleBody.indexOf('<w:p><w:r><w:drawing>'))
const bytes = Buffer.from(
  sampleDocx(
    paragraph('Sample plain paragraph') +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>' +
      paragraph('Sample table cell') +
      '</w:tc></w:tr></w:tbl>' +
      picture
  )
).toString('base64')
const SHOTS = '/tmp/abele-word-controls'
const available = isObsidianRunning() && hasTestApi()
const subjects = [
  [1, 'paragraph', 'Paragraph 1'],
  [2, 'table', 'Table'],
  [3, 'picture', 'Picture'],
] as const

describe.skipIf(!available)('Word controls dialog captures', () => {
  let size: [number, number] = [0, 0]
  let sidebars: [boolean, boolean] = [true, true]
  let ownsFile = false
  beforeAll(() => {
    size = evalJson("require('@electron/remote').getCurrentWindow().getContentSize()")
    sidebars = evalJson('[app.workspace.leftSplit.collapsed,app.workspace.rightSplit.collapsed]')
    evalRaw('app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()')
    evalAsync(`(async () => {
      if(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})) throw Error('Synthetic capture path already exists')
      const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(PATH)},bytes.buffer)
      return true
    })()`)
    ownsFile = true
  })
  afterAll(async () => {
    if (ownsFile)
      evalAsync(`(async () => {
      for(const leaf of app.workspace.getLeavesOfType('abele-word')) if(leaf.view.file?.path===${JSON.stringify(PATH)}) leaf.detach()
      const file=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(file) await app.vault.delete(file)
      return true
    })()`)
    await reloadApp('app.emulateMobile(false)')
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`)
    evalRaw(
      `if(!${sidebars[0]}) app.workspace.leftSplit.expand();if(!${sidebars[1]}) app.workspace.rightSplit.expand()`
    )
  })

  const capture = (number: number, subject: string, title: string, mobile: boolean) =>
    evalAsync<{
      title: string
      shot: string
      clipped: boolean
      readOnly: boolean
      mobile: boolean
      layout: ReturnType<typeof measureWordControls>
    }>(`(async () => {
      const leaf=app.workspace.getLeaf('tab')
      try {
        await leaf.setViewState({type:'abele-word',state:{file:${JSON.stringify(PATH)}},active:true});await app.workspace.revealLeaf(leaf)
        await leaf.view.advanced(${number})
        let editor
        for(let i=0;i<150;i++) {editor=document.querySelector(${JSON.stringify(mobile ? '.abele-word-read-only .abele-word-line' : '.abele-word-editor')});if(editor) break;await new Promise(resolve=>setTimeout(resolve,100))}
        if(!editor) throw Error('Word controls did not open')
        if(${mobile}) editor=editor.closest('.abele-word-read-only')
        const modal=editor.closest('.modal')
        // Match phoneLayout's settled-sheet capture; background windows need no animation frames.
        for(const el of [modal,modal.closest('.modal-container')]) if(el) el.style.transition='none'
        await new Promise(resolve=>setTimeout(resolve,400))
        const bounds=modal.getBoundingClientRect()
        const layout=(${measureWordControls.toString()})(modal,modal.querySelector('.abele-modal__body'),editor)
        const clipped=layout.clipped || (!${mobile} && (bounds.left<0||bounds.top<0||bounds.right>innerWidth+1||bounds.bottom>innerHeight+1))
        const controls=[...editor.querySelectorAll('input,select,textarea,button')]
        const readOnly=${mobile} ? controls.length===0 && !modal.querySelector('.abele-word-editor') : controls.filter(el=>el.textContent!=='Cancel').every(el=>el.disabled)
        const title=modal.querySelector('.modal-title')?.textContent
        if(title!==${JSON.stringify(title)}) throw Error('Unexpected Word controls title: '+title)
        const shot=${JSON.stringify(SHOTS)}+'/word-controls-'+${JSON.stringify(subject)}+'-'+${JSON.stringify(mobile ? 'phone' : 'desktop')}+'.png'
        if(window.__e2eHost) await window.__e2eHost.shot(shot)
        else {const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(shot,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
        if(${mobile}) modal.querySelector('.modal-close-button,.modal-header-button').click()
        else [...editor.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click()
        return {title,shot,clipped,readOnly,mobile:app.isMobile,layout}
      } finally {leaf.detach()}
    })()`)

  it('captures a table cell, picture and plain paragraph on desktop', () => {
    for (const [number, subject, title] of subjects) {
      const result = capture(number, subject, title, false)
      console.info(`${subject} desktop bounds: ${JSON.stringify(result.layout)}`)
      expect(result.title).toBe(title)
      expect(result.clipped, JSON.stringify(result.layout)).toBe(false)
      expect(result.mobile).toBe(false)
      console.info(result.shot)
    }
  })
  it('captures the same dialogs read only with emulateMobile at 390 by 844', async () => {
    await reloadApp('app.emulateMobile(true)')
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390,844)")
    for (const [number, subject, title] of subjects) {
      const result = capture(number, subject, title, true)
      console.info(`${subject} phone bounds: ${JSON.stringify(result.layout)}`)
      expect(result.title).toBe(title)
      expect(result.clipped, JSON.stringify(result.layout)).toBe(false)
      expect(result.readOnly).toBe(true)
      expect(result.mobile).toBe(true)
      console.info(result.shot)
    }
  })
})
