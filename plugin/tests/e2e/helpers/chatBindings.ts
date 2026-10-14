import { randomUUID } from 'node:crypto'
import { SCRIPT_FIXTURE } from './scriptFixture'

export const BINDING_DIR = 'Sample binding probe-' + randomUUID()
export const BINDING_CHAT = `${BINDING_DIR}/source.abchat`
export const BINDING_CARD = `${BINDING_DIR}/Cards/A sample card with a deliberately long descriptive title.md`
const script = `// @name Sample bind captured words
// @chat-selection
const card = await create(${JSON.stringify(BINDING_CARD)}, selection.text + '\\n\\n' + selection.backlink)
return await selection.bind(card)`

const bindingSetup = `
  ${SCRIPT_FIXTURE}
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const chats = window.__abeleTest.ChatService.getInstance()
  // A run whose cleanup never ran left its probe folder, and the scripts settings pointing into
  // it, as the vault's baseline: the next snapshot would restore that state forever. Sweep it,
  // but never this run's own directory: whether that one may be touched is decided below.
  const bindingStale = app.vault.getRoot().children.filter(f => f.name.startsWith('Sample binding probe-') && f.path !== ${JSON.stringify(BINDING_DIR)})
  if (/^Sample binding probe-/.test(config.ai.scriptsFolder || '') && !(config.ai.scriptsFolder + '/').startsWith(${JSON.stringify(BINDING_DIR + '/')})) {
    config.ai = { ...config.ai, scriptsEnabled: false, scriptsFolder: '', confirmForeignScripts: false,
      startupScripts: [], startupScriptsPaused: false, toolbarScripts: [] }
    config.version.value++
    await config.saveSettings()
  }
  for (const folder of bindingStale) await app.vault.delete(folder, true)
  if (bindingStale.length) {
    console.info('[binding fixture] removed stale probes', JSON.stringify(bindingStale.map(f => f.path)))
    await window.__abeleTest.ScriptService.getInstance().discover()
  }
  const bindingOld = { scripts:await saveScriptFixture(), native:app.vault.getConfig('nativeMenus') ?? null, directory:${JSON.stringify(BINDING_DIR)}, ownsDirectory:false }
  window.__bindingOld = bindingOld
  try {
  app.vault.setConfig('nativeMenus',false)
  if(app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_DIR)}))throw Error('Binding fixture already exists')
  await app.vault.createFolder(${JSON.stringify(BINDING_DIR)})
  bindingOld.ownsDirectory=true
  await app.vault.createFolder(${JSON.stringify(BINDING_DIR + '/Cards')})
  await app.vault.createFolder(${JSON.stringify(BINDING_DIR + '/Scripts')})
  await app.vault.create(${JSON.stringify(BINDING_CHAT)},[
    {v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',created:'',title:'Sample binding source'},
    {k:'msg',id:'sample-reply',role:'assistant',content:'echo **echo**',timestamp:1}
  ].map(JSON.stringify).join('\\n')+'\\n')
  await enableScriptFixture(${JSON.stringify(BINDING_DIR + '/Scripts')})
  await app.vault.create(${JSON.stringify(BINDING_DIR + '/Scripts/bind.js')},${JSON.stringify(script)})
  await window.__abeleTest.ScriptService.getInstance().discover()
  await approveScriptFixture(${JSON.stringify(BINDING_DIR + '/Scripts/bind.js')},${JSON.stringify(script)})
  await chats.openChatFile(app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CHAT)}));await chats.revealSidebar()
`

export const BINDING_RESET = `
  document.getSelection()?.removeAllRanges()
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
  const chats=window.__abeleTest.ChatService.getInstance()
  const owner=chats.getSessionByFile(${JSON.stringify(BINDING_CHAT)})
  if(owner)await chats.closeTab(owner.id)
  const card=app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CARD)})
  if(card)await app.vault.delete(card)
  const file=app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_CHAT)})
  await app.vault.modify(file,[
    {v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',created:'',title:'Sample binding source'},
    {k:'msg',id:'sample-reply',role:'assistant',content:'echo **echo**',timestamp:1}
  ].map(JSON.stringify).join('\\n')+'\\n')
  await chats.openChatFile(file);await chats.revealSidebar({focus:false})
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
    const storage=window.__abeleTest.ChatStorage.getInstance()
    const rewrite=storage.rewriteDiscussion.bind(storage)
    let injected=false
    if(fail)storage.rewriteDiscussion=async(file,content,...args)=>{
      const records=content.trim().split('\\n').map(JSON.parse)
      if(!injected && file.path===${JSON.stringify(BINDING_CHAT)} && records.some(r=>r.k==='msg' && r.decorationOperations?.some(op=>op.targetPath===${JSON.stringify(BINDING_CARD)} && !op.undoneAt))){
        injected=true
        throw Error('Sample known-no-write publication failure')
      }
      return rewrite(file,content,...args)
    }
    try {
      const outcome=await window.__abeleTest.ScriptService.getInstance().executeFromSelection(${JSON.stringify(BINDING_DIR + '/Scripts/bind.js')},target)
      if(outcome.status!=='done')throw Error('Sample binding launch did not complete')
      return JSON.parse(outcome.output)
    } finally {if(fail)storage.rewriteDiscussion=rewrite}
  }
`

export const BINDING_CLEANUP = `
  ${SCRIPT_FIXTURE}
  document.getSelection()?.removeAllRanges()
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
  const owner=window.__abeleTest.ChatService.getInstance().getSessionByFile(${JSON.stringify(BINDING_CHAT)})
  if(owner)await window.__abeleTest.ChatService.getInstance().closeTab(owner.id)
  const old=window.__bindingOld
  if(old?.directory===${JSON.stringify(BINDING_DIR)}){
    const folder=app.vault.getAbstractFileByPath(${JSON.stringify(BINDING_DIR)});if(folder&&old.ownsDirectory)await app.vault.delete(folder,true)
    await restoreScriptFixture(old.scripts)
    app.vault.setConfig('nativeMenus',old.native)
    delete window.__bindingOld
  }
`

// Setup owns partial creation too: failure before returning the snapshot must clean up.
export const BINDING_SETUP =
  bindingSetup +
  `
  } catch(error) {
    ${BINDING_CLEANUP}
    throw error
  }
`
