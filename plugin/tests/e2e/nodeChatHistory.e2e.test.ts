import { expect, it } from 'vitest'
import { enterPhone, evalLong, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-chat-history')

it.each(onPhone() ? ['phone'] : ['desktop', 'phone emulation'])(
  'binds explicit file rollback to the shown checkpoint preview on %s',
  async (layout) => {
    try {
      if (layout === 'phone emulation') await enterPhone(390, 844)
      const result = JSON.parse(
        await evalLong(
          `(async()=>{
        const wait=ms=>new Promise(r=>setTimeout(r,ms));
        const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await wait(50)}throw Error('History state not rendered: '+fn.toString())};
        const chats=window.__abeleTest.ChatService.getInstance(),active=chats.activeTabId.value;
        const shot=async name=>{await until(()=>document.querySelector("[data-history-confirm]").getBoundingClientRect().bottom<=innerHeight-8);await wait(100);const path=${JSON.stringify(shots)}+'/'+name+(app.isMobile?'-phone':'-desktop')+'.png';if(window.__e2eHost){const r=await window.__e2eHost.shot(path);if(String(r).startsWith('no picture:'))throw Error(r)}else{const fs=require('fs');fs.mkdirSync(${JSON.stringify(shots)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}};
        try{
          await window.__abeleTest.openNodeSessionFixture('empty');
          const p=chats.getNodeSession(chats.activeTabId.value),session=p.reference.sessionId,client=p.connection.client,store=client.store;
          client.channel={channel:{welcome:{methods:['chat.checkpoints','chat.preview','chat.restore']}}};
          const point={checkpoint_id:'sample-checkpoint',input_id:'sample-input',before_seq:1,exclude_input_ids:['sample-input']};
          const preview={preview_id:'a'.repeat(64),changes:[{path:'src/sample.ts',current:'b'.repeat(64),checkpoint:'c'.repeat(64)}],files:[{path:'src/sample.ts',before_base64:btoa('export const greeting = "welcome";'),after_base64:btoa('export const greeting = "hello";'),before_mode:33188,after_mode:33188,truncated:false}]};
          const calls=[];
          client.chat={checkpoints:async()=>[point],preview:async()=>preview,restore:async params=>{calls.push(params);return {session_id:session}}};
          const first=await store.transaction(s=>s.events[session][0]);
          const events=[{...first,data:{...first.data,provider:'pi'}}];
          const append=(type,data)=>events.push({kind:'event',node_id:p.reference.nodeId,stream_id:session,seq:events.length+1,type,data,actor:{kind:'node'},at:new Date().toISOString()});
          append('input.accepted',{input_id:'sample-input',text:'Change the sample greeting.',mapped:true});
          append('session.update',{update:{kind:'user_message',message_id:'sample-input',text:'Change the sample greeting.'}});
          append('turn.started',{turn_id:'sample-turn',run_id:'sample-process',input_ids:['sample-input']});
          append('session.update',{turn_id:'sample-turn',update:{kind:'agent_message',message_id:'sample-answer',text:'The greeting was changed.'}});
          append('turn.completed',{turn_id:'sample-turn',run_id:'sample-process',input_ids:['sample-input'],outcome:'success'});
          await store.transaction(s=>{s.events[session]=events;s.cursors[session]=events.length});await p.refresh();
          p.binding.value={project_id:'sample-project',target:{kind:'worktree',worktree_id:'sample-tree'},incarnation:'sample-binding'};
          p.nodeDescription.value={...p.nodeDescription.value};await p.history.read();
          await until(()=>p.historyState('input:sample-input')?.reason==='');
          const open=async(label='Rewind',ready=true)=>{const button=document.querySelector('.abele-node-chat .abele-chat-msg_user [aria-haspopup="menu"]');if(!button)throw Error('Missing user history menu');button.click();await until(()=>[...document.querySelectorAll('.menu-item')].some(el=>el.textContent.trim()===label));[...document.querySelectorAll('.menu-item')].find(el=>el.textContent.trim()===label).click();await until(()=>document.querySelector('[data-history-confirm]')&&(!ready||!document.querySelector('[data-history-confirm]').disabled))};
          const close=async()=>{document.querySelector('[data-history-cancel]').click();await until(()=>!document.querySelector('[data-history-confirm]'));await wait(100)};
          await open();
          const untouched=calls.length===0&&!document.querySelector('.abele-node-rewind .checkbox-container').classList.contains('is-enabled');
          document.querySelector('.abele-node-rewind .tree-item-self').click();await wait(150);await shot('rewind-preview');
          await close();
          const canceled=calls.length===0;
          await open();document.querySelector('.abele-node-rewind .tree-item-self').click();document.querySelector('.abele-node-rewind .checkbox-container').click();await wait(100);await shot('rewind-explicit-files');
          const confirmedLabel=document.querySelector('[data-history-confirm]').textContent.includes('Put files back');
          document.querySelector('[data-history-confirm]').click();await until(()=>calls.length===1);await wait(100);
          await until(()=>!document.querySelector('[data-history-confirm]')&&!p.historyBusy.value);
          client.chat.preview=async()=>({...preview,changes:[],files:[]});await open();await shot('rewind-empty');await close();
          const longPath='src/'+('sample-folder/').repeat(7)+'sample.ts';
          client.chat.preview=async()=>({...preview,changes:preview.changes.map(change=>({...change,path:longPath})),files:preview.files.map(file=>({...file,path:longPath,truncated:true}))});
          await open();document.querySelector('.abele-node-rewind .tree-item-self').click();await wait(100);await shot('rewind-partial-long');await close();
          client.chat.preview=async()=>{throw Error('The sample checkpoint preview is unavailable.')};await open('Rewind',false);await until(()=>document.querySelector('[data-history-refresh]'));await shot('rewind-error');await close();
          await open('Edit');const area=document.querySelector('.abele-node-rewind textarea');if(!area)throw Error('Missing replacement message editor');area.value='Sample replacement message. '.repeat(60);area.dispatchEvent(new Event('input',{bubbles:true}));await wait(100);await shot('edit-long');await close();
          if(calls.length!==1)throw Error('Preview, edit or cancel unexpectedly restored history');
          return JSON.stringify({untouched,canceled,confirmedLabel,exact:JSON.stringify(calls[0].restore_files)===JSON.stringify({preview_id:preview.preview_id,changes:preview.changes}),action:calls[0].action});
        }finally{await window.__abeleTest.closeNodeSessionFixture();chats.activeTabId.value=active}
      })()`,
          90000
        )
      )
      expect(result).toEqual({
        untouched: true,
        canceled: true,
        confirmedLabel: true,
        exact: true,
        action: 'rewind',
      })
    } finally {
      if (layout === 'phone emulation') await reloadApp('app.emulateMobile(false)')
    }
  },
  120000
)
