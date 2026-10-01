import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleDocx, paragraph, SAMPLE_IMAGE } from '../fixtures/docx/sampleDocx'
import { strFromU8, unzipSync } from 'fflate'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const DOC = 'sample-word-editing-e2e.docx'
const IMAGE = 'sample-word-image-e2e.png'
const table =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  [1, 2]
    .map(
      (r) =>
        '<w:tr>' +
        [1, 2].map((c) => `<w:tc><w:tcPr/>${paragraph(`Sample cell ${r}-${c}`)}</w:tc>`).join('') +
        '</w:tr>'
    )
    .join('') +
  '</w:tbl>'
const original = sampleDocx(paragraph('Sample formatting text') + table + paragraph('Sample tail'))
const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64')
const SHOTS = shotDir('abele-word')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('Word editing through agent tools', () => {
  beforeAll(() => {
    evalAsync(`(async () => {
      for (const [path,base64] of ${JSON.stringify([
        [DOC, b64(original)],
        [IMAGE, b64(SAMPLE_IMAGE)],
      ])}) {
        const old = app.vault.getAbstractFileByPath(path); if(old) await app.vault.delete(old)
        const bytes = Uint8Array.from(atob(base64), c=>c.charCodeAt(0)); await app.vault.createBinary(path,bytes.buffer)
      }
      return true
    })()`)
  })
  afterAll(() => {
    evalAsync(`(async () => {
      for(const leaf of app.workspace.getLeavesOfType('abele-word')) if(leaf.view.file?.path===${JSON.stringify(DOC)}) leaf.detach()
      for(const path of ${JSON.stringify([DOC, IMAGE])}) {const file=app.vault.getAbstractFileByPath(path);if(file) await app.vault.delete(file)}
      return true
    })()`)
  })
  it('round-trips text, formatting, paragraphs, links, tables and inline images on this device', () => {
    const result = evalAsync<{
      bytes: string
      count: number
      stale: boolean
      image: boolean
      shot: string
      preview: boolean
    }>(`(async () => {
      const api = window.__abeleTest
      const scope = new api.ScopeResolver(); scope.setFullVaultAccess(true)
      api.ScopeResolver.setActiveInstance(scope)
      try {
        const tools = api.createAgentTools()
        const read = tools.find(t=>t.name==='docx_read'); const write=tools.find(t=>t.name==='docx_edit')
        const initial = await read.execute('sample-read',{path:${JSON.stringify(DOC)}})
        let revision = initial.content[0].text.match(/revision ([0-9a-f-]+)/)[1]
        const originalRevision = revision; let count=0; let preview=false
        const edit = async args => {
          const result = await write.execute('sample-edit-'+(++count),{path:${JSON.stringify(DOC)},revision,paragraph:1,...args})
          revision=result.content[0].text.match(/revision ([0-9a-f-]+)/)[1]
          if(args.operation==='format') preview=result.details.diff.old!==result.details.diff.new
        }
        await edit({operation:'format',from:0,to:6,format:'italic',enabled:true})
        await edit({operation:'style',style_id:'Heading1'})
        await edit({operation:'list',list:'decimal'})
        await edit({operation:'paragraph_add',text:'Second sample paragraph'})
        await edit({operation:'paragraph_split',paragraph:2,offset:7})
        await edit({operation:'paragraph_merge',paragraph:2})
        await edit({operation:'paragraph_delete',paragraph:2})
        await edit({operation:'link',from:0,to:6,url:'https://example.invalid/sample'})
        await edit({operation:'link',from:0,to:6,url:'https://example.invalid/changed'})
        await edit({operation:'link',from:0,to:6,url:''})
        await edit({operation:'row_add',table:1,row:1})
        await edit({operation:'row_delete',table:1,row:2})
        await edit({operation:'cells_merge',table:1,row:1,column:1,to_row:2,to_column:2})
        await edit({operation:'cells_split',table:1,row:1,column:1})
        await edit({operation:'image_insert',image_path:${JSON.stringify(IMAGE)},width:96,height:64})
        await edit({operation:'image_resize',image:1,width:160,height:90})
        await edit({operation:'image_replace',image:1,image_path:${JSON.stringify(IMAGE)}})
        await edit({operation:'image_delete',image:1})
        await edit({operation:'image_insert',image_path:${JSON.stringify(IMAGE)},width:120,height:80})
        let stale=false
        try {await write.execute('sample-stale',{path:${JSON.stringify(DOC)},revision:originalRevision,paragraph:1,operation:'insert',text:'stale'})} catch(error) {stale=/changed/.test(error.message)}
        const leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({type:'abele-word',state:{file:${JSON.stringify(DOC)}},active:true}); await app.workspace.revealLeaf(leaf)
        let image=false
        for(let i=0;i<150;i++) {
          const img=leaf.view.contentEl.querySelector('iframe')?.contentDocument?.querySelector('img')
          if(img?.complete && img.naturalWidth>0) {image=true;break}
          await new Promise(resolve=>setTimeout(resolve,100))
        }
        const data = new Uint8Array(await app.vault.readBinary(leaf.view.file)); let raw=''; for(const b of data) raw+=String.fromCharCode(b)
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
        const path=${JSON.stringify(SHOTS)}+'/word-edited.png'
        if(window.__e2eHost) await window.__e2eHost.shot(path)
        else {const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
        return {bytes:btoa(raw),count,stale,image,shot:path,preview}
      } finally {api.ScopeResolver.setActiveInstance(null)}
    })()`)
    expect(result.count).toBe(19)
    expect(result.stale).toBe(true)
    expect(result.preview).toBe(true)
    expect(result.image).toBe(true)
    const before = unzipSync(original)
    const after = unzipSync(new Uint8Array(Buffer.from(result.bytes, 'base64')))
    for (const name of Object.keys(before))
      if (
        ![
          'word/document.xml',
          'word/numbering.xml',
          'word/_rels/document.xml.rels',
          '[Content_Types].xml',
        ].includes(name)
      )
        expect(after[name], name).toEqual(before[name])
    const body = strFromU8(after['word/document.xml'])
    for (const value of [
      'Sample formatting text',
      'Sample cell 1-1',
      'Sample cell 1-2',
      'Sample cell 2-1',
      'Sample cell 2-2',
      'Sample tail',
    ])
      expect(body.replace(/<[^>]*>/g, '')).toContain(value)
    expect(body).not.toContain('Second sample paragraph')
    expect(body).not.toContain('gridSpan')
    expect(body).not.toContain('vMerge')
    console.info(result.shot)
  }, 60000)
})
