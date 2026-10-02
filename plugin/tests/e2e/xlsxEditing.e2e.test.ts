import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
import { unzipSync, strFromU8 } from 'fflate'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
targets('desktop', 'phone')
const PATH = 'sample-workbook-editing-e2e.xlsx'
const original = sampleXlsx()
const base64 = Buffer.from(original).toString('base64')
const SHOTS = shotDir('abele-workbook')
const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('workbook editing', () => {
  beforeAll(() =>
    evalAsync(
      `(async()=>{const path=${JSON.stringify(PATH)};const old=app.vault.getAbstractFileByPath(path);if(old)await app.vault.delete(old);await app.vault.createBinary(path,Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0)).buffer);return true})()`
    )
  )
  afterAll(() =>
    evalAsync(
      `(async()=>{for(const leaf of app.workspace.getLeavesOfType('abele-workbook'))if(leaf.view.file?.path===${JSON.stringify(PATH)})leaf.detach();const file=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(file)await app.vault.delete(file);return true})()`
    )
  )
  it('reads, previews, writes, rejects stale edits, and reopens the saved package through agent tools', () => {
    const result = evalAsync<{
      bytes: string
      stale: boolean
      preview: boolean
      read: string
      over: boolean
      shot: string
    }>(`(async()=>{
      const api=window.__abeleTest;const scope=new api.ScopeResolver();scope.addFile(${JSON.stringify(PATH)});const ctx={scope,interactive:true}
      try{
        const tools=api.createAgentTools();const read=tools.find(t=>t.name==='xlsx_read');const write=tools.find(t=>t.name==='xlsx_write')
        const params={path:${JSON.stringify(PATH)},sheet:'Sample',range:'B2:C2'}
        const first=await read.execute('sample-read',params,undefined,ctx);const revision=first.content[0].text.match(/revision ([0-9a-f-]+)/)[1]
        const args={...params,revision,values:[[25,{formula:'B2*2'}]]};const edited=await write.execute('sample-write',args,undefined,ctx)
        const nextRevision=edited.content[0].text.match(/revision ([0-9a-f-]+)/)[1]
        const formatted=await write.execute('sample-format',{...params,revision:nextRevision,operation:'format',format:{bold:true,italic:true,fill:'#33AA77',number_format:'0.00'}},undefined,ctx)
        if(!formatted.details.diff.new.includes('fill=#33AA77'))throw Error('Style preview did not include the changed fill')
        let stale=false;try{await write.execute('sample-stale',args,undefined,ctx)}catch(e){stale=/changed/.test(e.message)}
        const updated=await read.execute('sample-read-after',params,undefined,ctx)
        const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-workbook',state:{file:params.path},active:true});await app.workspace.revealLeaf(leaf)
        const root=leaf.view.contentEl;for(let i=0;i<150&&!root.querySelector('[data-cell="C2"]');i++)await new Promise(r=>setTimeout(r,100));if(!root.querySelector('[data-cell="C2"]'))throw Error('Saved workbook did not reopen')
        const edge=root.getBoundingClientRect();const over=[...root.querySelectorAll('.abele-workbook-bar input,.abele-workbook-bar select,.abele-workbook-bar button')].some(el=>el.getBoundingClientRect().right>edge.right+1)
        const path=${JSON.stringify(SHOTS)}+'/workbook-edited.png'
        if(window.__e2eHost)await window.__e2eHost.shot(path);else{const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
        const data=new Uint8Array(await app.vault.readBinary(leaf.view.file));let raw='';for(const b of data)raw+=String.fromCharCode(b)
        return {bytes:btoa(raw),stale,preview:edited.details.diff.old!==edited.details.diff.new,read:updated.content[0].text,over,shot:path}
      }finally{scope.clear()}
    })()`)
    expect(result.stale).toBe(true)
    expect(result.preview).toBe(true)
    expect(result.read).toContain('B2: 25')
    expect(result.read).toContain('B2*2')
    expect(result.read).toContain('C2: 50')
    expect(result.over).toBe(false)
    const before = unzipSync(original)
    const after = unzipSync(new Uint8Array(Buffer.from(result.bytes, 'base64')))
    for (const name of Object.keys(before))
      if (
        ![
          'xl/worksheets/sheet1.xml',
          'xl/workbook.xml',
          'xl/worksheets/sheet2.xml',
          'xl/styles.xml',
        ].includes(name)
      )
        expect(after[name], name).toEqual(before[name])
    expect(strFromU8(after['xl/worksheets/sheet1.xml'])).toContain('B2*2')
    console.info(result.shot)
  })
  it('edits values by hand only on desktop with unclipped focus rings', () => {
    if (onPhone()) return
    const result = evalAsync<{ value: number; clipped: string[] }>(`(async()=>{
      const view=app.workspace.getLeavesOfType('abele-workbook').find(l=>l.view.file?.path===${JSON.stringify(PATH)}).view;const root=view.contentEl
      root.querySelector('[data-cell="B2"]').click();await new Promise(r=>setTimeout(r,50));root.querySelector('.abele-workbook-edit').click();await new Promise(r=>setTimeout(r,50))
      const clipped=[];for(const f of root.querySelectorAll('.abele-workbook-editor input,.abele-workbook-editor select,.abele-workbook-editor textarea')){f.focus();const r=f.getBoundingClientRect();for(let p=f.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;const b=p.getBoundingClientRect();if(r.left-2<b.left||r.right+2>b.right)clipped.push(f.getAttribute('aria-label'))}}
      const shot=${JSON.stringify(SHOTS)}+'/workbook-desktop-editor.png';const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(shot,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      const input=root.querySelector('.abele-workbook-editor textarea');input.value='35';input.dispatchEvent(new Event('input',{bubbles:true}));root.querySelector('.abele-workbook-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
      for(let i=0;i<150;i++){if(view.workbook&&(await view.workbook.sheet('Sample')).cells.get('B2')?.value===35)break;await new Promise(r=>setTimeout(r,100))}
      return {value:(await view.workbook.sheet('Sample')).cells.get('B2')?.value,clipped}
    })()`)
    expect(result.value).toBe(35)
    expect(result.clipped).toEqual([])
  })
  it('keeps unsaved desktop input when an agent changes the file, refuses the stale save, and reloads on cancel', () => {
    if (onPhone()) return
    const result = evalAsync<{
      retained: boolean
      refused: boolean
      value: number
      sheet: string
    }>(`(async()=>{
      const api=window.__abeleTest;const view=app.workspace.getLeavesOfType('abele-workbook').find(l=>l.view.file?.path===${JSON.stringify(PATH)}).view
      const root=view.contentEl;root.querySelector('[data-cell="B2"]').click();await new Promise(r=>setTimeout(r,50));root.querySelector('.abele-workbook-edit').click();await new Promise(r=>setTimeout(r,50))
      const input=root.querySelector('.abele-workbook-editor textarea');input.value='99';input.dispatchEvent(new Event('input',{bubbles:true}))
      const scope=new api.ScopeResolver();scope.addFile(${JSON.stringify(PATH)});const ctx={scope,interactive:true}
      try{const tools=api.createAgentTools();const params={path:${JSON.stringify(PATH)},sheet:'Sample',range:'B2'};const first=await tools.find(t=>t.name==='xlsx_read').execute('sample-read',params,undefined,ctx);const revision=first.content[0].text.match(/revision ([0-9a-f-]+)/)[1];await tools.find(t=>t.name==='xlsx_write').execute('sample-concurrent',{...params,revision,values:[[45]]},undefined,ctx)}finally{scope.clear()}
      const retained=root.querySelector('.abele-workbook-editor textarea')?.value==='99'
      root.querySelector('.abele-workbook-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));for(let i=0;i<150&&!root.querySelector('[role="status"]').textContent.includes('changed');i++)await new Promise(r=>setTimeout(r,100))
      const refused=root.querySelector('[role="status"]').textContent.includes('changed')
      ;[...root.querySelectorAll('.abele-workbook-editor button')].find(b=>b.textContent==='Cancel').click()
      for(let i=0;i<150;i++){if(!root.querySelector('.abele-workbook-editor')&&view.workbook&&(await view.workbook.sheet('Sample')).cells.get('B2')?.value===45)break;await new Promise(r=>setTimeout(r,100))}
      return {retained,refused,value:(await view.workbook.sheet('Sample')).cells.get('B2')?.value,sheet:root.querySelector('select').value}
    })()`)
    expect(result.retained).toBe(true)
    expect(result.refused).toBe(true)
    expect(result.value).toBe(45)
    expect(result.sheet).toBe('Sample')
  })
})
