import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-errors-full')

const probe = (device: string) =>
  evalAsync<number>(
    `(async () => {
  ${NODE_PANEL_FIXTURE}
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(fn,what)=>{for(let i=0;i<160;i++){if(fn())return;await wait(50)}throw Error(what)};
  let leaf, original, originalBranch, count=0;
  const capture=async(name)=>{
    await wait(400);
    require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(device)}+'-'+name+'.png',
      (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
    count++;
  };
  try {
    await nodePanel.open('root');
    const state=window.__abeleNodePanelFixture;
    const connection=state.nodes.connections.get(state.registration.id);
    Object.assign(connection,window.__abeleTest.nodeErrorFixtureState());
    connection.client.channel={channel:{welcome:{methods:['node.log.v1.tail','project.trust']}}};
    const request=connection.client.request.bind(connection.client);
    const time=Date.now();
    let logFailure=false;
    let logPage={
      lines:[
        {time:new Date(time-3000).toISOString(),level:'info',text:'Sample file read accepted',source:'stdout'},
        {time:new Date(time-2000).toISOString(),level:'warn',text:'Sample request is taking longer than expected',source:'stderr'},
        {time:new Date(time).toISOString(),level:'error',text:'Sample Git read reached its time limit',source:'stderr'},
      ],truncated:false,files:[]
    };
    connection.client.request=async(method,params)=>{
      if(method!=='node.log.v1.tail')return request(method,params);
      if(logFailure)throw Error('git_timeout');
      return logPage;
    };
    original=state.model.openFile;
    let code='git_timeout', reads=0;
    state.model.openFile=async()=>{reads++;if(code)throw Error(code);return{path:'sample.ts',text:'export const sample = true',target:state.model.current.value}};
    leaf=app.workspace.getLeaf('tab');
    await leaf.setViewState({type:'abele-node-file',active:true,state:{kind:'file',target:{...state.model.current.value},path:'sample.ts'}});
    await leaf.loadIfDeferred?.();await app.workspace.revealLeaf(leaf);
    app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();
    await until(()=>leaf.view.file && leaf.view.contentEl.querySelector('.abele-state-line'),'File state missing');
    const file=leaf.view.file, pane=leaf.view.contentEl;
    const touch=()=>{state.model.receivedAt.value=Date.now()+count+1};
    const showFile=async(error)=>{
      connection.state.value='connected';connection.error.value='';connection.activity.slowSince.value=0;
      state.model.error.value='';code=error;file.document.value=undefined;
      await file.open('sample.ts').catch(()=>{});touch();
      app.workspace.leftSplit.collapse();await wait(400);
      await until(()=>pane.querySelector('.abele-state-line__text'),'File error missing');
    };
    await capture('01-timeout');
    const retry=[...pane.querySelectorAll('button')].find(button=>button.textContent.trim()==='Retry');
    if(!retry)throw Error('Retry missing');code='';const before=reads;retry.click();
    await until(()=>file.document.value && !file.error.value,'Retry did not reread');
    if(reads!==before+1)throw Error('Retry did not reach the file source exactly once');
    await showFile('git_timeout');
    pane.querySelector('.abele-fold-heading').click();await wait(50);
    const line=pane.querySelector('.abele-state-line'), sentence=line.querySelector('.abele-state-line__text');
    const edge=sentence.getBoundingClientRect().left;
    for(const el of [line.querySelector('button'),line.querySelector('.abele-fold-heading__text'),line.querySelector('.abele-state-line__label'),line.querySelector('a')])
      if(!el||Math.abs(el.getBoundingClientRect().left-edge)>2)throw Error('State line edges differ: '+JSON.stringify({edge,actual:el?.getBoundingClientRect().left}));
    if(line.querySelectorAll('.is-code').length!==1)throw Error('Only Code may use the code font');
    if(${JSON.stringify(device)}==='phone'&&line.querySelector('a').getBoundingClientRect().height<52)throw Error('Phone log link is too short');
    await capture('02-details');
    [...line.querySelectorAll('a')].find(link=>link.textContent==='Node log').click();
    await until(()=>document.querySelector('.abele-node-log__line.is-marked'),'Log did not load and mark the error time');
    await capture('03-log');
    const select=document.querySelector('.abele-node-log select');select.value='warn';select.dispatchEvent(new Event('change',{bubbles:true}));
    await until(()=>document.querySelectorAll('.abele-node-log__line').length===2,'Log filter failed');
    await capture('04-log-warnings');
    const closeLog=async()=>{document.querySelector('.abele-node-log-modal').closest('.modal-container').querySelector('.modal-header-button, .modal-close-button').click();await until(()=>!document.querySelector('.abele-node-log'),'Log did not close')};
    await closeLog();
    code='';await file.open('sample.ts');connection.activity.slowSince.value=Date.now()-10000;touch();
    app.workspace.leftSplit.expand();await until(()=>nodePanel.root().textContent.includes('Waiting…'),'Slow state missing');
    await capture('05-slow');
    connection.activity.slowSince.value=0;connection.state.value='connecting';file.document.value=undefined;file.error.value='offline';touch();
    await until(()=>nodePanel.root().textContent.includes('Reconnecting…'),'Reconnect state missing');
    await capture('06-reconnecting');
    connection.state.value='offline';connection.error.value='connection_lost';touch();
    await until(()=>nodePanel.root().textContent.includes('Reconnect'),'Offline action missing');
    await capture('07-offline');
    app.workspace.leftSplit.collapse();await capture('07-offline-file');
    app.workspace.leftSplit.expand();await wait(400);
    const footer=nodePanel.root().querySelector('[data-connection-status]');footer.querySelector('.abele-fold-heading').click();await wait(50);
    [...footer.querySelectorAll('a')].find(link=>link.textContent==='Node log').click();
    await until(()=>document.querySelector('.abele-node-log__offline'),'Offline log state missing');
    if(document.querySelectorAll('.abele-node-log__line').length!==3)throw Error('Offline log lost its last loaded snapshot');
    await capture('08-log-offline');await closeLog();
    await showFile('project_untrusted');await capture('09-untrusted');
    connection.state.value='offline';connection.error.value='device_identity_mismatch';file.error.value='offline';touch();
    app.workspace.leftSplit.expand();await until(()=>nodePanel.root().textContent.includes('Connect again'),'Pairing action missing');
    await capture('10-pairing');
    await showFile('unsupported_method');await capture('11-old-node');
    for(const [name,error,runState] of [['12-chat-timeout','git_timeout','timed_out'],['13-chat-unknown','outcome_unknown','outcome_unknown']]){
      await window.__abeleTest.openDialog('node-manager-run',{managerRunState:runState,managerReason:error,managerRegistrationId:state.registration.id});
      await until(()=>document.querySelector('.abele-node-manager-run .abele-state-line'),'Command state missing');
      const card=document.querySelector('.abele-node-manager-run');
      if(card.textContent.includes(error))throw Error('Command exposes the raw code outside Original action');
      await capture(name);
      card.closest('.modal-container').querySelector('.modal-header-button, .modal-close-button').click();
      await until(()=>!document.querySelector('.abele-node-manager-run'),'Command fixture did not close');
    }
    for(const [name,error] of [['refused','permission_denied'],['provider-missing','provider_unavailable'],['busy','resource_busy'],['size-limit','file_too_large'],['unknown','sample_future_failure']]){
      await showFile(error);await capture(name);
    }
    for(const mode of ['empty','missing','error','long']){
      await showFile('git_timeout');
      const line=pane.querySelector('.abele-state-line');
      if(!line.querySelector('a'))line.querySelector('.abele-fold-heading').click();
      await until(()=>[...line.querySelectorAll('a')].some(link=>link.textContent==='Node log'),'Log link missing after opening Details');
      logFailure=mode==='error';
      logPage={lines:mode==='long'?[{time:new Date().toISOString(),level:'warn',text:'Sample diagnostic with a long path and message. '.repeat(35),source:'stderr'}]:[],truncated:mode==='long',files:[],reason:mode==='missing'?'logs_missing':'empty'};
      [...line.querySelectorAll('a')].find(link=>link.textContent==='Node log').click();
      await until(()=>document.querySelector('.abele-node-log'),'Log did not open');
      await until(()=>!document.querySelector('.abele-node-log .abele-empty-state_loading'),'Log is still loading');
      if(mode==='error')await until(()=>document.querySelector('.abele-node-log .abele-state-line'),'Log error missing');
      else if(mode==='long')await until(()=>document.querySelector('.abele-node-log__text')?.textContent.includes('Sample diagnostic'),'Long log missing');
      else await until(()=>document.querySelector('.abele-node-log')?.textContent.includes(mode==='missing'?'No log files':'No log entries'),'Empty log state missing');
      await capture('log-'+mode);await closeLog();
    }
    await showFile('git_timeout');
    app.workspace.leftSplit.expand();
    const key=JSON.stringify([state.model.current.value.nodeId,state.model.current.value.kind,state.model.current.value.id]);
    const inspection={...state.model.inspections.value[key],changes:[{path:'sample-retained.ts',kind:'modified',stage:'unstaged'}]};
    originalBranch=state.model.port.branch;
    state.model.port.branch=async()=>({state:{base:'main',ahead:0,behind:0,unpushed:0},committed:[]});
    state.model.panelMode.value='changes';state.model.panelBranch.value=undefined;
    state.model.progress.value={[key]:{state:'reading',count:1240}};
    state.model.inspections.value={};touch();
    await until(()=>nodePanel.root().textContent.includes('Loading changes…'),'Initial loading missing');
    await capture('17-first-load');
    state.model.inspections.value={[key]:inspection};touch();
    await until(()=>nodePanel.root().textContent.includes('Updating changes…'),'Updating footer missing');
    await until(()=>nodePanel.root().querySelector('.abele-file-tree')?.textContent.includes('sample-retained.ts'),'Reload discarded the existing tree');
    await capture('18-updating');
    await until(()=>nodePanel.root().textContent.includes('Still reading the files…'),'Slow loading footer missing');
    if(!nodePanel.root().querySelector('.abele-file-tree')?.textContent.includes('sample-retained.ts'))throw Error('Slow reload discarded the existing tree');
    await capture('19-slow-loading');
    const foot=nodePanel.root().querySelector('[data-connection-footer]');
    [...foot.querySelectorAll('a')].find(link=>link.textContent==='Node log').click();
    await until(()=>document.querySelector('.abele-node-log'),'Loading log link did not open');await closeLog();
    state.model.progress.value={};state.model.inspections.value={[key]:{...inspection,changes:[]}};touch();
    await until(()=>nodePanel.root().querySelector('.abele-file-tree .search-empty-state')?.textContent.trim()==='Nothing changed.','Empty changes missing');
    const root=nodePanel.root(), place=root.querySelector('.abele-node-place'), bar=root.querySelector('.abele-file-tree__bar');
    if(parseFloat(getComputedStyle(bar).paddingTop)<12||parseFloat(getComputedStyle(bar).borderTopWidth)!==0)throw Error('Missing spacing after place row or unexpected hairline');
    const tab=root.querySelector('[role="tab"][aria-label="Changes: none"]');
    if(!tab||tab.textContent.trim())throw Error('Empty changes tab has a count');
    const picker=place.querySelector('.abele-node-place__row');picker.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));picker.focus();
    if(!picker.matches(':focus-visible') && getComputedStyle(picker).boxShadow!=='none')throw Error('Mouse focus left a place ring');
    picker.blur();
    await capture('20-no-changes');
    state.model.panelMode.value='files';touch();
    await until(()=>root.querySelector('.abele-file-tree [role="tree"] .tree-item-self'),'Files tree missing');
    if(root.querySelector('.abele-file-tree')?.textContent.includes('Nothing changed.'))throw Error('Changes empty message leaked into files');
    await capture('20-files');
    return count;
  } finally {
    leaf?.detach();
    const state=window.__abeleNodePanelFixture;if(state&&original)state.model.openFile=original;if(state&&originalBranch)state.model.port.branch=originalBranch;
    await nodePanel.close();
  }
})()`,
    120000
  )

it('shows the approved node error and log states on desktop and phone', async () => {
  expect(await probe('desktop')).toBe(28)
  expect(await withEmulatedPhone(() => probe('phone'))).toBe(28)
}, 240000)
