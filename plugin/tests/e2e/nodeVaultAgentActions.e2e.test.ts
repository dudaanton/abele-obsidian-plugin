import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { startPairedNode } from './helpers/pairedNode'
import { nodeAgentTurn, type NodeAgentTurn } from './helpers/nodeAgentTurn'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-vault-node-actions')

async function exercise(label: string) {
  const node = await startPairedNode()
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
    await evalLong(`(async()=>{
      const T=window.__abeleTest,chats=T.ChatService.getInstance(),client=T.NodeService.getInstance().connection(${JSON.stringify(node.registration)}).client;
      await chats.openChatFile(await app.vault.create(${JSON.stringify(chat)},JSON.stringify({v:2,k:'meta',type:'abele-chat',providerId:'',modelId:'',title:'Sample node actions',created:'2026-01-01'})+'\\n'));
      const session=chats.getSessionByFile(${JSON.stringify(chat)}),project=(await client.listProjects())[0],tree=(await client.repository.worktrees({project_id:project.project_id})).entries[0];
      await T.giveNodeChatAccess(session,{kind:'target',node_id:${JSON.stringify(node.node)},project_id:project.project_id,target:{kind:'worktree',worktree_id:tree.worktree_id},access:'edit'});
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
      `(async()=>{for(let i=0;i<200;i++){if(document.querySelector('.abele-tool-approval'))return;await new Promise(r=>setTimeout(r,50))}throw Error('File approval missing')})()`
    )
    columnShot(`${shots}/${label}-ask.png`)
    expect(
      await evalLong(
        `(async()=>{${setup}const target=session.overrides.value.nodeScope[0];const observation=await client.repository.observe({worktree_id:target.target.worktree_id});const files=await client.repository.tree({worktree_id:target.target.worktree_id,revision:observation.revision,path:''});return files.entries.some(e=>e.path==='sample-approval.txt')})()`
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
      `(()=>{${setup}session.toolModes.value={...session.toolModes.value,node_command_run:'off'}})()`
    )
    const off = await turn(
      `[()=>({name:'node_command_run',params:{node:${JSON.stringify(node.node)},argv:['node','--version'],operation_id:crypto.randomUUID(),justification:'Check the sample runtime.'}})]`
    )
    expect(off.tools).not.toContain('node_command_run')
    expect(off.calls[0].result).toMatch(/off|unknown|not (available|found)/i)
  } finally {
    await evalLong(
      `(async()=>{${setup}if(session){session.abort();await chats.closeTab(session.id)}if(app.vault.getAbstractFileByPath(${JSON.stringify(chat)}))await T.ChatStorage.getInstance().deleteChat(${JSON.stringify(chat)});delete window.__sampleNodeActionTurn})()`
    ).catch(() => {})
    await node.close()
  }
}

it('lets a vault model create, edit, move, copy, delete and run commands on a paired node', async () => {
  await exercise('desktop')
  try {
    await enterPhone()
    await exercise('phone-emulated')
  } finally {
    await reloadApp('app.emulateMobile(false)')
  }
}, 360000)
