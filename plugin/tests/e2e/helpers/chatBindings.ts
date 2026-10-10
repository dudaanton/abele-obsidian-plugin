export const BINDING_DIR = 'Sample binding probe'
export const BINDING_CHAT = `${BINDING_DIR}/source.abchat`
export const BINDING_CARD = `${BINDING_DIR}/Cards/A sample card with a deliberately long descriptive title.md`
const script = `// @name Sample bind captured words
// @chat-selection
const card = await create(${JSON.stringify(BINDING_CARD)}, selection.text + '\\n\\n' + selection.backlink)
return await selection.bind(card)`

export const BINDING_SETUP = `
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const chats = window.__abeleTest.ChatService.getInstance()
  const bindingOld = { ai:config.ai, trust:app.loadLocalStorage('abele-script-trust') ?? null, native:app.vault.getConfig('nativeMenus') ?? null }
  app.vault.setConfig('nativeMenus',false)
  window.__bindingOld = bindingOld
  if(app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_DIR)}))throw Error('Binding fixture already exists')
  await app.vault.createFolder(${JSON.stringify(BINDING_DIR)})
  await app.vault.createFolder(${JSON.stringify(BINDING_DIR + '/Cards')})
  await app.vault.createFolder(${JSON.stringify(BINDING_DIR + '/Scripts')})
  await app.vault.create(${JSON.stringify(BINDING_CHAT)},[
    {v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',created:'',title:'Sample binding source'},
    {k:'msg',id:'sample-reply',role:'assistant',content:'echo **echo**',timestamp:1}
  ].map(JSON.stringify).join('\\n')+'\\n')
  config.ai={...config.ai,scriptsEnabled:true,scriptsFolder:${JSON.stringify(BINDING_DIR + '/Scripts')},confirmForeignScripts:false}
  await config.saveSettings()
  window.__abeleTest.ScriptTrust.getInstance().disarm()
  await app.vault.create(${JSON.stringify(BINDING_DIR + '/Scripts/bind.js')},${JSON.stringify(script)})
  await window.__abeleTest.ScriptService.getInstance().discover()
  await chats.openChatFile(app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CHAT)}));await chats.revealSidebar()
`

export const BINDING_PRELUDE = `
  const chats=window.__abeleTest.ChatService.getInstance()
  const owner=chats.getSessionByFile(${JSON.stringify(BINDING_CHAT)})
  const bindSample=async (fail=false)=>{
    const revision=await owner.ensureSelectionRevision('sample-reply',{
      nextId:()=>crypto.randomUUID(),project:()=>({version:'chat-text-v1',text:'echo echo'})
    })
    const snapshot={text:'echo',sentence:'echo echo',title:'Sample binding source',pathHint:${JSON.stringify(BINDING_CHAT)},source:{
      kind:'chat',...revision.reference,role:'assistant',author:'Sample',quote:'echo',range:{space:'rendered',start:5,end:9},projectionVersion:revision.projection.version,context:{before:'echo ',after:''}
    }}
    const target={kind:'chat',snapshot,prepare:async()=>{
      const anchor=await owner.ensureChatAnchor(snapshot)
      return {status:'ready',anchorId:anchor.id,backlink:'[['+${JSON.stringify(BINDING_CHAT)}+'#abele-selection='+encodeURIComponent(revision.reference.chatId)+'/'+encodeURIComponent(anchor.id)+'|Return to selection]]'}
    }}
    const process=app.vault.process.bind(app.vault)
    let writes=0
    if(fail)app.vault.process=async(...args)=>{if(++writes===4)throw Error('Sample known-no-write publication failure');return process(...args)}
    try {
      const outcome=await window.__abeleTest.ScriptService.getInstance().executeFromSelection(${JSON.stringify(BINDING_DIR + '/Scripts/bind.js')},target)
      if(outcome.status!=='done')throw Error('Sample binding launch did not complete')
      return JSON.parse(outcome.output)
    } finally {if(fail)app.vault.process=process}
  }
`

export const BINDING_CLEANUP = `
  document.getSelection()?.removeAllRanges()
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
  const owner=window.__abeleTest.ChatService.getInstance().getSessionByFile(${JSON.stringify(BINDING_CHAT)})
  if(owner)await window.__abeleTest.ChatService.getInstance().closeTab(owner.id)
  const folder=app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_DIR)});if(folder)await app.vault.delete(folder,true)
  const old=window.__bindingOld
  if(old){const config=window.__abeleTest.AbeleConfig.getInstance();config.ai=old.ai;await config.saveSettings();app.saveLocalStorage('abele-script-trust',old.trust);app.vault.setConfig('nativeMenus',old.native);window.__abeleTest.ScriptTrust.reset();await window.__abeleTest.ScriptService.getInstance().discover()}
  delete window.__bindingOld
`
