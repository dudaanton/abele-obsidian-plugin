import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample human canvas'
const SHOTS = shotDir('canvas-editor')
const PRELUDE = `
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (test, label) => { for(let i=0;i<100;i++){if(test())return;await wait(60)}throw Error('Timed out: '+label) }
  const path = ${JSON.stringify(`${DIR}/Sample diagram.canvas`)}
  const view = () => app.workspace.getLeavesOfType('abele-canvas').find(leaf => leaf.view.file?.path === path)?.view
  const read = async () => JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
  const button = label => view()?.contentEl.querySelector('[aria-label="'+label+'"]')
  const cdp = window.__e2eHost ? null : require('@electron/remote').getCurrentWebContents().debugger
  const owned = cdp && !cdp.isAttached(); if(owned)cdp.attach('1.3')
  const tap = async (el,corner=false) => {
    if(!el)throw Error('Missing input target')
    // Native mobile prompts animate in from below the viewport. DOM presence is not readiness.
    await until(()=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight},'visible input target')
    const r=el.getBoundingClientRect(), x=Math.round(r.left+(corner?10:r.width/2)), y=Math.round(r.top+(corner?10:r.height/2))
    if(!r.width||!r.height||x<0||x>innerWidth||y<0||y>innerHeight)throw Error('Input target outside viewport: '+el.textContent)
    if(window.__e2eHost)await window.__e2eHost.tap(x,y)
    else {await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1})}
    await wait(180)
  }
  const type = async text => {if(window.__e2eHost)await window.__e2eHost.type(text);else await cdp.sendCommand('Input.insertText',{text});await wait(200)}
  const shot = async name => {
    const target=${JSON.stringify(SHOTS)}+'/'+name+'.png'
    if(window.__e2eHost)await window.__e2eHost.shot(target)
    else {const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(target,image.toPNG())}
  }
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE} try { ${body} } finally { if(owned)cdp.detach() } })()`,
    120_000
  )
const input = <T>(body: string) => withNativeInput(() => run<T>(body))

