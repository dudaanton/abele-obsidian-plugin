import { openChatSetup } from '../helpers/chatProbeInteractions'
import { expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { startPairedNode } from './helpers/pairedNode'
import { nodeAgentTurn, type NodeAgentTurn } from './helpers/nodeAgentTurn'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-vault-node-actions')

async function exercise(label: string, plain: boolean) {
  const node = await startPairedNode()
  const plainPath = join(dirname(node.state), 'sample-plain')
  const chat = `Sample node actions ${Date.now()}.abchat`
  const setup = `const T=window.__abeleTest,chats=T.ChatService.getInstance(),session=chats.getSessionByFile(${JSON.stringify(chat)}),connection=T.NodeService.getInstance().connection(${JSON.stringify(node.registration)}),client=connection.client;`
  const turn = async (steps: string) =>
    JSON.parse(await evalLong(nodeAgentTurn(chat, steps), 90000)) as NodeAgentTurn
  const pollCommand = (receipt: { session_id: string; run_id: string }) =>
    turn(`Array.from({length:60},(_,index)=>async r=>{
      await new Promise(r=>setTimeout(r,100));
      if(index>0 && JSON.parse(r.at(-1)).state==='exited')return null;
      return {name:'node_command_status',params:{node:${JSON.stringify(node.node)},session_id:${JSON.stringify(receipt.session_id)},run_id:${JSON.stringify(receipt.run_id)}}}
    })`)
  try {
    if (plain) mkdirSync(plainPath)
    await evalLong(`(async()=>{
      const T=window.__abeleTest,chats=T.ChatService.getInstance(),client=T.NodeService.getInstance().connection(${JSON.stringify(node.registration)}).client;
      await chats.openChatFile(await app.vault.create(${JSON.stringify(chat)},JSON.stringify({v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',title:'Sample node actions',created:'2026-01-01'})+'\\n'));
      const session=chats.getSessionByFile(${JSON.stringify(chat)}),project=${plain ? `await client.registerProject(${JSON.stringify(plainPath)},'trusted')` : '(await client.listProjects())[0]'};
      const target=project.repository_path?{kind:'worktree',worktree_id:(await client.repository.worktrees({project_id:project.project_id})).entries[0].worktree_id}:{kind:'workspace',workspace_id:(await client.listWorkspaces(project.project_id)).find(w=>w.kind==='root').workspace_id};
      await T.giveNodeChatAccess(session,{kind:'target',node_id:${JSON.stringify(node.node)},project_id:project.project_id,target,access:'run'});
      session.permissionMode.value='allow-all';session.toolModes.value={...session.toolModes.value,node_command_run:'auto'};
      await chats.revealSidebar({focus:false});
    })()`)
    const mutations = await turn(`[
      ()=>({name:'node_write',params:{path:'sample-created.txt',expected_content_id:null,text:'created text\\n'}}),
      ()=>({name:'node_read',params:{path:'sample-created.txt'}}),
      r=>({name:'node_edit',params:{path:'sample-created.txt',expected_content_id:JSON.parse(r.at(-1)).content_id,old_text:'created',new_text:'edited'}}),
      ()=>({name:'node_read',params:{path:'sample-created.txt'}}),
      r=>({name:'node_mv',params:{from:'sample-created.txt',to:'sample-renamed.txt',expected_content_id:JSON.parse(r.at(-1)).content_id}}),
      ()=>({name:'node_read',params:{path:'sample-renamed.txt'}}),
      r=>({name:'node_cp',params:{from:'sample-renamed.txt',to:'sample-copy.txt',expected_content_id:JSON.parse(r.at(-1)).content_id}}),
      ()=>({name:'node_read',params:{path:'sample-copy.txt'}}),
      r=>({name:'node_rm',params:{path:'sample-copy.txt',expected_content_id:JSON.parse(r.at(-1)).content_id}}),
      ()=>({name:'node_ls',params:{}})
    ]`)
    expect(mutations.error, JSON.stringify(mutations)).toBeUndefined()
    expect(mutations.calls.map((c) => c.name)).toEqual([
      'node_write',
      'node_read',
      'node_edit',
      'node_read',
      'node_mv',
      'node_read',
      'node_cp',
      'node_read',
      'node_rm',
      'node_ls',
    ])
    for (const index of [0, 2])
      expect(JSON.parse(mutations.calls[index].result).state).toBe('saved')
    for (const index of [4, 6, 8])
      expect(JSON.parse(mutations.calls[index].result).state).toBe('applied')
    expect(JSON.parse(mutations.calls[5].result).text).toBe('edited text\n')
    expect(JSON.parse(mutations.calls[7].result).text).toBe('edited text\n')
    const listing = JSON.parse(mutations.calls[9].result).entries.map(
      (e: { path: string }) => e.path
    )
    expect(listing).toContain('sample-renamed.txt')
    expect(listing).not.toContain('sample-created.txt')
    expect(listing).not.toContain('sample-copy.txt')
    expect(await evalLong(`document.querySelectorAll('.abele-tool-approval').length`)).toBe('0')
    columnShot(`${shots}/${label}-files.png`)

    const command = await turn(
      `[()=>({name:'node_command_run',params:{node:${JSON.stringify(node.node)},argv:['node','-e','process.stdout.write(require("fs").readFileSync("sample-renamed.txt","utf8"))'],operation_id:crypto.randomUUID(),justification:'Read the renamed sample file with a command.'}})]`
    )
    expect(command.error, JSON.stringify(command)).toBeUndefined()
    const receipt = JSON.parse(command.calls[0].result)
    expect(receipt.state).not.toBe('pending_approval')
    const status = await pollCommand(receipt)
    expect(status.error, JSON.stringify(status)).toBeUndefined()
    const finished = JSON.parse(status.calls.at(-1)!.result)
    expect(finished).toMatchObject({ state: 'exited', exit_code: 0, stdout: 'edited text\n' })
    columnShot(`${shots}/${label}-command.png`)

    // A real model call pauses at the ordinary file approval, before the daemon writes.
    await evalLong(`(()=>{${setup}session.permissionMode.value='confirm-all'})()`)
    await evalLong(
      `(()=>{window.__sampleNodeActionTurn=${nodeAgentTurn(chat, `[()=>({name:'node_write',params:{path:'sample-approval.txt',expected_content_id:null,text:'approved text'}})]`)};return true})()`
    )
    await evalLong(
      `(async()=>{for(let i=0;i<200;i++){if([...document.querySelectorAll('.abele-tool-approval button')].some(b=>b.textContent.trim()==='Allow'))return;await new Promise(r=>setTimeout(r,50))}throw Error('File approval missing')})()`
    )
    columnShot(`${shots}/${label}-ask.png`)
    expect(
      await evalLong(
        `(async()=>{${setup}const target=session.overrides.value.nodeScope[0].target;let files;if(target.kind==='worktree'){const observation=await client.repository.observe({worktree_id:target.worktree_id});files=await client.repository.tree({worktree_id:target.worktree_id,revision:observation.revision,path:''})}else files=await client.listFiles(target.workspace_id,'');return files.entries.some(e=>e.path==='sample-approval.txt')})()`
      )
    ).toBe('false')
    await evalLong(
      `(()=>{const allow=[...document.querySelectorAll('.abele-tool-approval button')].find(b=>b.textContent.trim()==='Allow');if(!allow)throw Error('Allow action missing');allow.click()})()`
    )
    const approved = JSON.parse(
      await evalLong('window.__sampleNodeActionTurn', 90000)
    ) as NodeAgentTurn
    expect(approved.error, JSON.stringify(approved)).toBeUndefined()
    expect(JSON.parse(approved.calls[0].result).state).toBe('saved')

    const askCommand = await turn(
      `[()=>({name:'node_command_run',params:{node:${JSON.stringify(node.node)},argv:['node','-e','process.stdout.write("sample-command-approved")'],operation_id:crypto.randomUUID(),justification:'Print the sample approval result.'}})]`
    )
    expect(askCommand.error, JSON.stringify(askCommand)).toBeUndefined()
    const pendingCommand = JSON.parse(askCommand.calls[0].result)
    expect(pendingCommand).toMatchObject({ state: 'pending_approval', stdout: '' })
    await evalLong(
      `(async()=>{for(let i=0;i<200;i++){if(document.querySelector('.abele-tool-approval [data-manager-command]'))return;await new Promise(r=>setTimeout(r,50))}throw Error('Command approval missing')})()`
    )
    columnShot(`${shots}/${label}-command-ask.png`)
    await evalLong(
      `(()=>{const allow=[...document.querySelectorAll('.abele-tool-approval button')].find(b=>b.textContent.trim()==='Allow');if(!allow)throw Error('Command Allow missing');allow.click()})()`
    )
    const approvedCommand = await pollCommand(pendingCommand)
    expect(approvedCommand.error, JSON.stringify(approvedCommand)).toBeUndefined()
    expect(JSON.parse(approvedCommand.calls.at(-1)!.result)).toMatchObject({
      state: 'exited',
      exit_code: 0,
      stdout: 'sample-command-approved',
    })

    const outside = await turn(`[()=>({name:'node_read',params:{path:'../sample-outside.txt'}})]`)
    expect(outside.calls[0].result).not.toContain('approved text')
    expect(outside.calls[0].result).toMatch(/invalid|relative|path|travers/i)
    await evalLong(
      `(()=>{${setup}session.overrides.value={...session.overrides.value,nodeScope:session.overrides.value.nodeScope.map(e=>({...e,access:'edit'}))}})()`
    )
    const off = await turn(
      `[()=>({name:'node_command_run',params:{node:${JSON.stringify(node.node)},argv:['node','--version'],operation_id:crypto.randomUUID(),justification:'Check the sample runtime.'}})]`
    )
    expect(off.tools).not.toContain('node_command_run')
    expect(off.modelResults[0], JSON.stringify(off)).toMatch(/off|unknown|not (available|found)/i)
  } finally {
    await evalLong(
      `(async()=>{${setup}if(session){session.abort();await chats.closeTab(session.id)}if(app.vault.getAbstractFileByPath(${JSON.stringify(chat)}))await T.ChatStorage.getInstance().deleteChat(${JSON.stringify(chat)});delete window.__sampleNodeActionTurn})()`
    ).catch(() => {})
    await node.close()
  }
}

it.each([false, true])(
  'lets a vault model create, edit, move, copy, delete and run commands on a paired node (plain folder: %s)',
  async (plain) => {
    const kind = plain ? 'plain' : 'git'
    await exercise(`desktop-${kind}`, plain)
    try {
      await enterPhone()
      await exercise(`phone-emulated-${kind}`, plain)
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  360000
)

it('shows each node access state on desktop and phone geometry', async () => {
  for (const phone of [false, true]) {
    if (phone) await enterPhone()
    const node = await startPairedNode({ allowBypass: false })
    const chat = `Sample access setup ${Date.now()}.abchat`
    const label = phone ? 'phone' : 'desktop'
    const setup = `const T=window.__abeleTest,chats=T.ChatService.getInstance(),session=chats.getSessionByFile(${JSON.stringify(chat)}),wait=ms=>new Promise(r=>setTimeout(r,ms));`
    let agentId = ''
    try {
      agentId = JSON.parse(
        await evalLong(`(async()=>{
        const T=window.__abeleTest,chats=T.ChatService.getInstance();
        const agent=T.AgentRegistry.getInstance().create({name:'Sample helper'});
        await chats.openChatFile(await app.vault.create(${JSON.stringify(chat)},JSON.stringify({v:2,k:'meta',type:'abele-chat',agentId:agent.id,providerId:'',modelId:'',title:'Sample access setup',created:'2026-01-01'})+'\\n'));
        await chats.revealSidebar({focus:false});return JSON.stringify(agent.id)
      })()`)
      )
      await evalLong(`(async()=>{${setup}
        const root=[...document.querySelectorAll('.abele-ai-chat')].find(e=>e.getBoundingClientRect().width>0);
        const until=async(fn,ms)=>{const end=Date.now()+ms;while(Date.now()<end){if(fn())return true;await wait(50)}return false};
        await (${openChatSetup.toString()})(root,until);await wait(500);
      })()`)
      columnShot(`${shots}/${label}-access-none.png`)
      for (const access of ['read', 'edit', 'run']) {
        await evalLong(`(async()=>{${setup}
          await T.giveNodeChatAccess(session,{kind:'project',node_id:${JSON.stringify(node.node)},project_id:${JSON.stringify(node.project)},access:${JSON.stringify(access)}});
          session.permissionMode.value='allow-all';
          for(let i=0;i<300;i++){
            const editor=[...document.querySelectorAll('.abele-node-scope-editor')].find(el=>el.getBoundingClientRect().width>0);
            const mode=editor?.querySelector('.abele-node-scope-editor__mode')?.getAttribute('aria-label');
            const hint=editor?.querySelector('.abele-node-scope-editor__why');
            if(mode===${JSON.stringify(access === 'read' ? 'read' : access === 'edit' ? 'read and edit' : 'Read, edit and run commands')}&&(${JSON.stringify(access)}!=='run'||hint?.textContent.includes('still asks')))return;
            await wait(50)
          }
          throw Error('Node access ${access} did not render');
        })()`)
        columnShot(`${shots}/${label}-access-${access}.png`)
      }
      const refused = await evalLong(
        `(async()=>{${setup}for(let i=0;i<300;i++){const hint=[...document.querySelectorAll('.abele-node-scope-editor__why')].find(el=>el.getBoundingClientRect().width>0&&el.textContent.includes('still asks'));if(hint)return hint.textContent;await wait(50)}throw Error('Node bypass hint did not render')})()`
      )
      expect(refused).toContain('still asks')
      await evalLong(
        `(async()=>{${setup}const footer=document.querySelector('.abele-chat-setup').closest('.modal');const save=[...footer.querySelectorAll('button')].find(b=>b.textContent.includes('Save as'));if(!save)throw Error('Save as action missing');save.click();for(let i=0;i<300;i++){if(footer.querySelector('.abele-chat-setup__saved')?.textContent.includes('Saved as'))return;await wait(50)}throw Error('Saved confirmation did not render')})()`
      )
      expect(
        await evalLong(`document.querySelector('.abele-chat-setup__saved')?.textContent ?? ''`)
      ).toContain('Saved as')
      columnShot(`${shots}/${label}-access-saved.png`)
      await evalLong(
        `(async()=>{${setup}const add=document.querySelector('.abele-node-scope-editor__add');if(!add)throw Error('Add node folder action missing');add.click();for(let i=0;i<300;i++){if([...document.querySelectorAll('.abele-node-folder-choice')].some(el=>el.getBoundingClientRect().width>0))return;await wait(50)}throw Error('Node folder picker did not render')})()`
      )
      columnShot(`${shots}/${label}-access-picker.png`)
    } finally {
      await evalLong(`(async()=>{${setup}
        for(const m of [...document.querySelectorAll('.modal-container')].reverse())m.querySelector('.modal-close-button,.modal-header-button')?.click();
        if(session)await chats.closeTab(session.id);
        if(app.vault.getAbstractFileByPath(${JSON.stringify(chat)}))await T.ChatStorage.getInstance().deleteChat(${JSON.stringify(chat)});
        T.AgentRegistry.getInstance().remove(${JSON.stringify(agentId)});
      })()`).catch(() => {})
      await node.close()
      if (phone) await reloadApp('app.emulateMobile(false)')
    }
  }
}, 360000)
