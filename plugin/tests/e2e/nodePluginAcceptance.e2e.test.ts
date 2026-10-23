import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('node-plugin-acceptance')

it.each([false, true])(
  'shows refused staging and worktree creation progress, phone: %s',
  async (phone) => {
    const probe = async () =>
      JSON.parse(
        await evalLong(`(async () => {
    ${NODE_PANEL_FIXTURE}
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async fn => { for (let i=0;i<120;i++) { const value=fn();if(value)return value;await wait(50) } throw Error('Acceptance state missing: '+fn.toString()) };
    const shot = async name => {
      await wait(500);
      const path=${JSON.stringify(shots)}+'/'+${JSON.stringify(phone ? 'phone' : 'desktop')}+'-'+name+'.png';
      require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
    };
    let finish,fileLeaf;
    try {
      nodePanel.variant.git=true;
      const panel=await nodePanel.open('feature');
      const state=window.__abeleNodePanelFixture,model=state.model,client=state.nodes.connections.get(state.registration.id).client;
      const storage=await client.store.transaction(current=>({...current,node_id:'sample-panel-node',installation_id:'sample-plugin-installation'}));
      client.store.transaction=async work=>work(storage);
      client.repository.gitWrites.stage=async()=>{throw Object.assign(new Error('resource_busy'),{code:'resource_busy'})};
      try { await model.stage('all') } catch(error) { model.report(error) }
      await until(()=>panel.textContent.includes('Could not stage the files'));
      await shot('stage-busy');
      client.repository.gitWrites.stage=async()=>({state:'applied'});
      await model.stage('all');
      await until(()=>!model.error.value);
      await shot('stage-recovered');
      client.nodePath.execution=async()=>{throw Object.assign(new Error('resource_busy'),{code:'resource_busy'})};
      const agents=await nodePanel.newChat();
      [...agents.querySelectorAll('.suggestion-item')].find(item=>item.textContent.includes('pi')).click();
      await until(()=>[...document.querySelectorAll('.notice')].some(notice=>notice.textContent.includes('Could not start a new chat')));
      await shot('new-chat-busy');
      document.querySelectorAll('.notice').forEach(notice=>notice.click());
      client.repository.editingStatus=async()=>({enabled:true});
      const initialBlob=client.repository.blob;
      client.repository.blob=async()=>({...await initialBlob(),content_id:'1'.repeat(64)});
      fileLeaf=app.workspace.getLeaf('tab');
      await fileLeaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{...model.current.value},path:'src/sample-panel.ts'}});
      await fileLeaf.loadIfDeferred?.();await app.workspace.revealLeaf(fileLeaf);
      if(${phone}){app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()}
      await until(()=>fileLeaf.view.file?.document.value);
      fileLeaf.view.file.mode.value='file';
      fileLeaf.view.fileTab.start();
      await until(()=>fileLeaf.view.editing?.editor.value?.editing.value);
      const blob=client.repository.blob;
      client.repository.blob=async()=>{throw Object.assign(new Error('resource_busy'),{code:'resource_busy'})};
      fileLeaf.view.fileTab.stop();
      await until(()=>fileLeaf.view.contentEl.textContent.includes('Editing stopped.'));
      await shot('stop-editing-busy');
      let changedText='export const sample = false'+String.fromCharCode(10);
      const changedPatch=()=>changedText.includes('"external"')?['@@ -1 +1 @@','-export const sample = false','+export const sample = "external"',''].join(String.fromCharCode(10)):'';
      client.repository.patch=async()=>({content_id:'sample-refresh-patch',size:changedPatch().length,binary:false,requires_larger_load:false,too_large:false});
      client.repository.content=async request=>{const text=request.content_id==='sample-refresh-patch'?changedPatch():changedText;return {offset:0,total:text.length,base64:btoa(text)}};
      client.repository.blob=async()=>({...await blob(),content_id:'2'.repeat(64),size:changedText.length});
      await model.reloadTarget(model.current.value);
      await until(()=>fileLeaf.view.file.document.value.text.includes('false'));
      document.querySelectorAll('.notice').forEach(notice=>notice.click());
      await shot('file-refreshed');
      fileLeaf.view.fileTab.start();await until(()=>fileLeaf.view.editing.editor.value?.editing.value);
      const editor=fileLeaf.view.editing.editor.value;
      await editor.editText('export const sample = "local"'+String.fromCharCode(10));
      changedText='export const sample = "external"'+String.fromCharCode(10);
      client.repository.blob=async()=>({...await blob(),content_id:'3'.repeat(64),size:changedText.length});
      await model.reloadTarget(model.current.value);
      await until(()=>editor.document.value?.contentId==='3'.repeat(64)&&fileLeaf.view.contentEl.textContent.includes('Changed on the node while you edited.'));
      if(!editor.draftText.value.includes('local'))throw Error('External change replaced local draft');
      await shot('editor-changed-on-disk');
      fileLeaf.detach();fileLeaf=null;
      await nodePanel.select('feature');
      client.nodePath.createWorkspace=async()=>({job_id:'sample-create-job'});
      client.getJob=()=>new Promise(resolve=>{finish=resolve});
      const menu=await nodePanel.menu();
      [...menu.querySelectorAll('.menu-item')].find(item=>item.textContent.trim().startsWith('New worktree')).click();
      const input=await until(()=>document.querySelector('.abele-worktree-dialog input'));
      input.value='sample-progress';input.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(50);
      [...document.querySelectorAll('.abele-worktree-dialog button')].find(button=>button.textContent.trim()==='Create').click();
      await until(()=>document.querySelector('.abele-worktree-dialog button[aria-busy="true"]'));
      await until(()=>finish);
      await shot('worktree-creating');
      finish({state:'failed',error:'sample_creation_refused'});finish=null;
      await until(()=>!document.querySelector('.abele-worktree-dialog'));
      return JSON.stringify({cleared:!model.error.value,finished:true});
    } finally {
      finish?.({state:'failed',error:'sample_creation_refused'});
      fileLeaf?.detach();
      document.querySelector('.abele-worktree-dialog')?.closest('.modal-container')?.querySelector('.modal-close-button')?.click();
      await nodePanel.close();
    }
  })()`)
      )
    const result = phone ? await withEmulatedPhone(probe) : await probe()
    expect(result).toEqual({ cleared: true, finished: true })
  },
  90000
)
