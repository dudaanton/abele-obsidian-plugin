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
      messages.splice(3,0,...[1,2].map(i=>({...messages[i],id:messages[i].id+'-repeat'})))
      const expandedPaths=messages.flatMap(m=>m.toolPaths||[m.toolPath||m.toolParams.path]).filter(Boolean)
      const singlePaths=['Sample/single-read.md','Sample/single-write.md','Sample/single-create.md','Sample/'+('long-folder/').repeat(12)+'single.md']
      const singles=singlePaths.flatMap((path,i)=>[
        {id:'single-call-'+i,role:'tool-call',timestamp:10+i*2,content:'',toolName:(node?['Read','Write','node_write','Read']:['read','write','create','read'])[i],toolParams:{path},toolStatus:'approved',toolResult:'Sample result'},
        {id:'single-answer-'+i,role:'assistant',timestamp:11+i*2,content:'Sample operation complete.'}
      ])
      messages.unshift(...singles);paths.unshift(...singlePaths);expandedPaths.unshift(...singlePaths)
      if(node)messages.push({id:'sample-code-citation',role:'assistant',timestamp:30,content:'See [src/sample.ts:3-7](src/sample.ts:3-7), \`src/other.ts:9\`, and [the web revision](https://example.test/code).',toolName:undefined})
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
        if(node){await until(()=>root().querySelectorAll('a[data-node-resource]').length>=2);const citations=[...root().querySelectorAll('a[data-node-resource]')];for(const path of ['src/sample.ts:3-7','src/other.ts:9']){const link=citations.find(a=>a.getAttribute('data-node-resource')===path);if(!link)throw Error('Code citation missing: '+path);link.click()}citations.find(a=>a.getAttribute('data-node-resource')==='src/sample.ts:3-7').scrollIntoView({block:'center'});await shot('code-citations')}
        const folded=links().map(el=>el.textContent)
        const singleGeometry=()=>singlePaths.map(path=>{
          const el=links().find(el=>el.title===path),row=el?.closest('.tree-item-self'),name=row?.querySelector('.abele-tree-item__text')
          if(!row||!name)return false
          const a=name.getBoundingClientRect(),b=el.getBoundingClientRect(),r=row.getBoundingClientRect()
          return Math.abs(a.top-b.top)<2&&b.left>=a.right&&b.width>30&&b.right<=r.right+1&&el.title===path
        })
        const geometry=singleGeometry()
        const clipped=()=>links().filter(el=>{
          if(el.closest('.abele-chat-run__inline-file'))return false
          if(node&&el.closest('.abele-chat-tool-files_inline')){
            const style=getComputedStyle(el)
            if(!el.title||el.title!==el.textContent||style.textOverflow!=='ellipsis'||style.whiteSpace!=='nowrap'||style.overflow!=='hidden')throw Error('Compact path lost its full tooltip or ellipsis')
            return el.clientWidth<30
          }
          return el.scrollWidth>el.clientWidth+1
        }).map(el=>el.textContent)
        const foldedClipped=clipped()
        await shot('folded-long-missing')
        links()[0].scrollIntoView({block:'start'});await shot('folded-single-actions')
        links()[links().length-1].scrollIntoView({block:'end'});await shot('folded-multi-file')
        if(node){links()[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(50)}
        root().querySelectorAll('.abele-chat-run > .tree-item-self').forEach(el=>el.click())
        await until(()=>root().querySelector('.abele-chat-run__calls .abele-chat-tool-files'))
        const expanded=links().map(el=>el.textContent)
        const expandedClipped=clipped()
        const cramped=links().filter(el=>el.textContent.length>80&&el.getBoundingClientRect().width<80).map(el=>el.textContent)
        const squeezed=links().filter(el=>{
          const line=el.closest('.abele-chat-msg__tool-line'), name=line.querySelector('.abele-chat-msg__tool-name')
          if(node&&name)throw Error('Compact file call repeats its action name')
          if(!node&&!name)throw Error('File call action name missing')
          const files=el.closest('.abele-chat-tool-files').getBoundingClientRect(),row=line.getBoundingClientRect()
          return (name&&name.scrollWidth>name.clientWidth+1)||(node ? files.left<row.left-1||files.right>row.right+1 : files.width<row.width-1)
        }).map(el=>el.textContent)
        const cutNames=[...root().querySelectorAll('.abele-chat-msg__tool-name')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent)
        await shot('expanded-long-missing')
        links()[links().length-1].scrollIntoView({block:'end'});await shot('expanded-multi-file')
        let reopened=folded,reopenedGeometry=geometry
        if(!node){await session.save();chatFile=session.currentChatFile.value;await chats.closeTab(tab);await chats.openChatFile(chatFile);session=chats.getSessionByFile(chatFile.path);tab=session.id;await until(()=>links().length===paths.length);reopened=links().map(el=>el.textContent);reopenedGeometry=singleGeometry();await shot('reopened')}
        return JSON.stringify({paths,expandedPaths,folded,expanded,reopened,opened,geometry,reopenedGeometry,foldedClipped,expandedClipped,cramped,squeezed,cutNames})
      } finally {
        if(node){chats.nodeSessions.delete(tab);chats.tabOrder.value=chats.tabOrder.value.filter(id=>id!==tab)}else{if(tab)await chats.closeTab(tab);if(chatFile)await app.vault.delete(chatFile)}
        chats.activeTabId.value=prior;owned.detach()
      }
    })()`)
    )
    const names = result.paths.map((path: string) => path.split('/').pop()!.replace(/\.md$/i, ''))
    expect(result.folded).toEqual(names)
    expect(result.expanded).toEqual(result.expandedPaths)
    expect(result.reopened).toEqual(names)
    expect(result.geometry).toEqual([true, true, true, true])
    expect(result.reopenedGeometry).toEqual([true, true, true, true])
    expect(result.foldedClipped).toEqual([])
    expect(result.expandedClipped).toEqual([])
    expect(result.cramped).toEqual([])
    expect(result.squeezed).toEqual([])
    expect(result.cutNames).toEqual([])
    if (node)
      expect(result.opened).toEqual(['src/sample.ts:3-7', 'src/other.ts:9', result.paths[0]])
  }
  if (phone) await withEmulatedPhone(run)
  else await run()
}
