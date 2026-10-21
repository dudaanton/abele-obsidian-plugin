import { expect, it } from 'vitest'
import { resolve } from 'node:path'
import { evalLong } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { withNode } from './helpers/nodeAccessFixture'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('folder-node-access')
const prelude = `
const T=window.__abeleTest,chats=T.ChatService.getInstance(),nodes=T.NodeService.getInstance();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<240;i++){const value=fn();if(value)return value;await wait(50)}throw Error('Did not settle: '+label)};
const visible=selector=>[...document.querySelectorAll(selector)].find(el=>el.getBoundingClientRect().width>0);
const close=el=>el.closest('.modal-container').querySelector('.modal-close-button,.modal-header-button').click();
const shot=async(name)=>{await wait(250);const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(SHOTS+'/'+FORM+'-'+name+'.png',image.toPNG())};
const editor=()=>visible('.abele-folder-access .abele-node-scope-editor')||visible('.abele-chat-setup .abele-node-scope-editor');
const approve=async()=>{editor().querySelector('.abele-node-scope-editor__approve').click();await until(()=>!editor().querySelector('.abele-status-dot_orange'),'local approval');if(editor().querySelector('.abele-node-scope-editor__approve'))throw Error('Approval action stayed after confirmation')};
const openFolder=async()=>{
 const root=visible('.abele-ai-chat'),current=root.querySelector('.abele-chat-switch__current');
 if(!visible('.abele-chat-tree'))current.click();
 const more=await until(()=>[...document.querySelectorAll('.abele-chat-tree__folder button')].find(el=>el.getAttribute('aria-label')==='Sample node collection: more'),'folder menu');
 more.click();
 const access=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='Access…'),'folder access item');
 access.click();await until(()=>visible('.abele-folder-access'),'folder access');
 await until(()=>editor().querySelector('[role=listitem]'),'node row');
};
`
async function review(form: 'desktop' | 'phone') {
  await withNode(async ({ port, token, stop }) => {
    const setup = `(async()=>{const SHOTS=${JSON.stringify(resolve(shots))},FORM=${JSON.stringify(form)};${prelude}
      const prior=chats.activeTabId.value;
      const registration=await nodes.add('Sample node','http://127.0.0.1:${port}',${JSON.stringify(token)});
      window.__folderNodeReview={registration:registration.id,prior};
      await until(()=>nodes.connection(registration.id).client.connected,'connected');
      await chats.folders.create('','Sample node collection');
      const entry={kind:'node',node_id:registration.expectedNodeId,access:'read'};
      await chats.folders.setNodeScope('Sample node collection',[entry]);
      const session=chats.getSession(await chats.newTab());session.chatTitle.value='Sample inherited node access';
      await session.createInDirectory(chats.folders.path(''));
      Object.assign(window.__folderNodeReview,{chat:session.id,path:session.currentChatFile.value.path,entry});
      await chats.folders.move(session.id,'Sample node collection');
      await chats.revealSidebar({focus:false});await wait(250);
      await openFolder();
      await until(()=>editor().querySelector('.abele-status-dot_orange'),'unapproved dot');
      if(editor().querySelector('.abele-status-dot_faint'))throw Error('Connected node marked disconnected');
      if(editor().textContent.includes('Local approval')||editor().textContent.includes('No nodes connected'))throw Error('Contradictory block remains');
      const headings=[...visible('.abele-folder-access').querySelectorAll('h3')].map(el=>el.textContent);
      if(JSON.stringify(headings)!==JSON.stringify(['Nodes','Tools']))throw Error('Unexpected groups: '+headings);
      await shot('folder-unapproved');
      await approve();
      await shot('folder-connected-approved');
      const mode=editor().querySelector('.abele-node-scope-editor__mode');
      if(!mode.classList.contains('clickable-icon')||!mode.querySelector('[data-lucide=eye],.lucide-eye'))throw Error('Own read mode is not an eye action');
      mode.click();
      const edit=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='read and edit'),'mode menu');
      edit.click();await until(()=>chats.folders.nodeScopeForFolder('Sample node collection')[0]?.access==='edit','mode changed');
      editor().querySelector('.abele-node-scope-editor__mode').click();
      const read=await until(()=>[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()==='read'),'read mode');read.click();
      await until(()=>chats.folders.nodeScopeForFolder('Sample node collection')[0]?.access==='read','read restored');
      await until(()=>!editor().querySelector('.abele-status-dot_orange'),'mode approved');
      close(visible('.abele-folder-access'));await until(()=>!visible('.abele-folder-access'),'folder closed');
      const root=visible('.abele-ai-chat');
      if(visible('.abele-chat-tree'))root.querySelector('.abele-chat-switch__current').click();
      root.querySelector('.abele-chat-input__scope').click();await until(()=>visible('.abele-chat-setup .abele-node-scope-editor'),'chat access');
      await until(()=>!editor().querySelector('.abele-status-dot_orange'),'inherited approved');
      const inherited=editor().querySelector('[role=listitem]');
      if(inherited.querySelector('.abele-scope-mgr__entry-remove')||inherited.querySelector('.abele-node-scope-editor__mode').classList.contains('clickable-icon'))throw Error('Inherited access can be edited here');
      if(!inherited.textContent.includes('From the folder Sample node collection'))throw Error('Inherited source missing');
      await shot('chat-inherited-approved');
      inherited.querySelector('.abele-node-scope-editor__folder').click();await until(()=>visible('.abele-folder-access'),'source folder opens');
      close(visible('.abele-folder-access'));await until(()=>!visible('.abele-folder-access'),'source closed');
      await chats.folders.setNodeScope('Sample node collection',[]);
      await chats.folders.setNodeScope('Sample node collection',[entry]);
      await until(()=>editor().querySelector('.abele-status-dot_orange'),'inherited unapproved');
      await shot('chat-inherited-unapproved');
      if(session.overrides.value.nodeScope?.length)throw Error('Inherited scope copied into chat');
      close(visible('.abele-chat-setup'));await until(()=>!visible('.abele-chat-setup'),'chat closed');
      await openFolder();await approve();
      return JSON.stringify(true);
    })()`
    try {
      expect(JSON.parse(await evalLong(setup, 120000))).toBe(true)
      await stop()
      expect(
        JSON.parse(
          await evalLong(
            `(async()=>{const SHOTS=${JSON.stringify(resolve(shots))},FORM=${JSON.stringify(form)};${prelude}
        await until(()=>editor().querySelector('.abele-status-dot_faint'),'disconnected dot');
        if(editor().textContent.includes('No nodes connected'))throw Error('Disconnected grant shown as empty');
        if(editor().querySelector('.abele-status-dot_orange'))throw Error('Transport loss removed local confirmation');
        await shot('folder-disconnected');
        await chats.folders.setNodeScope('Sample node collection',[]);
        await nodes.remove(window.__folderNodeReview.registration);
        editor().querySelector('[aria-label="Refresh nodes"]').click();
        await until(()=>editor().textContent.includes('No nodes connected here'),'empty');
        if(editor().querySelector('[role=listitem]')||editor().querySelector('.abele-status-dot_orange'))throw Error('Empty section retains grant state');
        if(nodes.nodes.value.length)throw Error('Expected no known nodes');
        await shot('folder-empty');
        return JSON.stringify(true);
      })()`,
            30000
          )
        )
      ).toBe(true)
    } finally {
      await evalLong(
        `(async()=>{const T=window.__abeleTest,chats=T.ChatService.getInstance(),nodes=T.NodeService.getInstance(),state=window.__folderNodeReview;
        for(const close of [...document.querySelectorAll('.modal-container .modal-close-button,.modal-container .modal-header-button')].reverse())close.click();
        if(state?.chat&&chats.getSession(state.chat))await chats.closeTab(state.chat);
        if(state?.path&&app.vault.getAbstractFileByPath(state.path))await T.ChatStorage.getInstance().deleteChat(state.path);
        if(chats.folders.paths.includes('Sample node collection'))await chats.folders.remove('Sample node collection');
        if(state?.registration&&nodes.registry.list().some(node=>node.id===state.registration))await nodes.remove(state.registration);
        if(state?.prior)chats.switchTab(state.prior);
        delete window.__folderNodeReview;
        return JSON.stringify(true);
      })()`,
        30000
      )
    }
  })
}
it('shows the six folder and inherited-access states on desktop', async () => {
  await review('desktop')
}, 180000)
it('shows the same six states at 390 by 844', async () => {
  await withEmulatedPhone(() => review('phone'))
}, 180000)
