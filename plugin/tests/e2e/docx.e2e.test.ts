import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleDocx, sampleParts, paragraph } from '../fixtures/docx/sampleDocx'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const PATH = 'sample-word-e2e.docx'
const bytes = Buffer.from(sampleDocx()).toString('base64')
const LARGE = 'sample-word-large-e2e.docx'
const largeBytes = Buffer.from(
  sampleDocx(
    Array.from({ length: 5000 }, (_, i) => paragraph(`Large sample paragraph ${i}`)).join('')
  )
).toString('base64')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-word')
const emptyParts = sampleParts(paragraph(''))
for (const name of [
  'word/header1.xml',
  'word/footer1.xml',
  'word/comments.xml',
  'word/footnotes.xml',
])
  delete emptyParts[name]
const states = [
  ['empty', Buffer.from(zipSync(emptyParts)).toString('base64')],
  ['short', bytes],
  ['long', largeBytes],
  ['broken', Buffer.from('sample invalid document').toString('base64')],
]

function captureStates() {
  return evalAsync<string[]>(`(async () => {
    const shots=[]
    for(const [state,base64] of ${JSON.stringify(states)}) {
      const path='sample-word-state-'+state+'.docx'
      const prior=app.vault.getAbstractFileByPath(path);if(prior) await app.vault.delete(prior)
      const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))
      const file=await app.vault.createBinary(path,data.buffer)
      const leaf=app.workspace.getLeaf('tab')
      try {
        await leaf.setViewState({type:'abele-word',state:{file:path},active:true});await app.workspace.revealLeaf(leaf)
        const root=leaf.view.contentEl
        for(let i=0;i<150;i++) {
          if(state==='broken' ? root.textContent.includes('Could not open document') : root.querySelector('.abele-word-page')) break
          await new Promise(resolve=>setTimeout(resolve,100))
        }
        if(state==='broken' ? !root.textContent.includes('Could not open document') : !root.querySelector('.abele-word-page')) throw Error('Word state did not settle: '+state)
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
        const shot=${JSON.stringify(SHOTS)}+'/word-'+state+'-'+(app.isMobile?'phone':'desktop')+'.png'
        if(window.__e2eHost) await window.__e2eHost.shot(shot)
        else {const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(shot,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
        shots.push(shot)
      } finally {leaf.detach();await app.vault.delete(file)}
    }
    return shots
  })()`)
}

