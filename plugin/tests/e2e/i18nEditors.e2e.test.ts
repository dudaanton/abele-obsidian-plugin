import { describe, expect, it } from 'vitest'
import { sampleDocx, paragraph } from '../fixtures/docx/sampleDocx'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
import { emptyDrawingSvg } from '@/drawing/drawingFile'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const shots = shotDir('i18n-editors')
const dir = 'Sample localized editors'
const binaries = {
  'sample.docx': Buffer.from(sampleDocx(paragraph('Original document content'))).toString('base64'),
  'sample.xlsx': Buffer.from(sampleXlsx()).toString('base64'),
}
const texts = {
  'sample.svg': emptyDrawingSvg(),
  'sample.md': '---\ntype: presentation\n---\n# Original slide content\n---\n# Second slide',
  'diagram.md':
    '# Sample diagram\n\n```mermaid\ngraph LR\nA[Original content] --> B[Second step]\n```\n',
  'sample.canvas': JSON.stringify({
    nodes: [
      {
        id: 'sample-card',
        type: 'text',
        x: 0,
        y: 0,
        width: 260,
        height: 160,
        text: 'Original canvas content',
      },
    ],
    edges: [],
  }),
}

describe.skipIf(!isObsidianRunning() || !hasTestApi())('localized editors', () => {
  it('fits Russian and expanded controls without changing original files', async () => {
    async function check(phone: boolean) {
      for (const locale of ['ru', 'en-XA']) {
        const result = JSON.parse(
          await evalLong(
            `(async()=>{
          ${WAIT_PRELUDE}
          const dir=${JSON.stringify(dir)}, api=window.__abeleTest
          if(app.vault.getAbstractFileByPath(dir))throw Error('Synthetic folder already exists')
          const layout=app.workspace.getLayout(), trust=app.loadLocalStorage('mermaid-vault-trust')
          const linter=api.LinterService.getInstance(), previousReport=linter.report.value
          const owned=[], before=new Map(), failures=[]
          const fs=require('fs'), win=require('@electron/remote').getCurrentWindow()
          fs.mkdirSync(${JSON.stringify(shots)},{recursive:true})
          const shot=async(name,root)=>{
            await wait(400)
            const controls=root.querySelectorAll('.abele-workbook-bar,.abele-picture-editor__bar,.abele-picture-editor__top,.abele-picture-editor__bottom,.abele-mermaid__bar,.abele-modal__footer,.abele-linter__actions,.abele-deck-toolbar')
            for(const el of controls){
              const r=el.getBoundingClientRect()
              if(r.width&&(r.left < -1 || r.right > innerWidth+1 || el.scrollWidth > el.clientWidth+2))
                failures.push({name,cls:el.className,width:el.clientWidth,scroll:el.scrollWidth,left:r.left,right:r.right})
            }
            if(/streamC\\.[a-z0-9]/i.test(root.textContent))throw Error('Missing translation key in '+name)
            fs.writeFileSync(${JSON.stringify(shots + '/' + locale + (phone ? '-phone-' : '-desktop-'))}+name+'.png',(await win.webContents.capturePage()).toPNG())
          }
          try {
            api.setTestLocale(${JSON.stringify(locale)})
            app.saveLocalStorage('mermaid-vault-trust',true)
            await app.vault.createFolder(dir)
            for(const [name,text] of Object.entries(${JSON.stringify(texts)})) {
              const f=await app.vault.create(dir+'/'+name,text);owned.push(f)
            }
            for(const [name,b64] of Object.entries(${JSON.stringify(binaries)})) {
              const f=await app.vault.createBinary(dir+'/'+name,Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer);owned.push(f)
            }
            const picture=document.createElement('canvas');picture.width=320;picture.height=240
            const ink=picture.getContext('2d');ink.fillStyle='#888';ink.fillRect(0,0,320,240)
            const blob=await new Promise(resolve=>picture.toBlob(resolve))
            owned.push(await app.vault.createBinary(dir+'/sample.png',await blob.arrayBuffer()))
            for(const f of owned)before.set(f.path,Buffer.from(await app.vault.readBinary(f)).toString('base64'))
            const cases=[['sample.docx','abele-word','.abele-word-page'],['sample.xlsx','abele-workbook','.abele-workbook-grid'],['sample.svg','abele-drawing','.abele-legacy-drawing'],['sample.png','abele-image-ink','.abele-picture-editor'],['sample.md','abele-deck','.abele-deck'],['diagram.md','markdown','.abele-mermaid'],['sample.canvas','abele-canvas','.abele-canvas-chrome'],['','abele-linter','.abele-linter'],['','abele-debug-view','.abele-debug-view']]
            const leaf=app.workspace.getLeaf('tab')
            for(const [name,type,selector] of cases){
              const file=name ? app.vault.getAbstractFileByPath(dir+'/'+name) : null
                await leaf.setViewState({type,state:file ? (type==='abele-image-ink' ? {path:file.path,crop:true} : {file:file.path,mode:'preview'}) : {},active:true});await app.workspace.revealLeaf(leaf)
                if(type==='abele-linter')await linter.run({kind:'notes',paths:[dir+'/diagram.md']})
                if(type==='abele-deck')await leaf.view.viewer?.ready
                const root=await until(()=>leaf.view.containerEl.querySelector(selector),20000)
                if(!root)throw Error('Editor did not mount: '+type)
                if(type==='abele-drawing' && leaf.view.containerEl.querySelector('.abele-picture-editor__bar'))throw Error('Legacy drawing must remain read-only')
                if(type==='abele-image-ink' && !await until(()=>leaf.view.editor.width>0 && leaf.view.session))throw Error('Picture editor did not load')
                if(type==='markdown'&&!await until(()=>root.querySelector('svg'),20000))throw Error('Diagram did not render')
                if(type==='abele-word' && root.textContent.includes('Use the agent to edit this document on mobile'))
                  throw Error('Mobile read-only instruction did not translate')
                await shot(type,leaf.view.containerEl)
                if(type==='abele-image-ink'){
                  root.querySelector('.abele-picture-editor__tool_pen').click()
                  if(!await until(()=>leaf.view.model.tool==='pen' && !leaf.view.editor.cropping))throw Error('Localized picture pen did not activate')
                  await shot('picture-pen',leaf.view.containerEl)
                }
                if(type==='abele-canvas'){
                  const pen=root.querySelector('.abele-canvas-chrome__tool .lucide-pen-line')?.closest('.abele-canvas-chrome__tool')
                  if(!pen)throw Error('Canvas pen control did not mount')
                  if(!await until(()=>leaf.view.editor && !leaf.view.editor.controls.state('Draw with pen').disabled))throw Error('Canvas editor did not become ready')
                  pen.click()
                  if(!await until(()=>leaf.view.editor?.controls.tool()==='pen'))throw Error('Translated Canvas pen did not activate')
                  await shot('canvas-pen',leaf.view.containerEl)
                }
                if(type==='abele-deck'){
                  await leaf.view.startPresenter()
                  const presenter=await until(()=>leaf.view.presenter)
                  if(!presenter)throw Error('Presenter did not open')
                  await presenter.ready
                  try {await shot('presenter',presenter.root)} finally {leaf.view.show?.end()}
                }
                if(type==='abele-word'){
                  await leaf.view.advanced(1,false)
                  const modal=await until(()=>document.querySelector('.modal .abele-word-details')?.closest('.modal'))
                  if(!modal)throw Error('Word controls did not open')
                  await shot('word-controls',modal)
                  modal.closest('.modal-container').querySelector('.modal-close-button,.modal-header-button:has(svg.lucide-x)')?.click()
                  if(!await until(()=>!modal.isConnected))throw Error('Word controls did not close')
                }
            }
            return JSON.stringify({failures,unchanged:await Promise.all(owned.map(async f=>before.get(f.path)===Buffer.from(await app.vault.readBinary(f)).toString('base64')))})
          } finally {
            linter.report.value=previousReport
            for(const type of ['abele-word','abele-workbook','abele-drawing','abele-image-ink','abele-deck','abele-canvas','markdown'])
              for(const leaf of app.workspace.getLeavesOfType(type))if((leaf.view.file?.path ?? leaf.view.getState().path ?? '').startsWith(dir+'/'))leaf.detach()
            const folder=app.vault.getAbstractFileByPath(dir);if(folder)await app.vault.delete(folder,true)
            app.saveLocalStorage('mermaid-vault-trust',trust ?? null)
            api.setTestLocale('en')
            await app.workspace.changeLayout(layout)
          }
        })()`,
            120_000
          )
        ) as { failures: unknown[]; unchanged: boolean[] }
        expect(result.failures, `${locale} ${phone ? 'phone' : 'desktop'}`).toEqual([])
        expect(result.unchanged).toEqual([true, true, true, true, true, true, true])
      }
    }
    try {
      await check(false)
      await withEmulatedPhone(() => check(true))
    } finally {
      evalRaw(`window.__abeleTest?.setTestLocale('en')`)
      await reloadApp('app.emulateMobile(false)')
    }
  }, 480_000)
})
