import { expect, it } from 'vitest'
import { resolve } from 'node:path'
import { evalAsync } from './helpers/githubLive'
import { evalRaw } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { withNode } from './helpers/nodeAccessFixture'

// The node daemon runs beside the app under test, so the phone is its emulated layout here.
targets('desktop')
const shots = shotDir('abele-node-access')
const NODE_TOOLS = [
  'node_nodes',
  'node_folders',
  'list_node_worktrees',
  'node_ls',
  'node_read',
  'node_edit',
  'node_search',
  'node_worktree_switch',
]
const prelude = `const T=window.__abeleTest,chats=T.ChatService.getInstance(),nodes=T.NodeService.getInstance();const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async(f,what)=>{for(let i=0;i<300;i++){const v=f();if(v)return v;await wait(50)}throw Error('Did not settle: '+(what||f.toString()))};const visible=s=>[...document.querySelectorAll(s)].find(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('.workspace-leaf.mod-hidden'));const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&b.getBoundingClientRect().width>0);`

/** A picture of the whole window, as the person would see it now. */
const capture = (name: string) =>
  evalAsync<string>(
    `(async()=>{await new Promise(r=>setTimeout(r,300));const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(resolve(shots, `2026-10-15-node-access-${name}.png`))},image.toPNG());return JSON.stringify('captured')})()`
  )

interface Turn {
  calls: { name: string; result: string; refusal?: { kind: string; node_id: string } }[]
  error?: string
}

/** One turn of the chat, driven by a scripted model that makes these calls in order. */
const chatTurn = (path: string, steps: string) => `(async()=>{
  const T=window.__abeleTest,session=T.ChatService.getInstance().getSessionByFile(${JSON.stringify(path)});
  const realFetch=window.fetch,endpoint='https://sample-node-access-model.invalid/v1',out={calls:[]};
  const steps=${steps};let n=0;
  session.resolveModel=()=>({id:'sample',name:'Sample',baseUrl:endpoint,apiKey:'none',contextWindow:100000,maxTokens:1000,supportsReasoning:false});
  for(const key of ['generateTitle','generateSummary','generateRecap','autoCompactIfNeeded'])session.summarizer[key]=async()=>{};
  window.fetch=async(url,init)=>{
    if(typeof url!=='string'||!url.startsWith(endpoint))return realFetch(url,init);
    const step=n<steps.length?steps[n]:null;n++;
    const delta=step?{tool_calls:[{index:0,id:'sample-call-'+Date.now()+'-'+n,type:'function',function:{name:step.name,arguments:JSON.stringify(step.params)}}]}:{content:'Done.'};
    const enc=new TextEncoder();
    return new Response(new ReadableStream({start(c){for(const chunk of [{choices:[{delta}]},{choices:[{delta:{},finish_reason:step?'tool_calls':'stop'}]}])c.enqueue(enc.encode('data: '+JSON.stringify(chunk)+'\\n\\n'));c.enqueue(enc.encode('data: [DONE]\\n\\n'));c.close()}}),{status:200,headers:{'Content-Type':'text/event-stream'}});
  };
  try{
    const before=session.allMessages.value.length;
    await session.sendMessage('Read the sample file in the project on the node.');
    if(session.error.value)out.error=String(session.error.value);
    for(const m of session.allMessages.value.slice(before))if(m.role==='tool-call'&&m.toolResult!==undefined)out.calls.push({name:m.toolName,result:String(m.toolResult),refusal:m.nodeAccessRefusal});
  }finally{window.fetch=realFetch}
  return JSON.stringify(out)
})()`

/**
 * The whole way from a refusal to a working call, as the person goes it: the agent is refused,
 * the line under its call says where by name, one press opens this chat's node access with that
 * place chosen, Add gives it, the line says so, and the agent asked again reads the file. Then
 * the other way in: the node panel's row menu gives a second chat access, chosen from a list that
 * puts the open chat first and tells chats apart.
 */
