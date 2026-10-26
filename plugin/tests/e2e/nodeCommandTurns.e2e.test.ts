import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

const shots = shotDir('abele-command-turns')

async function sequence(layout: string, stopped: boolean) {
  const setup = await evalLong(`(async () => {
    const chats = window.__abeleTest.ChatService.getInstance();
    const nodes = window.__abeleTest.NodeService.getInstance();
    const path = 'sample-command-turns.abchat';
    if (app.vault.getAbstractFileByPath(path)) throw Error('Sample path already occupied');
    const file = await app.vault.create(path, JSON.stringify({v:2,k:'meta',type:'abele-chat',title:'Sample command turns',created:'2023-11-14'})+'\\n');
    const originalConnection = nodes.connection;
    const originalNodes = nodes.nodes.value;
    const cards = [0,1].map(i => ({operation:'wire-operation-'+i,command:'printf sample-'+i,folder:'/workspace/sample-project',title:'Sample command',prompts:[],answers:{},run:{session_id:'sample-session',run_id:'sample-run-'+i,method:'command.v1.run',state:'exited',exit_code:0,stdout:'Sample output',stderr:'',stdout_truncated:false,stderr_truncated:false}}));
    try {
      await chats.openChatFile(file); await chats.revealSidebar({focus:false});
      const session = chats.getSessionByFile(path);
      const parent = await session.ensureDelegationParentId();
      const connection = {state:{value:'connected'},delegationCards:{value:{}},managerCards:{value:{[parent]:cards}}};
      nodes.connection = function(id) {return id === 'sample-command-node' ? connection : originalConnection.call(this,id)};
      nodes.nodes.value = [...originalNodes,{id:'sample-command-node',label:'Sample node'}];
      const append = (message) => session.appendChatMessage({content:'',timestamp:1700000000000,...message});
      append({id:'sample-question-a',role:'user',content:'Check the sample project'});
      cards.forEach((card,i) => append({id:'sample-command-'+i,role:'tool-call',toolName:'node_command_run',toolParams:{operation_id:'model-alias-'+i},toolStatus:'approved',toolResult:JSON.stringify(card.run)}));
      append({id:'sample-delegate',role:'tool-call',toolName:'node_delegate',toolStatus:${JSON.stringify(stopped ? 'rejected' : 'approved')},toolResult:${JSON.stringify(stopped ? 'User rejected this action' : 'Sample task finished')}});
      append({id:'sample-answer-a',role:'assistant',content:${JSON.stringify(stopped ? 'Stopped by you. The task may be unfinished.' : 'The sample checks finished.')}});
      session.updateVisibleMessages();
      window.__commandTurnsProbe = {next() {append({id:'sample-question-b',role:'user',content:'Read the sample file'});append({id:'sample-read-b',role:'tool-call',toolName:'node_read',toolStatus:'approved',toolResult:'Sample file contents'});append({id:'sample-answer-b',role:'assistant',content:'The sample file is ready.'});session.updateVisibleMessages()},async cleanup(){nodes.connection=originalConnection;nodes.nodes.value=originalNodes;await chats.deleteChat(session.id)}};
      return true;
    } catch(error) {nodes.connection=originalConnection;nodes.nodes.value=originalNodes;await app.vault.delete(file);throw error}
  })()`)
  expect(setup).toBe('true')
  try {
    const inspect = async () =>
      JSON.parse(
        await evalLong(`(async()=>{
      await new Promise(r=>setTimeout(r,200));
      const box=[...document.querySelectorAll('.abele-ai-chat__messages')].find(el=>el.getClientRects().length);
      const cards=[...box.querySelectorAll('.abele-node-manager-run')];
      return JSON.stringify({cards:cards.length,folded:!!box.querySelector('[data-run-ids~="sample-command-0"].is-collapsed'),next:box.textContent.includes('The sample file is ready.')});
    })()`)
      ) as { cards: number; folded: boolean; next: boolean }
    expect(await inspect()).toMatchObject({ cards: 0, folded: true })
    columnShot(`${shots}/${layout}-${stopped}-first-turn.png`)
    await evalLong('(()=>{window.__commandTurnsProbe.next();return true})()')
    expect(await inspect()).toEqual({ cards: 0, folded: true, next: true })
    columnShot(`${shots}/${layout}-${stopped}-next-turn.png`)
    await evalLong(
      `(()=>{document.querySelector('[data-run-ids~="sample-command-0"] > .tree-item-self').click();return true})()`
    )
    expect(await inspect()).toMatchObject({ cards: 2, folded: false })
    columnShot(`${shots}/${layout}-${stopped}-original-open.png`)
  } finally {
    await evalLong(
      '(async()=>{await window.__commandTurnsProbe.cleanup();delete window.__commandTurnsProbe;return true})()'
    )
  }
}

it('keeps finished commands folded in the original turn on desktop and phone layout', async () => {
  for (const stopped of [false, true]) await sequence('desktop', stopped)
  await withEmulatedPhone(async () => {
    for (const stopped of [false, true]) await sequence('phone', stopped)
  })
})
