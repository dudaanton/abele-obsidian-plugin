import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-zip')

/** Synthetic model, real registered/session tool, public native ZIP create and unchanged unzip. */
export const zipProbe = (screenshots: string) => `(async () => {
  const t = window.__abeleTest
  const config = t.AbeleConfig.getInstance(), chats = t.ChatService.getInstance(), registry = t.AgentRegistry.getInstance()
  const aiBefore = JSON.parse(JSON.stringify(config.ai)), tabBefore = chats.activeTabId.value
  const hadSidebar = app.workspace.getLeavesOfType('abele-ai-sidebar-view').length > 0
  const leftClosed = app.workspace.leftSplit?.collapsed, rightClosed = app.workspace.rightSplit?.collapsed
  const fetchBefore = window.fetch
  const DIR = 'Sample ZIP check', ENDPOINT = 'https://sample-zip.invalid/v1'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => { for (let n=0;n<100;n++) { const found=fn(); if(found)return found; await wait(50) } throw new Error('Sample ZIP approval did not appear') }
  const report = {pending:false,saved:false,roundtrip:false,deniedZeroReads:false,collisionZeroReads:false,stopped:false,argumentVisible:false,overflow:0,ticks:0,maxTimerGapMs:0,successScopeOnly:false,grantBeforeNative:true,failedApprovals:[],restored:false}
  let session, tab, created=false, timer
  const source = DIR + '/sample.bin', output = DIR + '/sample.zip'
  const bytes = new Uint8Array(256 * 1024)
  for(let i=0;i<bytes.length;i++) bytes[i]=(i*101+(i>>3))%256
  const textBytes = new TextEncoder().encode('\ufeffSample text\\r\\n')
  const args = {path:output,files:[{path:source,name:'nested/picture.bin'},{path:DIR+'/sample.md'}]}
  let modelArgs=args, phase='success'
  const sse = (delta, finish) => new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:null}]})+'\\n\\n'+'data: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\\n\\n'+'data: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}})
  try {
    if(app.vault.getAbstractFileByPath(DIR)) throw new Error('Sample fixture already exists')
    await app.vault.createFolder(DIR); created=true
    await app.vault.createBinary(source,bytes.buffer)
    await app.vault.createBinary(DIR+'/sample.md',textBytes.buffer)
    await app.vault.createBinary(DIR+'/hidden.bin',new Uint8Array([9]).buffer)
    await app.vault.createBinary(DIR+'/hidden.zip',new Uint8Array([10]).buffer)
    await app.vault.createBinary(DIR+'/hidden.md',new TextEncoder().encode('Unselected sample').buffer)
    config.ai.enabled=true; config.ai.chatFolder=DIR+'/Chats/{{name}}'
    config.ai.providers=[{id:'sample-zip-provider',name:'Sample ZIP provider',baseUrl:ENDPOINT,apiKeyId:'',models:[{id:'sample-model',name:'Sample model',contextWindow:32000,maxTokens:100,supportsReasoning:false}]}]
    window.fetch=(url, options)=> {
      if(!String(url).startsWith(ENDPOINT)) return fetchBefore(url,options)
      const body=JSON.parse(options.body), user=body.messages.findLastIndex(message=>message.role==='user')
      const result=body.messages.slice(user+1).findLast(message=>message.role==='tool')
      return Promise.resolve(result || !body.tools?.length ? sse({content:result?.content || 'Sample answer'},'stop') : sse({tool_calls:[{index:0,id:'sample-zip-'+phase,type:'function',function:{name:'zip',arguments:JSON.stringify(modelArgs)}}]},'tool_calls'))
    }
    const agent=registry.create({name:'Sample ZIP worker',providerId:'sample-zip-provider',modelId:'sample-model',permissionMode:'confirm-all',scope:[{type:'file',path:source},{type:'file',path:DIR+'/sample.md'}]})
    const beforeTabs=new Set(chats.tabOrder.value)
    tab=chats.createTab(); if(beforeTabs.has(tab)) throw new Error('No free sample chat tab')
    session=chats.activeSession.value; session.bindAgent(agent.id)
    await chats.revealSidebar({focus:false})
    await session.sendMessage('Pack the two selected sample files into a ZIP')
    report.pending=session.pendingToolCalls.value[0]?.name==='zip' && !app.vault.getAbstractFileByPath(output)
    const card=await until(()=>document.querySelector('.abele-tool-approval'))
    card.scrollIntoView({block:'center'}); await wait(300)
    report.argumentVisible=card.textContent.includes('nested/picture.bin') && card.textContent.includes('sample.bin')
    const bounds=card.getBoundingClientRect()
    for(const el of card.querySelectorAll('*')) { const r=el.getBoundingClientRect(), style=getComputedStyle(el); if(r.width && style.display!=='none' && style.position!=='absolute') report.overflow=Math.max(report.overflow,r.right-bounds.right) }
    const shot=${JSON.stringify(screenshots)}+'/approval.png'
    if(window.__e2eHost) await window.__e2eHost.shot(shot)
    else { const image=await require('@electron/remote').getCurrentWindow().webContents.capturePage(); require('fs').writeFileSync(shot,image.toPNG()) }
    let last=performance.now()
    timer=setInterval(()=>{const now=performance.now();report.ticks++;report.maxTimerGapMs=Math.max(report.maxTimerGapMs,now-last);last=now},1)
    const scopeBeforeSave=JSON.stringify(session.scopeResolver.entries.value)
    const nativeCreate=app.vault.createBinary
    app.vault.createBinary=(path,...params)=>{if(path===output)report.grantBeforeNative=session.scopeResolver.isInScope(output);return nativeCreate.call(app.vault,path,...params)}
    try {await session.approveToolCall()} finally {app.vault.createBinary=nativeCreate}
    report.successScopeOnly=JSON.stringify(session.scopeResolver.entries.value)===JSON.stringify([...JSON.parse(scopeBeforeSave),{type:'file',path:output}])
    clearInterval(timer); timer=null
    report.saved=!!app.vault.getAbstractFileByPath(output) && session.messages.value.some(m=>m.toolName==='zip' && m.toolResult?.includes('Saved ZIP'))
    const script=t.networkSecurity.buildScriptContext({params:{},signal:new AbortController().signal,logs:[]})
    await script.unzip(output,DIR+'/Extracted')
    const binary=await app.vault.readBinary(app.vault.getAbstractFileByPath(DIR+'/Extracted/nested/picture.bin'))
    const text=await app.vault.readBinary(app.vault.getAbstractFileByPath(DIR+'/Extracted/'+DIR+'/sample.md'))
    report.roundtrip=new Uint8Array(binary).every((v,i)=>v===bytes[i]) && binary.byteLength===bytes.length && new Uint8Array(text).every((v,i)=>v===textBytes[i]) && text.byteLength===textBytes.length
    const zip=session.getTools().find(tool=>tool.name==='zip')
    const originalRead=app.vault.readBinary
    let reads=0
    app.vault.readBinary=(...params)=>{reads++;return originalRead.apply(app.vault,params)}
    try {
      try {await zip.execute('denied',{path:DIR+'/denied.zip',files:[{path:source},{path:DIR+'/hidden.bin'}]},undefined,{approved:true})} catch {}
      report.deniedZeroReads=reads===0 && !app.vault.getAbstractFileByPath(DIR+'/denied.zip') && !session.scopeResolver.isInScope(DIR+'/hidden.bin')
      reads=0
      try {await zip.execute('collision',args,undefined,{approved:true})} catch {}
      report.collisionZeroReads=reads===0
      const stop=new AbortController(); setTimeout(()=>stop.abort(),0)
      try {await zip.execute('stopped',{...args,path:DIR+'/stopped.zip'},stop.signal,{approved:true})} catch {}
      report.stopped=!app.vault.getAbstractFileByPath(DIR+'/stopped.zip')
    } finally {app.vault.readBinary=originalRead}
    // Failures must use the actual confirmation entry point, not approved:true helper calls.
    for(const fault of ['collision','invalid-path','denied-selection','native-failure','pre-issuance-stop']) {
      phase=fault
      const path=fault==='collision'?DIR+'/hidden.zip':fault==='invalid-path'?DIR+'/hidden.md':DIR+'/approval-'+fault+'.zip'
      modelArgs={path,files:[{path:source},...(fault==='denied-selection'?[{path:DIR+'/hidden.bin'}]:[])]}
      const before=JSON.stringify(session.scopeResolver.entries.value)
      const readBefore=app.vault.readBinary, createBefore=app.vault.createBinary
      const observedReads=[]; let writes=0
      app.vault.readBinary=async(file,...params)=>{observedReads.push(file.path);const data=await readBefore.call(app.vault,file,...params);if(fault==='pre-issuance-stop'&&file.path===source)session.abortToolExecution();return data}
      app.vault.createBinary=(target,...params)=>{writes++;if(fault==='native-failure'&&target===path)return Promise.reject(new Error('Sample native save failure'));return createBefore.call(app.vault,target,...params)}
      try {
        await session.sendMessage('Pack the sample for '+fault)
        if(session.pendingToolCalls.value[0]?.name!=='zip')throw new Error('Expected ordinary pending ZIP approval')
        await session.approveToolCall()
        const result=session.messages.value.findLast(message=>message.toolName==='zip')
        report.failedApprovals.push({fault,scopeUnchanged:before===JSON.stringify(session.scopeResolver.entries.value),reads:observedReads,writes,rejected:result?.toolStatus==='rejected',result:result?.toolResult,noSourceGrant:!session.scopeResolver.isInScope(DIR+'/hidden.bin'),noOutputGrant:!session.scopeResolver.isInScope(path)})
      } finally {app.vault.readBinary=readBefore;app.vault.createBinary=createBefore}
    }
  } catch(error) { report.error=String(error?.stack || error) }
  finally {
    if(timer)clearInterval(timer)
    window.fetch=fetchBefore
    session?.abort()
    if(tab) await chats.closeTab(tab)
    config.ai=aiBefore; registry.notifyConfigReloaded(); await config.saveSettings()
    if(created && app.vault.getAbstractFileByPath(DIR)) await app.vault.delete(app.vault.getAbstractFileByPath(DIR),true)
    if(tabBefore) chats.switchTab(tabBefore)
    if(!hadSidebar) for(const leaf of app.workspace.getLeavesOfType('abele-ai-sidebar-view'))leaf.detach()
    if(leftClosed)app.workspace.leftSplit?.collapse();else app.workspace.leftSplit?.expand()
    if(rightClosed)app.workspace.rightSplit?.collapse();else app.workspace.rightSplit?.expand()
    report.restored=!app.vault.getAbstractFileByPath(DIR) && JSON.stringify(config.ai)===JSON.stringify(aiBefore)
  }
  return JSON.stringify(report)
})()`

