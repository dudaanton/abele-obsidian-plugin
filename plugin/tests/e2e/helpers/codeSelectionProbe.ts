import { WAIT_PRELUDE } from './wait'

/** Kept separate so every emitted browser program can be parsed without driving the app. */
export const codeSelectionScript = (body: string): string => `(async()=>{
  ${WAIT_PRELUDE}
  const api=window.__abeleTest, chats=api.ChatService.getInstance(), state=window.__codeSelectionRun;
  try { ${body} } catch(error) { return JSON.stringify({error:String(error.message||error),stack:String(error.stack||'')}) }
})()`

export const selectionWindowInfo = codeSelectionScript(
  `return JSON.stringify({size:require('@electron/remote').getCurrentWindow().getContentSize(),mobile:app.isMobile})`
)
export const selectionResize = (width: number, height: number) =>
  codeSelectionScript(
    `require('@electron/remote').getCurrentWindow().setContentSize(${width},${height});return JSON.stringify({sized:true})`
  )
export const selectionEmulation = (mobile: boolean) => `app.emulateMobile(${mobile})`

export const selectionSetup = (directory: string) =>
  codeSelectionScript(String.raw`
  if(state)throw Error('Selection fixture already owns the app');
  const config=api.AbeleConfig.getInstance();
  const saved=window.__codeSelectionRun={directory:${JSON.stringify(directory)},ownsDirectory:false,
    layout:app.workspace.getLayout(),ai:config.ai.enabled,native:app.vault.getConfig('nativeMenus'),
    activeChat:chats.activeTabId.value,openBlank:chats.openBlankChat,pending:chats.pendingInput.value,
    ownedChats:[],existingChats:chats.tabOrder.value.slice(),nodeSelections:[],source:null,extension:null,word:'sampleValue',actionError:null};
  if(app.vault.getAbstractFileByPath(saved.directory))throw Error('Fixture directory collision');
  await app.vault.createFolder(saved.directory);saved.ownsDirectory=true;
  await app.vault.create(saved.directory+'/destination.md','# Sample destination\n');
  await app.vault.create(saved.directory+'/sample.ts','export const sampleValue = 42\n');
  // Allocate owned drafts instead of resetting an existing blank chat from the saved layout.
  chats.openBlankChat=async()=>{const id=chats.createTab();const session=chats.getSession(id);
    if(!session||saved.existingChats.includes(id))throw Error('No room for an owned selection test chat');saved.ownedChats.push(id);return session};
  config.ai.enabled=true;app.vault.setConfig('nativeMenus',false);
  return JSON.stringify({ready:true});
`)

export const selectionCleanup = codeSelectionScript(String.raw`
  if(!state)return JSON.stringify({clean:true});
  state.extension?.destroy();window.getSelection()?.removeAllRanges();
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  try {
    for(const id of state.ownedChats){const session=chats.getSession(id);if(!session)continue;
      session.draft.value={text:'',attachments:[]};
      if(!await chats.deleteChat(id))await chats.closeTab(id);
    }
    chats.pendingInput.value=state.pending;
    if(state.activeChat&&chats.getSession(state.activeChat))chats.switchTab(state.activeChat);
    await app.workspace.changeLayout(state.layout);
    for(const old of state.nodeSelections){old.model.selected.value=old.selected;old.model.selectedChat.value=old.chat}
    if(state.ownsDirectory){const folder=app.vault.getAbstractFileByPath(state.directory);if(folder)await app.vault.delete(folder,true)}
  } finally {
    chats.openBlankChat=state.openBlank;
    api.AbeleConfig.getInstance().ai.enabled=state.ai;
    app.vault.setConfig('nativeMenus',state.native);
    delete window.__codeSelectionRun;
    await app.workspace.requestSaveLayout.run();
  }
  return JSON.stringify({clean:true});
`)