describe.skipIf(!available)('Word document view', () => {
  let sidebars: [boolean, boolean] = [true, true]
  let size: [number, number] = [0, 0]
  beforeAll(() => {
    if (!onPhone()) {
      sidebars = evalJson('[app.workspace.leftSplit.collapsed,app.workspace.rightSplit.collapsed]')
      size = evalJson("require('@electron/remote').getCurrentWindow().getContentSize()")
      evalRaw('app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse()')
    }
    evalAsync(`(async () => {
      const data = Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
      if (old) await app.vault.delete(old)
      await app.vault.createBinary(${JSON.stringify(PATH)}, data.buffer)
      return true
    })()`)
  })
  afterAll(async () => {
    evalRaw(
      `(() => { for (const leaf of app.workspace.getLeavesOfType('abele-word')) if (leaf.view.file?.path === ${JSON.stringify(PATH)}) leaf.detach(); return true })()`
    )
    if (!onPhone()) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
    evalAsync(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('abele-word')) if (leaf.view.file?.path === ${JSON.stringify(PATH)}) leaf.detach()
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
      if (file) await app.vault.delete(file)
      ${onPhone() ? '' : `if (!${sidebars[0]}) app.workspace.leftSplit.expand(); if (!${sidebars[1]}) app.workspace.rightSplit.expand();`}
      const large = app.vault.getAbstractFileByPath(${JSON.stringify(LARGE)});if(large) await app.vault.delete(large)
      return true
    })()`)
  }, 120000)
  const probe = () =>
    evalAsync<{
      text: string
      safe: boolean
      over: boolean
      edit: boolean
      shot: string
    }>(`(async () => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({type:'abele-word',state:{file:${JSON.stringify(PATH)}},active:true})
    await app.workspace.revealLeaf(leaf)
    const until = async fn => { for (let i=0;i<150;i++) { if(fn()) return; await new Promise(r => setTimeout(r,100)) } throw Error('Word preview did not open') }
    await until(() => leaf.view.contentEl.querySelector('.abele-word-page'))
    const page = leaf.view.contentEl.querySelector('.abele-word-page')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    if (page.getBoundingClientRect().height < 100) throw Error('Word preview has no visible height')
    const root = leaf.view.contentEl
    const edge = root.getBoundingClientRect()
    const field=root.querySelector('.abele-word-page__field')
    const over = root.scrollWidth > root.clientWidth+1 || field.scrollWidth > field.clientWidth+1 || [...root.querySelectorAll('.abele-word-page__ribbon,.abele-word-page__status')].some(el => el.getBoundingClientRect().right > edge.right+1)
    const path = ${JSON.stringify(SHOTS)} + '/word-' + (app.isMobile ? 'phone' : 'desktop') + '.png'
    if (window.__e2eHost) await window.__e2eHost.shot(path)
    else { const fs = require('fs'); fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true}); const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage(); fs.writeFileSync(path,image.toPNG()) }
    return { text:page.textContent, safe:!page.querySelector('script,iframe,object,embed') && [...page.querySelectorAll('img')].every(img => ['png','jpeg','gif','webp'].some(mime => img.getAttribute('src').startsWith('data:image/'+mime+';base64,'))), over, edit:!!root.querySelector('[role=toolbar]'),shot:path }
  })()`)
  it('renders a Word package without executable document content', () => {
    const result = probe()
    expect(result.text).toContain('Sample report')
    expect(result.text).toContain('Cell sample')
    expect(result.safe).toBe(true)
    expect(result.over).toBe(false)
    console.info(result.shot)
  })
  it('saves desktop paragraph edits without altering other package parts', () => {
    if (onPhone()) return // Phone editing is agent-only.
    const data = evalAsync<string>(`(async () => {
      const view = app.workspace.getLeavesOfType('abele-word').find(l => l.view.file?.path === ${JSON.stringify(PATH)}).view
      const root = view.contentEl;
      const row = root.querySelector('[data-paragraph="2"]')
      row.querySelector('.abele-word-line__text').click()
      await new Promise(r => setTimeout(r,0))
      row.querySelector('textarea').value = 'Updated item';
      row.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));
      row.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      for (let i=0;i<150;i++) {
        if (view.document?.paragraphs[1]?.text === 'Updated item') break
        await new Promise(r => setTimeout(r,100))
      }
      const bytes = new Uint8Array(await app.vault.readBinary(view.file))
      let raw = ''; for (const b of bytes) raw += String.fromCharCode(b)
      return JSON.stringify(btoa(raw))
    })()`)
    const before = unzipSync(sampleDocx())
    const after = unzipSync(new Uint8Array(Buffer.from(data, 'base64')))
    expect(strFromU8(after['word/document.xml'])).toContain('Updated item')
    for (const name of Object.keys(before))
      if (name !== 'word/document.xml') expect(after[name], name).toEqual(before[name])
  })

  it('desktop formatting fields fit and apply formatting to the selected run', () => {
    if (onPhone()) return
    const result = evalAsync<{
      controls: string[]
      clipped: string[]
      formatted: boolean
      shots: string[]
    }>(`(async () => {
      const view = app.workspace.getLeavesOfType('abele-word').find(l=>l.view.file?.path===${JSON.stringify(PATH)}).view
      const root = view.contentEl
      const until = async (fn, what) => { for(let i=0;i<150;i++) { const got=fn(); if(got) return got; await new Promise(r=>setTimeout(r,100)) } throw Error(what+' did not appear') }
      const frames = () => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      const shots=[]
      const need = (scope, selector) => { const el=scope.querySelector(selector); if(!el) throw Error('Not on the page: '+selector); return el }
      const shot = async name => {
        await frames()
        const path=${JSON.stringify(SHOTS)}+'/'+name+'.png'
        const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
        shots.push(path)
      }
      const controls=[],clipped=[]
      // Every control's box, focused, inside every ancestor that clips: its focus ring is drawn.
      const fits = scope => {
        for(const el of scope.querySelectorAll('[aria-label]')) controls.push(el.getAttribute('aria-label'))
        for(const field of scope.querySelectorAll('input,select,textarea,button')) {
          if(field.disabled||!field.getClientRects().length) continue
          field.focus();const r=field.getBoundingClientRect()
          for(let el=field.parentElement;el&&el!==document.body;el=el.parentElement) {
            const css=getComputedStyle(el);if(css.overflowX==='visible'&&css.overflowY==='visible') continue
            const b=el.getBoundingClientRect()
            if(r.left-2 < b.left || r.right+2 > b.right) clipped.push(field.getAttribute('aria-label')||field.textContent)
          }
        }
      }
      need(root,'[data-paragraph="1"] .abele-word-line__text').click()
      const input=await until(()=>root.querySelector('[data-paragraph="1"] textarea'),'The paragraph field')
      input.focus();input.setSelectionRange(0,6)
      const ribbon=need(root,'.abele-word-page__ribbon')
      fits(ribbon)
      input.focus();input.setSelectionRange(0,6)
      await shot('word-desktop-editor')
      need(ribbon,'[aria-label="Italic (Mod+I)"]').click()
      for(let i=0;i<150;i++) {if(view.document?.xml.get('word/document.xml').includes('<w:i')) break;await new Promise(r=>setTimeout(r,100))}
      const formatted=!!view.document?.xml.get('word/document.xml').includes('<w:i')
      // What the ribbon has no room for, about the paragraph and then about its picture.
      const details = async (open, name) => {
        await open()
        const rows=await until(()=>document.querySelector('.modal .abele-word-details'),name+' rows')
        await new Promise(r=>setTimeout(r,400))
        fits(rows)
        await shot('word-desktop-'+name)
        need(rows.closest('.modal'),'.modal-close-button,.modal-header-button').click()
        await until(()=>!document.querySelector('.modal .abele-word-details'),name+' closing')
      }
      await details(()=>need(root,'.abele-word-page__ribbon [aria-label="Paragraph 1 controls"]').click(),'paragraph')
      await details(async ()=>{need(root,'[aria-label="Select picture paragraph 7"]').click();await until(()=>root.querySelector('.abele-word-page__ribbon [aria-label="Picture controls"]'),'Picture controls').then(b=>b.click())},'picture')
      return {controls,clipped,formatted,shots}
    })()`)
    for (const label of [
      'Bold (Mod+B)',
      'Italic (Mod+I)',
      'Underline (Mod+U)',
      'Strikethrough (Mod+Shift+X)',
      'Paragraph style',
      'Bulleted list',
      'Numbered list',
      'Link the selected words',
      'Insert a picture after this paragraph',
      // Splitting is Enter in the field, as in Word; joining and a picture's size are rows.
      'Join the next paragraph onto this one',
      'Width in pixels',
      'Height in pixels',
    ])
      expect(result.controls).toContain(label)
    expect(result.clipped).toEqual([])
    expect(result.formatted).toBe(true)
    console.info(result.shots.join('\n'))
  })

  it('renders and scrolls every paragraph without a long blocked animation frame', () => {
    const result = evalAsync<{
      paragraphs: number
      rows: number
      frames: number
      maxGap: number
      rich: boolean
    }>(`(async () => {
      const path=${JSON.stringify(LARGE)}
      const prior=app.vault.getAbstractFileByPath(path);if(prior) await app.vault.delete(prior)
      const data=Uint8Array.from(atob(${JSON.stringify(largeBytes)}),c=>c.charCodeAt(0));const file=await app.vault.createBinary(path,data.buffer)
      const leaf=app.workspace.getLeaf('tab');let handle=0;let last=performance.now();let frames=0;let maxGap=0;let stopped=false
      const tick = at => {if(stopped) return;frames++;maxGap=Math.max(maxGap,at-last);last=at;handle=requestAnimationFrame(tick)}
      handle=requestAnimationFrame(tick)
      try {
        await leaf.setViewState({type:'abele-word',state:{file:path},active:true});await app.workspace.revealLeaf(leaf)
        for(let i=0;i<150&&leaf.view.contentEl.querySelectorAll('[data-paragraph]').length!==5004;i++) await new Promise(r=>setTimeout(r,100))
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
        const field=leaf.view.contentEl.querySelector('.abele-word-page__field')
        for(let i=0;i<10;i++) {field.scrollTop=field.scrollHeight*i/9;await new Promise(resolve=>requestAnimationFrame(resolve))}
        return {paragraphs:leaf.view.document?.paragraphs.length ?? 0,rows:leaf.view.contentEl.querySelectorAll('[data-paragraph]').length,frames,maxGap,rich:!!leaf.view.contentEl.querySelector('iframe')}
      } finally {stopped=true;cancelAnimationFrame(handle);leaf.detach();await app.vault.delete(file)}
    })()`)
    expect(result.paragraphs).toBe(5004)
    expect(result.rows).toBe(5004)
    expect(result.rich).toBe(false)
    expect(result.frames).toBeGreaterThan(1)
    expect(result.maxGap).toBeLessThan(500)
  })

  it('captures empty, short, long and broken synthetic document states', () => {
    const shots = captureStates()
    expect(shots).toHaveLength(4)
    console.info(shots.join('\n'))
  }, 120000)

  it('fits a phone screen and offers no hand-editing controls', async () => {
    if (!onPhone()) {
      evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390,844)")
      await reloadApp('app.emulateMobile(true)')
    }
    const result = probe()
    expect(result.over).toBe(false)
    expect(result.edit).toBe(false)
    expect(result.text).toContain('Sample report')
    console.info(result.shot)
    expect(captureStates()).toHaveLength(4)
  }, 120000)
})
