import { expect, it } from 'vitest'
import { enterPhone, evalLong, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-chat-acceptance')

it.each(onPhone() ? ['phone'] : ['desktop', 'phone emulation'])(
  'keeps node chat turns, decisions and failures readable on %s',
  async (layout) => {
    try {
      if (layout === 'phone emulation') await enterPhone(390, 844)
      const result = JSON.parse(
        await evalLong(
          `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async fn => { for (let i=0;i<100;i++) { if(fn())return;await wait(50) } throw Error('Node chat acceptance state did not render: '+fn.toString()) };
        const chats=window.__abeleTest.ChatService.getInstance(),active=chats.activeTabId.value;
        const shot=async name=>{
          const path=${JSON.stringify(shots)}+'/'+name+(app.isMobile?'-phone':'-desktop')+'.png';
          if(window.__e2eHost){const r=await window.__e2eHost.shot(path);if(String(r).startsWith('no picture:'))throw Error(r)}
          else {const fs=require('fs');fs.mkdirSync(${JSON.stringify(shots)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
        };
        try {
          await window.__abeleTest.openNodeSessionFixture('empty');
          const p=chats.getNodeSession(chats.activeTabId.value),session=p.reference.sessionId,store=p.connection.client.store;
          p.control.state.value.settings={...p.control.state.value.settings,model:'sample/model-a',account:'sample-account',permission_mode:'manual'};
          p.providerReports.value=[{provider:'pi',available:true,capabilities:{},configuration:{models:['sample/model-a','sample/model-b'],accounts:['sample-account']}}];
          const first=await store.transaction(s=>s.events[session][0]);
          const events=[{...first,data:{...first.data,provider:'pi'}}];
          const append=(type,data)=>events.push({kind:'event',node_id:p.reference.nodeId,stream_id:session,seq:events.length+1,type,data,actor:{kind:'node'},at:new Date().toISOString()});
          const publish=async trim=>{await store.transaction(s=>{s.events[session]=trim?events.slice(-trim):events.slice();s.cursors[session]=events.length});await p.refresh();await wait(80)};
          const root=()=>document.querySelector('.abele-node-chat');
          await publish();
          await until(()=>root()?.querySelector('.abele-node-chat__agent')?.getAttribute('aria-label')==='Agent: pi. Start a chat with another');
          const emptyCorrect=!root().textContent.includes('Fake (non-executing)')&&root().querySelectorAll('.abele-chat-msg_user,.abele-chat-msg_assistant').length===0;
          const modelPresent=p.live.value.settings.model==='sample/model-a'&&p.live.value.choices.models.length===2&&p.live.value.choices.accounts[0].label==='sample-account';
          await shot('node-chat-empty');
          const priorModel = p.control.state.value.settings.model;
          p.control.state.value.settings.model = 'gpt-9.7-sol';
          await until(()=>root().querySelector('.abele-session-settings')?.getAttribute('aria-label')?.includes('GPT-9.7'));
          if(root().querySelector('.abele-session-settings__model')?.textContent==='gpt-9.7-sol')throw Error('Raw model id replaced its display family');
          await shot('node-chat-model-label');
          p.control.state.value.settings.model = priorModel;
          const scope={run_id:'sample-process',runtime_generation:1};
          const input=(id,text)=>append('input.accepted',{input_id:id,text});
          const start=id=>append('turn.started',{run_id:scope.run_id,input_ids:[id]});
          const finish=id=>append('turn.completed',{run_id:scope.run_id,input_ids:[id],outcome:'success'});
          const answer=(id,text)=>append('pi.message.final',{...scope,message_id:id,message:{role:'assistant',content:[{type:'text',text}]}});
          input('first','Change the sample greeting.');start('first');
          append('pi.message.final',{...scope,message_id:'tool-snapshot',message:{role:'assistant',content:[{type:'toolCall',id:'sample-edit',name:'edit',arguments:{path:'src/sample.ts',oldText:'hello',newText:'welcome'}}]}});
          const prompt={prompt_id:'sample-prompt',session_id:session,run_id:scope.run_id,revision:1,action_digest:'a'.repeat(64),kind:'permission',tool_use_id:'sample-edit',tool_name:'edit',input:{path:'src/sample.ts',oldText:'hello',newText:'welcome'},title:'Edit sample.ts',expires_at:Date.now()+300000,state:'pending',choice:null,installation_id:null,delivered:false};
          append('prompt.created',prompt);await publish();await shot('node-chat-pending-edit');
          append('prompt.resolved',{...prompt,state:'resolved',choice:'allow',delivered:true});
          append('pi.tool.result',{...scope,tool_use_id:'sample-edit',result:'Changed the greeting.'});
          answer('answer-1','The greeting is now welcome.');finish('first');await publish();
          for(let i=0;i<10;i++)append('session.update',{run_id:scope.run_id,update:{kind:'notice',level:'info',text:'Diagnostics for src/sample.ts: no problems'}});
          await publish();
          if(root().textContent.includes('no problems'))throw Error('Clean diagnostic notices filled the chat');
          const collapsed=!root().querySelector('.abele-node-permission');
          await shot('node-chat-resolved-edit');
          const run=root().querySelector('.abele-chat-run .abele-tree-item__self')||root().querySelector('.abele-chat-run .tree-item-self');
          if(!run)throw Error('Missing tool disclosure');run.click();await wait(100);
          root().querySelector('.abele-node-permission')?.scrollIntoView({block:'center'});await wait(100);
          const retained=!!p.messages.value.find(m=>m.role==='tool-call')?.toolDiff;
          await shot('node-chat-retained-diff');
          for(let n=2;n<=5;n++){
            input('input-'+n,'Sample follow-up '+n);start('input-'+n);
            answer('answer-'+n,'Separate answer '+n);finish('input-'+n);
            await publish(8);
          }
          const questions=[...root().querySelectorAll('.abele-chat-msg_user .abele-markdown')].map(el=>el.textContent.trim());
          const ordered=questions.length===5&&questions[0]==='Change the sample greeting.'&&questions[4]==='Sample follow-up 5';
          await shot('node-chat-multiple-turns');
          input('stop-input','Read a long sample.');start('stop-input');
          append('pi.tool.call',{...scope,tool_use_id:'sample-read',name:'read',input:{path:'sample.txt'}});
          append('pi.message.final',{...scope,message_id:'stop-answer',message:{role:'assistant',content:[],stopReason:'error',errorMessage:'provider_error'}});
          append('turn.completed',{run_id:scope.run_id,input_ids:['stop-input'],outcome:'interrupted'});await publish();
          await until(()=>root().textContent.includes('Stopped by you'));
          const stopped=!root().textContent.includes('The model request failed')&&!p.messages.value.some(m=>m.error);
          const scroll=root().querySelector('.abele-ai-chat__messages');scroll.scrollTop=scroll.scrollHeight;await wait(80);await shot('node-chat-stopped');
          input('failed-input','Start a sample task.');
          append('session.process',{run_id:'sample-start',state:'exited',reason:'pi_host_failed',error:'Sample configuration is invalid'});await publish();
          scroll.scrollTop=scroll.scrollHeight;await wait(80);await shot('node-chat-start-failed');
          const failed=root().textContent.includes('Sample configuration is invalid')&&!p.projection.value.queuedInputs.length;
          const attach=!!root().querySelector('button[aria-label="Attach a file"]');
          input('cancel-input','Edit a sample file.');
          append('run.started',{run_id:'sample-cancel-run',input_id:'cancel-input'});
          append('pi.tool.call',{run_id:'sample-cancel-run',tool_use_id:'sample-cancel-edit',name:'edit',input:{path:'sample.txt'}});
          append('prompt.resolved',{...prompt,prompt_id:'sample-cancel-prompt',run_id:'sample-cancel-run',tool_use_id:'sample-cancel-edit',state:'invalidated',choice:'deny'});
          append('pi.tool.result',{run_id:'sample-cancel-run',tool_use_id:'sample-cancel-edit',is_error:true,result:'Node denied, expired or lost this exact approval'});
          append('run.interrupted',{run_id:'sample-cancel-run'});await publish();
          if(root().textContent.includes('User rejected this action')||root().textContent.includes('Denied:'))throw Error('Stop was shown as an owner denial');
          scroll.scrollTop=scroll.scrollHeight;await wait(80);await shot('node-chat-approval-cancelled');
          append('pi.tool.call',{run_id:'sample-close-run',tool_use_id:'sample-close-create',name:'create',input:{path:'sample-close.txt'}});
          append('prompt.resolved',{...prompt,prompt_id:'sample-close-prompt',run_id:'sample-close-run',tool_use_id:'sample-close-create',tool_name:'create',title:'Create sample-close.txt',input:{path:'sample-close.txt'},state:'resolved',choice:'deny',installation_id:null});
          append('pi.tool.result',{run_id:'sample-close-run',tool_use_id:'sample-close-create',is_error:true,result:'Node denied, expired or lost this exact approval'});
          append('pi.tool.call',{run_id:'sample-retry-run',tool_use_id:'sample-retry-create',name:'create',input:{path:'sample-close.txt'}});
          append('prompt.resolved',{...prompt,prompt_id:'sample-retry-prompt',run_id:'sample-retry-run',tool_use_id:'sample-retry-create',tool_name:'create',title:'Create sample-close.txt',input:{path:'sample-close.txt'},state:'resolved',choice:'allow',installation_id:'sample-owner-installation'});
          append('pi.tool.result',{run_id:'sample-retry-run',tool_use_id:'sample-retry-create',result:'Created sample-close.txt'});await publish();
          if(root().textContent.includes('User rejected this action')||root().textContent.includes('Denied:'))throw Error('Client closure was shown as an owner denial after retry');
          scroll.scrollTop=scroll.scrollHeight;await wait(80);await shot('node-chat-closure-and-retry');
          return JSON.stringify({emptyCorrect,modelPresent,collapsed,retained,ordered,stopped,failed,attach});
        } finally { await window.__abeleTest.closeNodeSessionFixture();chats.activeTabId.value=active }
      })()`,
          90000
        )
      )
      expect(result).toEqual({
        emptyCorrect: true,
        modelPresent: true,
        collapsed: true,
        retained: true,
        ordered: true,
        stopped: true,
        failed: true,
        attach: true,
      })
    } finally {
      if (layout === 'phone emulation') await reloadApp('app.emulateMobile(false)')
    }
  },
  120000
)