async function refusalToGrant(form: 'desktop' | 'phone') {
  await withNode(async ({ port, token, repo }) => {
    const stamp = Date.now()
    const chat = `Sample node access ${stamp}.abchat`
    let registration = '',
      agentId = '',
      second = ''
    try {
      const setup = evalAsync<{
        registration: string
        project: string
        worktree: string
        agent: string
      }>(
        `(async()=>{${prelude}
        const node=await nodes.add('Sample workstation','http://127.0.0.1:${port}',${JSON.stringify(token)}),client=nodes.connection(node.id).client;
        await until(()=>client.connected,'node connected');
        const project=await client.registerProject(${JSON.stringify(repo)},'untrusted');
        const worktree=(await client.repository.worktrees({project_id:project.project_id})).entries[0];
        const agent=T.AgentRegistry.getInstance().create({name:'Sample node access agent',toolModes:Object.fromEntries(${JSON.stringify(NODE_TOOLS)}.map(n=>[n,'auto']))});
        await chats.openChatFile(await app.vault.create(${JSON.stringify(chat)},JSON.stringify({v:2,k:'meta',type:'abele-chat',agentId:agent.id,providerId:'',modelId:'',title:'Sample node access',created:'2026-01-01'})+'\\n'));
        const session=chats.getSessionByFile(${JSON.stringify(chat)});session.permissionMode.value='allow-all';
        await chats.revealSidebar({focus:false});
        return JSON.stringify({registration:node.id,project:project.project_id,worktree:worktree.worktree_id,agent:agent.id})
      })()`
      )
      registration = setup.registration
      agentId = setup.agent
      const read = `{name:'node_read',params:{node:${JSON.stringify(registration)},project:${JSON.stringify(setup.project)},workspace:${JSON.stringify(setup.worktree)},target_kind:'worktree',path:'sample.txt'}}`

      // Refused: the agent reads why in words, the call keeps the coded refusal.
      const refused = evalAsync<Turn>(chatTurn(chat, `[{name:'open_nodes',params:{}},${read}]`))
      expect(refused.error, JSON.stringify(refused)).toBeUndefined()
      const call = refused.calls.at(-1)!
      expect(call.name).toBe('node_read')
      expect(call.result).toMatch(/this chat needs node access|not in this chat's node access/)
      expect(call.refusal?.kind, JSON.stringify(refused)).toBe('no-access')

      // The line under the call names the place, not its ids, and offers the one press.
      const line = evalAsync<string>(
        `(async()=>{${prelude}
        const line=await until(()=>[...document.querySelectorAll('.abele-ai-chat .abele-node-refusal')].find(el=>el.getBoundingClientRect().width>0&&el.textContent.includes('sample-app')),'refusal line');
        line.scrollIntoView({block:'center'});
        const box=line.getBoundingClientRect();if(box.right>innerWidth+1||box.left<-1)throw Error('Refusal line leaves the window: '+JSON.stringify(box));
        const press=button(line,'Give this chat access');if(!press)throw Error('No way through on the line: '+line.textContent);
        if(document.body.classList.contains('is-phone')&&press.getBoundingClientRect().width<box.width*0.6)throw Error('Phone button is not the row wide');
        return JSON.stringify(line.textContent.trim())
      })()`
      )
      expect(line).toContain('No access to sample-app / main on the Sample workstation node')
      expect(line).not.toContain(setup.project)
      await capture(`refusal-${form}`)

      // One press: this chat's node access opens with the node, the folder and the worktree chosen.
      evalAsync(
        `(async()=>{${prelude}
        const line=[...document.querySelectorAll('.abele-ai-chat .abele-node-refusal')].find(el=>el.getBoundingClientRect().width>0);
        button(line,'Give this chat access').click();
        const add=await until(()=>visible('.abele-node-scope-editor__add:not(:disabled)'),'node access opened');
        await wait(300);
        add.click();
        const selected=await until(()=>[...document.querySelectorAll('.menu-item')].find(item=>item.textContent.includes('Sample workstation')&&item.textContent.includes('sample-app')&&item.textContent.includes('main')),'refused place offered');
        const shown=selected.textContent;
        if(shown.includes('refs/heads/'))throw Error('Branch is shown as a full ref: '+shown);
        return JSON.stringify(shown)
      })()`
      )
      await capture(`grant-dialog-${form}`)
      // Where the form landed: every field clear of the scrollbar, and Add access in view.
      evalAsync(
        `(async()=>{${prelude}
        const add=visible('.abele-node-scope-editor__add'),editor=add.closest('.abele-node-scope-editor');
        await wait(400);const body=add.closest('.abele-chat-setup__body'),box=body.getBoundingClientRect(),inner={left:box.left+body.clientLeft,right:box.left+body.clientLeft+body.clientWidth,top:box.top,bottom:box.top+body.clientHeight};
        for(const el of [add]){const r=el.getBoundingClientRect();if(r.right>inner.right+0.5||r.left<inner.left-0.5)throw Error('Runs under the scrollbar or past the edge: '+(el.textContent||el.value)+' '+JSON.stringify({r,inner}))}
        const a=add.getBoundingClientRect();if(a.top<inner.top||a.bottom>inner.bottom)throw Error('Add access is not in view when the place lands: '+JSON.stringify({a,inner}));
        return JSON.stringify('in view')
      })()`
      )
      evalAsync(
        `(async()=>{${prelude}
        const chosen=[...document.querySelectorAll('.menu-item')].find(item=>item.textContent.includes('Sample workstation')&&item.textContent.includes('sample-app')&&item.textContent.includes('main'));
        if(!chosen)throw Error('Refused place is missing from the add menu');
        chosen.click();
        const session=chats.getSessionByFile(${JSON.stringify(chat)});
        await until(()=>session.overrides.value.nodeScope?.length===1,'access added');
        const modal=document.querySelector('.abele-chat-setup').closest('.modal');const close=[...modal.querySelectorAll('.modal-close-button,.modal-header-button')].find(b=>b.getBoundingClientRect().width>0);if(close)close.click();else modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        await until(()=>!visible('.abele-node-scope-editor'),'dialog closed');
        await until(()=>[...document.querySelectorAll('.abele-ai-chat .abele-node-refusal')].some(el=>el.getBoundingClientRect().width>0&&el.textContent.includes('Access given. Ask the agent to try again')),'line says given');
        const access=visible('.abele-ai-chat .abele-chat-input__scope')?.getAttribute('aria-label')||'';
        if(!access.includes('sample-app')||!access.includes('worktree main')||access.includes(${JSON.stringify(setup.project)}))throw Error('Access button does not name the place: '+access);
        return JSON.stringify(access)
      })()`
      )
      await capture(`refusal-given-${form}`)

      // Asked again, the same call reads the file.
      const retried = evalAsync<Turn>(chatTurn(chat, `[${read}]`))
      expect(retried.error, JSON.stringify(retried)).toBeUndefined()
      expect(retried.calls[0].result, JSON.stringify(retried)).toContain('first line')
      expect(retried.calls[0].refusal).toBeUndefined()

      // The node panel's way in, for another chat: the open one first and marked, each told
      // apart by its agent and last question; the folder and branch by name; a notice after.
      second = evalAsync<string>(
        `(async()=>{${prelude}
        const id=await chats.newTab();const other=chats.getAllSessions().find(s=>s.id===id);other.chatTitle.value='Sample second chat';
        await chats.revealSidebar({focus:false});
        for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();
        app.commands.executeCommandById('abele:open-node');
        const leaf=await until(()=>app.workspace.getLeavesOfType('abele-node-sidebar')[0],'node pane');
        await leaf.view.setState({registrationId:${JSON.stringify(registration)}},{});
        await app.workspace.revealLeaf(leaf);
        // The panel's one place, the worktree main of sample-app, and its menu beside it.
        const place=await until(()=>[...document.querySelectorAll('.abele-node-sidebar .abele-node-place')].find(p=>p.getBoundingClientRect().width>0),'place row');
        const isMain=()=>place.querySelector('.abele-node-place__name')?.textContent.trim()==='main'&&place.querySelector('.abele-node-place__where')?.textContent.trim()==='sample-app';
        if(!isMain()){
          place.querySelector('.abele-node-place__row').click();
          const pick=await until(()=>[...document.querySelectorAll('.suggestion-item')].find(i=>i.querySelector('.suggestion-title')?.textContent==='sample-app / main'),'place search');
          pick.click();
          await until(isMain,'worktree main chosen');
        }
        place.querySelector(':scope > .abele-obsidian-icon').click();
        const item=await until(()=>[...document.querySelectorAll('.menu-item')].find(i=>i.textContent.includes('Give a chat access…')),'menu item');
        item.click();
        const picker=await until(()=>[...document.querySelectorAll('.prompt-input')].find(input=>input.placeholder==='Which chat gets access'),'chat picker opened');
        const rows=await until(()=>{const r=[...picker.closest('.prompt').querySelectorAll('.suggestion-item')];return r.length>=2&&r},'chat picker');
        if(!rows[0].textContent.includes('Sample second chat')||!rows[0].textContent.includes('Open now')||!rows[0].textContent.includes('no questions yet'))throw Error('Open chat is not first: '+rows[0].textContent);
        const first=rows.find(r=>r.textContent.includes('Sample node access'));
        if(!first||!first.textContent.includes('Sample node access agent')||!first.textContent.includes('Read the sample file'))throw Error('Chats are not told apart: '+(first&&first.textContent));
        if(![...first.querySelectorAll('[aria-label]')].some(el=>el.getAttribute('aria-label').includes('Already has access to sample-app / main')))throw Error('Existing access not marked: '+first.textContent);
        return JSON.stringify(id)
      })()`
      )
      await capture(`chat-picker-${form}`)
      evalAsync(
        `(async()=>{${prelude}
        document.querySelector('.prompt-input[placeholder="Which chat gets access"]').closest('.prompt').querySelector('.suggestion-item').click();
        const dialog=await until(()=>[...document.querySelectorAll('.modal')].find(m=>m.getBoundingClientRect().width>0&&m.textContent.includes('Give a chat access')),'grant dialog');
        if(!dialog.textContent.includes('Folder: sample-app')||!dialog.textContent.includes('Worktree: main')||!dialog.textContent.includes('Sample workstation'))throw Error('Grant dialog does not name the place: '+dialog.textContent);
        if(dialog.textContent.includes(${JSON.stringify(setup.worktree)}))throw Error('Grant dialog shows an id: '+dialog.textContent);
        return JSON.stringify('dialog')
      })()`
      )
      await capture(`panel-grant-dialog-${form}`)
      evalAsync(
        `(async()=>{${prelude}
        const dialog=[...document.querySelectorAll('.modal')].find(m=>m.getBoundingClientRect().width>0&&m.textContent.includes('Give a chat access'));
        button(dialog,'Give access').click();
        const other=chats.getAllSessions().find(s=>s.id===${JSON.stringify(second)});
        await until(()=>other.overrides.value.nodeScope?.length===1,'second chat given access');
        await until(()=>[...document.querySelectorAll('.notice')].some(n=>n.textContent.includes('Sample second chat can read and edit sample-app / main')),'notice');
        return JSON.stringify('given')
      })()`
      )
      await capture(`panel-notice-${form}`)

      // The agent's tools, offered by section, with the node section as three actions.
      evalAsync(
        `(async()=>{${prelude}
        await T.openDialog('agent-tools');
        await until(()=>document.querySelector('.abele-tool-modes .abele-fold-heading'),'tool groups');
        for(const fold of document.querySelectorAll('.abele-tool-modes > .abele-disclosure > .abele-fold-heading[aria-expanded="false"]'))fold.click();
        const heading=await until(()=>[...document.querySelectorAll('.abele-tool-modes > .abele-disclosure > .abele-fold-heading')].find(h=>h.querySelector('.abele-fold-heading__text')?.textContent==='Node'&&h.getBoundingClientRect().width>0),'node section');
        await until(()=>document.querySelector('.abele-tool-modes__action'),'node actions');
        const text=heading.closest('.abele-tool-modes').textContent;
        for(const words of ['Read files and search','Edit files','Worktrees','Hand work to a node agent','Debugger runs','Always open','Offer tools'])if(!text.includes(words)&&!document.querySelector('.abele-agent-editor').textContent.includes(words))throw Error('Missing '+words);
        if(!document.querySelector('.abele-agent-editor .abele-tool-modes__opening-fixed')?.textContent.includes('Always open'))throw Error('Files is not said to be always open');for(const old of ['node_file','node_tree','node_grep','node_blame','node_commits'])if(document.querySelector('.abele-agent-editor').textContent.includes(old))throw Error('Old name listed: '+old);const about=heading.parentElement.querySelector('.abele-tool-modes__about');if(!about||about.textContent.trim()!=='Files, search and git history on folders this chat was given on a node. What it can reach is set per chat in Node access.')throw Error('Node section is not said in one short line: '+(about&&about.textContent));
        if(document.body.classList.contains('is-phone')){const row=[...document.querySelectorAll('.abele-tool-modes__action')].find(r=>r.textContent.includes('Read files and search'));const name=row.querySelector('.setting-item-name').getBoundingClientRect(),choice=row.querySelector('select').getBoundingClientRect(),count=row.querySelector('.abele-tool-modes__members-toggle').getBoundingClientRect();if(!(choice.top>=name.bottom-1&&count.top>=choice.bottom-1))throw Error('On a phone the choice is not under the name with the count below: '+JSON.stringify({name,choice,count}))}
        heading.scrollIntoView({block:'start'});
        return JSON.stringify('tools')
      })()`
      )
      await capture(`agent-tools-${form}`)
      evalAsync(
        `(async()=>{${prelude}for(const b of [...document.querySelectorAll('.modal .modal-close-button, .modal .modal-header-button')].reverse())b.click();await until(()=>!visible('.abele-agent-editor'),'tools closed');return JSON.stringify(true)})()`
      )
    } finally {
      evalRaw(`(async()=>{
        const T=window.__abeleTest,chats=T.ChatService.getInstance(),s=chats.getSessionByFile(${JSON.stringify(chat)});
        for(const b of [...document.querySelectorAll('.modal .modal-close-button, .modal .modal-header-button')].reverse())b.click();
        if(s){s.abort();await chats.closeTab(s.id)}
        for(const t of chats.getAllSessions())if(t.chatTitle.value==='Sample second chat')await chats.closeTab(t.id);
        if(app.vault.getAbstractFileByPath(${JSON.stringify(chat)}))await T.ChatStorage.getInstance().deleteChat(${JSON.stringify(chat)});
        for(const leaf of app.workspace.getLeavesOfType('abele-node-sidebar'))leaf.detach();
        if(${JSON.stringify(agentId)})T.AgentRegistry.getInstance().remove(${JSON.stringify(agentId)});
        if(${JSON.stringify(registration)})T.NodeService.getInstance().remove(${JSON.stringify(registration)});
        return true
      })()`)
    }
  })
}

it('takes a refused node call to a working one in two presses, and gives a chat access from the node panel', async () => {
  await refusalToGrant('desktop')
}, 180000)

it('does the same in the phone layout', async () => {
  await withEmulatedPhone(() => refusalToGrant('phone'))
}, 240000)
