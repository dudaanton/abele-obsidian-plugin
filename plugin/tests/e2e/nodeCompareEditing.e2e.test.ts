import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { withNativeInput } from './helpers/nativeInput'

targets('desktop')
const SHOTS = shotDir('abele-compare-editing')

function probe(device: string) {
  return evalAsync<boolean>(`(async () => {
    const api = window.__abeleTest
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async fn => { for(let n=0;n<200;n++){if(fn())return;await wait(50)}throw Error('Compare editor did not settle: '+fn) }
    ${NODE_PANEL_FIXTURE}
    let leaf
    try {
      await nodePanel.open('feature')
      const { registration } = window.__abeleNodePanelFixture
      const client = api.NodeService.getInstance().connection(registration.id).client
      const original = Array.from({length:220},(_,i)=>'export const sample'+i+' = '+i).join('\\n')+'\\n'
      const working = original.trimEnd().split('\\n')
      working[10] = 'export const sample10 = 999'
      working.splice(40,1)
      working.splice(100,0,'export const inserted = true')
      working[175] = 'export const sample175 = 888'
      let current = working.join('\\n')+'\\n'
      const hash = text => require('crypto').createHash('sha256').update(text).digest('hex')
      const state = { node_id: registration.expectedNodeId, installation_id: 'sample-installation', events: {}, results: {}, outbox: [] }
      client.store.transaction = async fn => fn(state)
      client.repository.editingStatus = async () => ({ enabled: true })
      client.repository.blob = async () => ({ content_id: hash(current), size: current.length, binary: false, requires_larger_load: false, too_large: false })
      client.repository.patch = async () => ({ content_id: 'sample-patch', size: 100, binary: false, requires_larger_load: false, too_large: false })
      client.repository.content = async ({content_id}) => {
        const text = content_id === 'sample-patch' ? '@@ -1,220 +1,'+current.trimEnd().split('\\n').length+' @@\\n'+original.trimEnd().split('\\n').map(line=>'-'+line).join('\\n')+'\\n'+current.trimEnd().split('\\n').map(line=>'+'+line).join('\\n')+'\\n' : current
        return {offset:0,total:text.length,base64:btoa(text)}
      }
      const receipts = new Map()
      client.operationResult = async operation_id => receipts.has(operation_id) ? {result:receipts.get(operation_id)} : undefined
      client.flush = async () => {
        for(const entry of state.outbox.splice(0)) await client.repository.write(entry.params,entry.operation_id)
      }
      client.repository.write = async (params, operation_id) => {
        const previous = hash(current), saved = params.expected_content_id === previous
        if(saved) current = params.text
        receipts.set(operation_id, {operation_id,worktree_id:params.worktree_id,path:params.path,state:saved?'saved':'conflict',expected_content_id:params.expected_content_id,content_id:hash(current),predecessor_content_id:previous,recovery_path:null})
        return {operation_id}
      }
      client.repository.mutationResult = async operation_id => receipts.get(operation_id)
      const target = {nodeId:registration.expectedNodeId,registrationId:registration.id,projectId:'sample-repository-project',kind:'worktree',id:'sample-feature-worktree'}
      leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target,path:'src/sample-panel.ts',stage:'unstaged'}})
      await app.workspace.revealLeaf(leaf)
      app.workspace.setActiveLeaf(leaf,{focus:true})
      app.workspace.leftSplit.collapse()
      const root = () => leaf.view.contentEl
      const action = label => leaf.containerEl.querySelector('.view-action[aria-label="'+label+'"]')
      const shot = async name => {
        await wait(250)
        require('fs').writeFileSync(${JSON.stringify(SHOTS)}+'/'+${JSON.stringify(device)}+'-'+name+'.png',(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
      }
      await until(()=>root().querySelector('.abele-diff'))
      if(${JSON.stringify(device)} === 'desktop') {
        await until(()=>action('Edit the file'))
        action('Edit the file').click()
      } else leaf.view.fileTab.start()
      await until(()=>root().querySelector('.abele-diff .cm-content[contenteditable="true"]'))
      if(${JSON.stringify(device)} === 'desktop') {
        await until(()=>root().querySelectorAll('.cm-mergeView .cm-editor').length===2)
        if(root().querySelector('.cm-merge-a .cm-content').contentEditable!=='false')throw Error('Old side editable')
        await shot('split')
        root().querySelector('.abele-diff__actions [aria-label="One under the other"]')?.click()
        await until(()=>root().querySelector('.cm-deletedChunk'))
      }
      await until(()=>root().querySelector('.cm-deletedChunk'))
      if(root().querySelector('.abele-code-change'))throw Error('Plain editor gutter returned')
      await shot('unified')
      const editor = () => api.codeView(root().querySelector('.cm-content[contenteditable="true"]'))
      const added = editor().state.doc.line(11)
      editor().dispatch({changes:{from:added.to,to:added.to,insert:'0'},selection:{anchor:added.to}})
      editor().focus()
      await until(()=>leaf.view.editing.dirty.value)
      await shot('inline-caret')
      await until(()=>document.querySelector('.abele-change-overview__band'))
      await shot('long-overview')
      const strip = document.querySelector('.abele-change-overview')
      strip.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))
      await wait(250)
      if(Number(strip.getAttribute('aria-valuenow'))<20)throw Error('Overview did not navigate')
      await shot('overview-scrolled')
      if(${JSON.stringify(device)} === 'desktop') {
        const mark = strip.querySelector('.abele-change-overview__mark_changed')
        const box = mark.getBoundingClientRect()
        const cdp = require('@electron/remote').getCurrentWebContents().debugger
        const owned = !cdp.isAttached()
        if(owned)cdp.attach('1.3')
        try {
          await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.left+box.width/2,y:box.top+box.height/2,button:'none'})
          await until(()=>[...document.querySelectorAll('.tooltip')].some(el=>el.textContent.includes('Lines')))
          await shot('overview-tooltip')
          await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:20,button:'none'})
        } finally {if(owned)cdp.detach()}
      }
      strip.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))
      await wait(250)
      const enter = text => editor().dispatch({changes:{from:0,to:editor().state.doc.length,insert:text}})
      enter('export const sample = 7\\n')
      await until(()=>leaf.view.editing.dirty.value)
      await shot('unsaved')
      await leaf.view.editing.save()
      await until(()=>!leaf.view.editing.dirty.value)
      if(current!=='export const sample = 7\\n')throw Error('Working edit not saved')
      if(!root().querySelector('.abele-diff'))throw Error('Comparison lost after save')
      enter('export const sample = 8\\n')
      await until(()=>leaf.view.editing.dirty.value)
      current='export const sample = 9\\n'
      await leaf.view.editing.save()
      await until(()=>root().textContent.includes('Conflict'))
      if(current!=='export const sample = 9\\n')throw Error('Stale write replaced current file')
      await shot('conflict')
      await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target,path:'src/sample-committed.ts',stage:{kind:'committed',base:'main'}}})
      await until(()=>root().querySelector('.abele-diff'))
      if(action('Edit the file'))throw Error('Historical comparison offers editing')
      await shot('read-only')
      return true
    } finally {
      leaf?.detach()
      await nodePanel.close()
    }
  })()`)
}

it('edits, saves and rejects stale comparison writes on desktop', async () => {
  expect(await withNativeInput(() => probe('desktop'))).toBe(true)
})

it('edits the unified working comparison in the phone layout', async () => {
  expect(await withEmulatedPhone(async () => probe('phone'))).toBe(true)
})