export const openSelectionSource = (surface: 'debugger' | 'node-or-local' | 'github', url = '') =>
  codeSelectionScript(String.raw`
  state.extension?.destroy();state.extension=null;state.surface=${JSON.stringify(surface)};
  const note=app.workspace.getLeaf('tab');
  await note.setViewState({type:'markdown',state:{file:state.directory+'/destination.md',mode:'source'},active:true});
  state.note=note;
  let leaf=app.workspace.getLeaf('tab');state.word='sampleValue';state.node=false;
  if(state.surface==='github'){
    await leaf.setViewState({type:'abele-github',state:{url:${JSON.stringify(url)}},active:true});state.word='formatValue';
  }else if(state.surface==='debugger'){
    await leaf.setViewState({type:'empty',active:true});
    leaf.view.contentEl.empty();const host=leaf.view.contentEl.createDiv();
    state.extension=api.mountDebugSource(host,{registrationId:'sample-selection-node',conversationId:'sample-selection-chat',
      sourceId:'sample-selection-source',debugSessionId:'sample-selection-debug',incarnation:'sample-selection-build',
      path:'sample.ts',text:'export const sampleValue = 42\n'},(action,words)=>{
      const selected={text:words.text,from:words.from,to:words.to,side:'after'};
      if(action==='note')api.codeSelectionAdapters.note(app,words.path,selected);
      else api.codeSelectionAdapters.chat(action,words.path,selected).catch(error=>state.actionError=String(error));
    });
  }else{
    // Only an already-open non-executing fixture node is eligible. Never browse unrelated nodes.
    const nodes=api.NodeService.getInstance();
    for(const candidate of app.workspace.getLeavesOfType('abele-node-file')){
      const fileState=candidate.getViewState().state,registration=fileState?.target?.registrationId;
      if(!registration||fileState.debug||!candidate.view.containerEl.querySelector('.abele-file-view .cm-content'))continue;
      const connection=nodes.connection(registration);if(connection.state.value!=='connected')continue;
      const description=await connection.client.describe();
      if(!description.providers?.some(p=>p.provider==='fake'&&p.available!==false))continue;
      const text=candidate.view.containerEl.querySelector('.cm-content').textContent;
      if(!text.includes('sample'))continue;
      const model=api.NodePathService.getInstance().model(registration);
      state.nodeSelections.push({model,selected:model.selected.value,chat:model.selectedChat.value});
      await leaf.setViewState({type:'abele-node-file',state:structuredClone(fileState),active:true});
      if(leaf.view.file)leaf.view.file.mode.value='file';
      state.node=true;state.nodeRegistration=registration;state.word=text.match(/\b\w*sample\w*\b/i)[0];break;
    }
    if(!state.node)await leaf.setViewState({type:'abele-code',state:{file:state.directory+'/sample.ts'},active:true});
  }
  state.source=leaf;
  const code=await until(()=>leaf.view.containerEl.querySelector('.cm-content'),15000);
  if(!code)throw Error('Source code did not mount');
  return JSON.stringify({node:state.node,surface:state.node?'node':state.surface==='node-or-local'?'local':state.surface});
`)

export const wordCoordinates = codeSelectionScript(String.raw`
  window.getSelection()?.removeAllRanges();
  app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse();
  app.workspace.setActiveLeaf(state.source,{focus:true});
  const root=state.source.view.containerEl;
  const content=await until(()=>root.querySelector('.cm-content'),10000);
  if(!content)throw Error('No code content');
  const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);let text;
  while(text=walker.nextNode()){if(text.data.includes(state.word))break}
  if(!text)throw Error('Sample word missing from code');
  text.parentElement.scrollIntoView({block:'center'});await wait(150);
  const start=text.data.indexOf(state.word),end=start+state.word.length;
  const box=index=>{const range=document.createRange();range.setStart(text,index);range.setEnd(text,index+1);return range.getBoundingClientRect()};
  const first=box(start),last=box(end-1);
  return JSON.stringify({word:state.word,from:{x:Math.round(first.left+1),y:Math.round(first.top+first.height/2)},
    to:{x:Math.round(last.right-1),y:Math.round(last.top+last.height/2)}});
`)

