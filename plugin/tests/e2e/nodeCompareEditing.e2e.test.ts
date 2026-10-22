import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

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
      let current = 'export const sample = true\\n'
      const original = 'export const sample = false\\n'
      const hash = text => require('crypto').createHash('sha256').update(text).digest('hex')
      const state = { node_id: registration.expectedNodeId, installation_id: 'sample-installation', events: {}, results: {}, outbox: [] }
      client.store.transaction = async fn => fn(state)
      client.repository.editingStatus = async () => ({ enabled: true })
      client.repository.blob = async () => ({ content_id: hash(current), size: current.length, binary: false, requires_larger_load: false, too_large: false })
      client.repository.patch = async () => ({ content_id: 'sample-patch', size: 100, binary: false, requires_larger_load: false, too_large: false })
      client.repository.content = async ({content_id}) => {
        const text = content_id === 'sample-patch' ? '@@ -1 +1 @@\\n-'+original.trimEnd()+'\\n+'+current.trimEnd()+'\\n' : current
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
        await until(()=>root().querySelector('.abele-code-change'))
      }
      await shot('unified')
      const editor = () => api.codeView(root().querySelector('.cm-content[contenteditable="true"]'))
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

it('edits, saves and rejects stale comparison writes on desktop', () => {
  expect(probe('desktop')).toBe(true)
})

it('edits the unified working comparison in the phone layout', async () => {
  expect(await withEmulatedPhone(async () => probe('phone'))).toBe(true)
})