describe.skipIf(!available)('human canvas creation and editing with real input', () => {
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__humanCanvas = {layout:app.workspace.getLayout(), preference:window.__abeleTest.AbeleConfig.getInstance().canvasViewer, location:app.vault.getConfig('newFileLocation')}
      window.__abeleTest.AbeleConfig.getInstance().canvasViewer=true
      app.vault.setConfig('newFileLocation','current')
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__humanCanvas.owned=true
      const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},'A note inserted by a person.')
      const leaf=app.workspace.getLeaf('tab');await leaf.openFile(note);await app.workspace.revealLeaf(leaf)
      return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      const fixture=window.__humanCanvas
      if(fixture?.process)app.vault.process=fixture.process
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      const leaves=[];app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(leaf)})
      leaves.forEach(leaf=>leaf.detach())
      if(fixture?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
      if(fixture){window.__abeleTest.AbeleConfig.getInstance().canvasViewer=fixture.preference;app.vault.setConfig('newFileLocation',fixture.location);await app.workspace.changeLayout(fixture.layout)}
      delete window.__humanCanvas
      return true
    `)
  }, 120_000)
  it('creates an empty canvas from the palette and completes a card with keyboard input', async () => {
    const result = await input<{ text: string; undo: number; focused: boolean; empty: boolean }>(`
      // Navigation opens the palette; creation itself is chosen with real input.
      app.commands.executeCommandById('command-palette:open')
      await until(()=>document.querySelector('.prompt-input'),'palette')
      await tap(document.querySelector('.prompt-input'));await type('New Abele canvas')
      await until(()=>[...document.querySelectorAll('.suggestion-item')].some(el=>el.textContent.includes('New Abele canvas')),'creation command')
      await tap([...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes('New Abele canvas')))
      await until(()=>document.querySelector('[aria-label="Canvas name"]'),'name field')
      await tap(document.querySelector('[aria-label="Canvas name"]'));await type('Sample diagram')
      await tap([...document.querySelectorAll('.abele-canvas-input button')].find(el=>el.textContent==='Create'))
      await until(()=>view()?.editor,'editor')
      const empty=(await read()).nodes.length===0
      await tap(button('Add text card'))
      const field=view().contentEl.querySelector('textarea'),focused=document.activeElement===field
      await tap(field);await type('Human concept')
      await shot('text-keyboard')
      await tap(button('Save text'));await until(()=>!view().documentLease.document.session.dirty,'saved text')
      return {text:(await read()).nodes[0].text,undo:view().documentLease.document.session.history.undo,focused,empty}
    `)
    expect(result).toEqual({ text: 'Human concept', undo: 1, focused: true, empty: true })
  }, 120_000)
  it('inserts a note through the native picker, selects a card by pointer, and deletes/undoes/redoes', async () => {
    const result = await input<{
      note: string
      selected: boolean
      deleted: boolean
      restored: boolean
      redone: boolean
    }>(`
      await tap(button('Add note or attachment'))
      await until(()=>document.querySelector('.prompt-input'),'file picker')
      await tap(document.querySelector('.prompt-input'));await type('sample-note')
      await until(()=>[...document.querySelectorAll('.suggestion-item')].some(el=>el.textContent.includes(${JSON.stringify(DIR + '/sample-note.md')})),'note choice')
      await tap([...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes(${JSON.stringify(DIR + '/sample-note.md')})))
      await until(()=>!view().documentLease.document.session.dirty && (view().viewer.graph.nodes.length===2),'saved note')
      const note=(await read()).nodes.find(node=>node.type==='file').file
      await tap(button('Fit diagram'));await wait(400)
      const fileNode=view().viewer.graph.nodes.find(node=>node.type==='file')
      const frame=view().contentEl.querySelector('[data-card-id="'+fileNode.id+'"]')
      await tap(frame)
      const selected=!button('Open selected card').disabled && button('Edit card text').disabled
      await tap(button('Delete selected card'));await until(()=>view().viewer.graph.nodes.length===1,'delete note')
      const deleted=(await read()).nodes.length===1
      await tap(button('Undo canvas change'));await until(()=>view().viewer.graph.nodes.length===2,'undo note')
      const restored=(await read()).nodes.some(node=>node.file===note)
      await tap(button('Redo canvas change'));await until(()=>view().viewer.graph.nodes.length===1,'redo note')
      const redone=(await read()).nodes.length===1
      await tap(button('Undo canvas change'));await until(()=>view().viewer.graph.nodes.length===2,'restore note')
      await shot('cards-history')
      return {note,selected,deleted,restored,redone}
    `)
    expect(result).toEqual({
      note: `${DIR}/sample-note.md`,
      selected: true,
      deleted: true,
      restored: true,
      redone: true,
    })
  }, 120_000)
  it('edits selected canvas text without editing the inserted note and adds a web link', async () => {
    const result = await input<{ text: string; note: string; link: string }>(`
      await tap(button('Fit diagram'));await wait(400)
      const node=view().viewer.graph.nodes.find(node=>node.type==='text')
      await tap(view().contentEl.querySelector('[data-card-id="'+node.id+'"]'),true)
      await tap(button('Edit card text'))
      const field=view().contentEl.querySelector('textarea')
      await tap(field);await type(' revised')
      await tap(button('Save text'));await until(()=>!view().documentLease.document.session.dirty,'edited text')
      const text=(await read()).nodes.find(item=>item.id===node.id).text
      const note=await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(DIR + '/sample-note.md')}))
      await tap(button('Add link'));await until(()=>document.querySelector('[aria-label="Web address"]'),'link address')
      await tap(document.querySelector('[aria-label="Web address"]'));await type('https://sample.example/diagram')
      await tap([...document.querySelectorAll('.abele-canvas-input button')].find(el=>el.textContent==='Create'))
      await until(()=>!view().documentLease.document.session.dirty && view().viewer.graph.nodes.some(node=>node.type==='link'),'saved link')
      return {text,note,link:(await read()).nodes.find(node=>node.type==='link').url}
    `)
    expect(result.text).toContain('Human concept')
    expect(result.text).toContain('revised')
    expect(result.note).toBe('A note inserted by a person.')
    expect(result.link).toBe('https://sample.example/diagram')
  }, 120_000)

  it('retries a known-unwritten human save on the same source and reopens saved content', async () => {
    const result = await input<{ pending: boolean; saved: boolean; reopened: boolean }>(`
      window.__humanCanvas.process=app.vault.process
      app.vault.process=async function(file,fn){if(file.path===path)throw Error('Sample known-unwritten failure');return window.__humanCanvas.process.call(this,file,fn)}
      await tap(button('Add text card'));await tap(view().contentEl.querySelector('textarea'));await type('Retryable human text')
      await tap(button('Save text'));await until(()=>button('Retry save')&&!button('Retry save').disabled,'retry')
      const pending=view().viewer.graph.nodes.some(node=>node.text==='Retryable human text')&&view().contentEl.textContent.includes('not saved')
      app.vault.process=window.__humanCanvas.process;delete window.__humanCanvas.process
      await tap(button('Retry save'));await until(()=>!view().documentLease.document.session.dirty,'saved retry')
      const saved=(await read()).nodes.some(node=>node.text==='Retryable human text')
      view().leaf.detach();await wait(300)
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf)
      await until(()=>view()?.editor,'reopened')
      const reopened=view().viewer.graph.nodes.some(node=>node.text==='Retryable human text')
      return {pending,saved,reopened}
    `)
    expect(result).toEqual({ pending: true, saved: true, reopened: true })
  }, 120_000)

  // BUG: native Canvas rewrites only JSON whitespace on unload. The strict byte revision
  // correctly blocks a retained draft's retry, even without a semantic native edit. Do not
  // cancel native saves or acknowledge matching content to make this guarantee pass.
  it.fails(
    'keeps a failed human save visible, asks before native handoff, and reopens retained text for retry',
    async () => {
      const result = await input<{
        unsaved: boolean
        sourceSame: boolean
        retained: boolean
        native: boolean
        reopened: boolean
        saved: boolean
      }>(`
      const before=await app.vault.read(app.vault.getAbstractFileByPath(path))
      window.__humanCanvas.process=app.vault.process
      app.vault.process=async function(file,fn){if(file.path===path)throw Error('Sample known-unwritten save failure');return window.__humanCanvas.process.call(this,file,fn)}
      await tap(button('Add text card'));await tap(view().contentEl.querySelector('textarea'));await type('Retained human text')
      await tap(button('Save text'));await until(()=>button('Retry save')&&!button('Retry save').disabled,'retry control')
      const unsaved=view().contentEl.textContent.includes('not saved') && view().viewer.graph.nodes.some(node=>node.text==='Retained human text')
      const sourceSame=before===await app.vault.read(app.vault.getAbstractFileByPath(path))
      await shot('failed-save')
      await tap(view().containerEl.querySelector('[aria-label="Open in Obsidian Canvas"]'))
      await until(()=>document.querySelector('.abele-canvas-choice'),'handoff confirmation')
      await shot('native-handoff')
      await tap([...document.querySelectorAll('.abele-canvas-choice button')].find(el=>el.textContent==='Retain draft and open native'))
      await until(()=>app.workspace.getLeavesOfType('canvas').some(leaf=>leaf.view.file?.path===path),'native editor')
      const native=true
      app.vault.process=window.__humanCanvas.process;delete window.__humanCanvas.process
      const nativeLeaf=app.workspace.getLeavesOfType('canvas').find(leaf=>leaf.view.file?.path===path)
      // Close and reopen is navigation, not a canvas edit. Wait for the native unload to finish.
      nativeLeaf.detach();await wait(500)
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf)
      await until(()=>view()?.editor,'reopened editor')
      const retained=view().viewer.graph.nodes.some(node=>node.text==='Retained human text'),reopened=retained&&!button('Retry save').disabled
      await tap(button('Retry save'));await wait(500)
      const saved=(await read()).nodes.some(node=>node.text==='Retained human text')
      await shot('reopened-saved')
      return {unsaved,sourceSame,retained,native,reopened,saved}
    `)
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
    const result = await input<{
      retained: boolean
      blocked: boolean
      sourceSame: boolean
      discarded: boolean
    }>(`
      const file=app.vault.getAbstractFileByPath(path),before=await app.vault.read(file)
      const retained=view().viewer.graph.nodes.some(node=>node.text==='Retained human text')
      const blocked=button('Retry save').disabled && view().contentEl.textContent.includes('source changed')
      await tap(button('Discard local draft'));await until(()=>document.querySelector('.abele-canvas-choice'),'discard confirmation')
      await tap([...document.querySelectorAll('.abele-canvas-choice button')].find(el=>el.textContent==='Discard local draft'))
      await until(()=>!view().documentLease.document.session.dirty,'discarded')
      return {retained,blocked,sourceSame:before===await app.vault.read(file),discarded:!view().viewer.graph.nodes.some(node=>node.text==='Retained human text')}
    `)
    expect(result).toEqual({ retained: true, blocked: true, sourceSame: true, discarded: true })
  }, 120_000)
})
