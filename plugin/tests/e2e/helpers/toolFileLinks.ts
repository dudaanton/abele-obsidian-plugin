import { expect } from 'vitest'
import { evalLong } from './obsidianCli'
import { withEmulatedPhone } from './emulatedPhone'
import { shotDir } from './shots'

/** Synthetic saved calls and a synthetic node presenter; no provider is started. */
export async function checkToolFileLinks(node: boolean, phone: boolean) {
  const shots = shotDir('tool-file-links')
  const run = async () => {
    const result = JSON.parse(
      await evalLong(`(async () => {
      const T=window.__abeleTest, chats=T.ChatService.getInstance(), prior=chats.activeTabId.value
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async fn=>{for(let i=0;i<120;i++){const v=fn();if(v)return v;await wait(50)}throw Error('File links did not render')}
      const owned=app.workspace.getLeaf('split');let tab,session,chatFile
      const node=${node}, paths=['Sample/read.md','Sample/written.md','Sample/created.md','Sample/'+('long-folder/').repeat(12)+'missing.md']
      const messages=paths.map((path,i)=>({id:'sample-file-'+i,role:'tool-call',timestamp:i+1,content:'',toolName:['read','write','create','read'][i],toolParams:{path,description:'A description instead of a path'},toolStatus:i===3?'rejected':'approved',toolResult:i===3?'File not found':'Sample raw result'}))
      messages.push({id:'sample-no-path',role:'tool-call',timestamp:6,content:'',toolName:'read',toolParams:{},toolStatus:'rejected',toolResult:'No path supplied'})
      if(node){messages[0].toolName='Read';messages[0].toolPath=paths[0];messages[0].toolParams={};messages[1].toolPaths=[paths[1],'src/second.ts'];paths.splice(2,0,'src/second.ts')}
      const opened=[]
      const presenter={id:'sample-file-links-node',reference:{kind:'node-session',nodeId:'sample-node',registrationId:'sample-registration',sessionId:'sample-session',title:'Sample file calls'},label:{value:'Sample file calls'},provider:{value:'claude'},state:{value:'idle'},isStreaming:{value:false},connection:{state:{value:'connected'},error:{value:''}},error:{value:''},draft:{value:{text:'',attachments:[]}},queued:{value:[]},rejected:{value:[]},messages:{value:messages},projection:{value:{activeRuns:[],queuedInputs:[],children:{},artifacts:[],unknown:[],prompts:[]}},send:async()=>{},answer:async()=>{},cancelInput:async()=>{},interrupt:async()=>{},openResource:path=>opened.push(path),destroy:()=>{}}
      const root=()=>owned.view.containerEl
      const links=()=>[...root().querySelectorAll('.abele-chat-tool-files [role="link"]')].filter(el=>el.getBoundingClientRect().width)
      const shot=async state=>{await wait(150);require('fs').writeFileSync(${JSON.stringify(shots + '/')}+(node?'node-':'chat-')+${JSON.stringify(phone ? 'phone-' : 'desktop-')}+state+'.png',(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())}
      try {
        if(node){tab=presenter.id;chats.nodeSessions.set(tab,presenter);chats.tabOrder.value=[...chats.tabOrder.value,tab];chats.activeTabId.value=tab}
        else {tab=chats.createTab();session=chats.getSession(tab);await session.addUserNote('Sample file operations');for(const message of messages)session.appendChatMessage(message);session.updateVisibleMessages()}
        await owned.setViewState({type:'abele-ai-sidebar-view',active:true})
        await until(()=>links().length===paths.length)
        const folded=links().map(el=>el.textContent)
        const clipped=()=>links().filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent)
        const foldedClipped=clipped()
        await shot('folded-long-missing')
        if(node){links()[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(50)}
        root().querySelector('.abele-chat-run > .tree-item-self').click()
        await until(()=>root().querySelector('.abele-chat-run__calls .abele-chat-tool-files'))
        const expanded=links().map(el=>el.textContent)
        const expandedClipped=clipped()
        const cramped=links().filter(el=>el.textContent.length>80&&el.getBoundingClientRect().width<80).map(el=>el.textContent)
        await shot('expanded-long-missing')
        let reopened=folded
        if(!node){await session.save();chatFile=session.currentChatFile.value;await chats.closeTab(tab);await chats.openChatFile(chatFile);session=chats.getSessionByFile(chatFile.path);tab=session.id;await until(()=>links().length===paths.length);reopened=links().map(el=>el.textContent);await shot('reopened')}
        return JSON.stringify({paths,folded,expanded,reopened,opened,foldedClipped,expandedClipped,cramped})
      } finally {
        if(node){chats.nodeSessions.delete(tab);chats.tabOrder.value=chats.tabOrder.value.filter(id=>id!==tab)}else{if(tab)await chats.closeTab(tab);if(chatFile)await app.vault.delete(chatFile)}
        chats.activeTabId.value=prior;owned.detach()
      }
    })()`)
    )
    expect(result.folded).toEqual(result.paths)
    expect(result.expanded).toEqual(result.paths)
    expect(result.reopened).toEqual(result.paths)
    expect(result.foldedClipped).toEqual([])
    expect(result.expandedClipped).toEqual([])
    expect(result.cramped).toEqual([])
    if (node) expect(result.opened).toEqual([result.paths[0]])
  }
  if (phone) await withEmulatedPhone(run)
  else await run()
}