export const readSelectionBar = codeSelectionScript(String.raw`
  const bar=await until(()=>document.querySelector('.abele-selection-bar_placed'),5000);
  if(!bar)throw Error('No selection bar: '+String(window.getSelection()));
  const box=bar.getBoundingClientRect();
  const actions=[...bar.querySelectorAll('[data-action]')].map(el=>({id:el.dataset.action,
    icon:[...(el.querySelector('svg')?.classList??[])].find(name=>name.startsWith('lucide-'))?.slice(7)}));
  return JSON.stringify({actions,text:String(window.getSelection()),visible:box.width>0&&box.left>=0&&box.right<=innerWidth+1&&box.top>=0&&box.bottom<=innerHeight+1});
`)

export const actionCoordinates = (action: string) =>
  codeSelectionScript(String.raw`
  const button=document.querySelector('.abele-selection-bar_placed [data-action='+${JSON.stringify(action)}+']');
  if(!button)throw Error('Selection action absent');
  const box=button.getBoundingClientRect();return JSON.stringify({x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)});
`)

export const selectionMenu = codeSelectionScript(String.raw`
  await wait(400);
  const items=[...document.querySelectorAll('.menu-item')].map(el=>el.textContent.trim());
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  return JSON.stringify({items});
`)

export const prepareSelectionAction = (action: 'ask' | 'add' | 'note') =>
  codeSelectionScript(String.raw`
  state.actionError=null;
  if(${JSON.stringify(action)}==='add'){
    const session=await chats.openBlankChat();state.addId=session.id;
    state.addTitle='Sample selection destination '+session.id;session.chatTitle.value=state.addTitle;
    await chats.revealSidebar();
    const input=await until(()=>{const input=api.composer();return input&&input.get()===''?input:null},8000);
    if(!input)throw Error('No empty owned add destination');input.set('Existing draft\n');
  }
  if(${JSON.stringify(action)}==='note'){
    await app.workspace.setActiveLeaf(state.note,{focus:true});
    state.note.view.editor.setValue('# Sample destination\n');
    state.note.view.editor.setCursor({line:1,ch:0});
    state.noteBefore=state.note.view.editor.getValue();
  }
  return JSON.stringify({ready:true});
`)

export const checkSelectionDestination = (action: 'ask' | 'add' | 'note') =>
  codeSelectionScript(String.raw`
  if(state.node&&${JSON.stringify(action)}==='ask'){
    const provider=await until(()=>[...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes('Fake (non-executing)')),8000);
    if(!provider)throw Error('No fake provider in node fixture');provider.click();
    const approve=await until(()=>[...document.querySelectorAll('.modal button')].find(el=>el.textContent.trim()==='Allow execution'),8000);
    if(!approve)throw Error('No explicit fixture execution approval');approve.click();
  }
  if(state.node&&${JSON.stringify(action)}==='add'){
    const choice=await until(()=>[...document.querySelectorAll('.suggestion-item')].find(el=>el.textContent.includes(state.addTitle)),8000);
    if(!choice)throw Error('No owned chat in the node picker');choice.click();
  }
  if(${JSON.stringify(action)}==='note'){
    const text=await until(()=>{const text=state.note.view.editor.getValue();return text!==state.noteBefore&&text.includes(state.word)?text:null},8000);
    if(!text)throw Error('Selected words never reached the note');
    return JSON.stringify({text});
  }
  const input=await until(()=>{const root=state.node&&${JSON.stringify(action)}==='ask'
    ?app.workspace.getLeavesOfType('abele-node-chat').at(-1)?.view.containerEl:document;
    const input=root&&api.composer(root);return input?.get().includes(state.word)?input:null},15000);
  if(state.actionError)throw Error(state.actionError);
  if(!input)throw Error('Selected words never reached the chat draft');
  return JSON.stringify({text:input.get(),tabId:chats.activeTabId.value,addId:state.addId});
`)

export const selectionShot = (path: string) =>
  codeSelectionScript(String.raw`
  const fs=require('fs');fs.mkdirSync(require('path').dirname(${JSON.stringify(path)}),{recursive:true});
  const image=await require('@electron/remote').getCurrentWebContents().capturePage();
  fs.writeFileSync(${JSON.stringify(path)},image.toPNG());
  return JSON.stringify({saved:true,width:innerWidth,height:innerHeight});
`)