it('creates a selected byte-exact ZIP through session approval and refuses denied/colliding/stopped requests', async () => {
  const report = JSON.parse(await evalLong(zipProbe(shots), 120_000))
  console.info(onPhone() ? 'phone ZIP' : 'desktop ZIP', report)
  expect(report.error).toBeUndefined()
  for (const name of [
    'pending',
    'saved',
    'roundtrip',
    'deniedZeroReads',
    'collisionZeroReads',
    'stopped',
    'argumentVisible',
    'successScopeOnly',
    'restored',
  ])
    expect(report[name], name).toBe(true)
  expect(report.overflow).toBeLessThanOrEqual(1)
  expect(report.ticks).toBeGreaterThan(0)
  expect(report.grantBeforeNative).toBe(false)
  expect(report.failedApprovals).toHaveLength(5)
  for (const failed of report.failedApprovals) {
    for (const flag of ['scopeUnchanged', 'rejected', 'noSourceGrant', 'noOutputGrant'])
      expect(failed[flag], `${failed.fault}: ${flag}`).toBe(true)
    expect(failed.result).not.toContain('Saved ZIP')
    expect(failed.writes).toBe(failed.fault === 'native-failure' ? 1 : 0)
    expect(failed.reads).toHaveLength(
      ['native-failure', 'pre-issuance-stop'].includes(failed.fault) ? 1 : 0
    )
  }
}, 180_000)
