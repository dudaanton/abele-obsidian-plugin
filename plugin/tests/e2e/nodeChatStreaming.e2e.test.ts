import { expect, it } from 'vitest'
import { enterPhone, evalLong, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-chat-streaming')
const ANSWERS = [
  'The first answer stays complete while the next answer arrives.',
  'The second answer is arriving.',
  'The third answer follows separately.',
]

it.each(onPhone() ? ['phone'] : ['desktop', 'phone emulation'])(
  'keeps completed answers visible while later answers stream on %s',
  async (layout) => {
    try {
      if (layout === 'phone emulation') await enterPhone(390, 844)
      const result = JSON.parse(
        await evalLong(
          `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, what) => {
      for(let i=0;i<200;i++){if(fn())return;await wait(50)}
      await shot('node-streaming-error');
      const drawn=[...document.querySelectorAll('.abele-node-chat [data-node-message]')].map(el=>({id:el.dataset.nodeMessage,text:el.querySelector('.abele-markdown')?.textContent}));
      throw Error(what + ' did not render: ' + JSON.stringify(drawn));
    };
    const chats = window.__abeleTest.ChatService.getInstance(), active = chats.activeTabId.value;
    const answer = ${JSON.stringify(ANSWERS[0])};
    const shot = async name => {
      const path = ${JSON.stringify(shots)} + '/' + name + (app.isMobile ? '-phone' : '-desktop') + '.png';
      if(window.__e2eHost){const r=await window.__e2eHost.shot(path);if(String(r).startsWith('no picture:'))throw Error(r)}
      else {const fs=require('fs');fs.mkdirSync(${JSON.stringify(shots)},{recursive:true});fs.writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())}
    };
    try {
      await window.__abeleTest.openNodeSessionFixture('working');
      const p=chats.getNodeSession(chats.activeTabId.value),root=()=>document.querySelector('.abele-node-chat');
      const session=p.reference.sessionId,store=p.connection.client.store;
      const events=[await store.transaction(s=>s.events[session][0])];
      const append=(type,data)=>events.push({kind:'event',node_id:p.reference.nodeId,stream_id:session,seq:events.length+1,type,data,actor:type==='session.update'?{kind:'provider',provider:'claude',session_id:session}:{kind:'node'},at:new Date().toISOString()});
      const publish=async()=>{await store.transaction(s=>{s.events[session]=events.slice();s.cursors[session]=events.length});await p.refresh()};
      const say=(id,content,final=false)=>append('session.update',{run_id:'sample-stream',update:{kind:final?'agent_message':'agent_message_chunk',message_id:id,text:content}});
      const messageId=id=>JSON.stringify(['claude','sample-stream','',id]);
      const text=id=>[...root()?.querySelectorAll('[data-node-message]')??[]].find(el=>el.dataset.nodeMessage===messageId(id))?.querySelector('.abele-markdown')?.textContent.trim();
      append('run.started',{run_id:'sample-stream'});say('first',answer,true);await publish();
      await until(()=>text('first')===answer, 'The first answer');
      const failures=[];
      for(let n=2;n<=3;n++){
        const chunks=n===2?['The second',' answer',' is arriving.']:['The third',' answer',' follows separately.'];
        for(const chunk of chunks){
          say('answer-'+n,chunk);await publish();
          await wait(120);
          if(text('first')!==answer)failures.push(n+':'+chunk);
        }
      }
      await until(()=>text('answer-3')===${JSON.stringify(ANSWERS[2])}, 'The streamed answer');
      const answers=[...root().querySelectorAll('.abele-chat-msg_assistant .abele-markdown')].map(el=>el.textContent.trim());
      const picker=root().querySelector('.abele-node-chat__agent'),label=picker.querySelector('.abele-obsidian-button__label'),chevron=picker.querySelector('.abele-obsidian-button__trailing-icon');
      const pickerFailures=[];
      if(!label||!chevron)pickerFailures.push('Missing contained label or chevron');
      else {
        const p=picker.getBoundingClientRect(),l=label.getBoundingClientRect(),c=chevron.getBoundingClientRect(),s=getComputedStyle(picker),ls=getComputedStyle(label);
        if(l.left<p.left+parseFloat(s.paddingLeft)-1||l.right>c.left+1||c.right>p.right-parseFloat(s.paddingRight)+1)pickerFailures.push('Label or chevron escapes the pill');
        if(label.scrollWidth>label.clientWidth+1&&!(ls.overflow==='hidden'&&ls.textOverflow==='ellipsis'&&ls.whiteSpace==='nowrap'))pickerFailures.push('Clipped label has no ellipsis');
        if(p.right>root().querySelector('.abele-ai-chat__header-actions').getBoundingClientRect().left+1)pickerFailures.push('Picker overlaps header actions');
      }
      root().querySelector('.abele-ai-chat__messages').scrollTop=1e6;
      await wait(150);await shot('node-streaming-messages');
      const working=!!root().querySelector('[aria-label="Agent is working"]'),stop=!!root().querySelector('.abele-chat-input__stop');
      await shot('node-streaming-working');
      const permission={session_id:session,run_id:'sample-stream',prompt_id:'sample-permission',revision:1,action_digest:'a'.repeat(64),kind:'permission',state:'pending',choice:null,installation_id:null,delivered:false,title:'mcp__abele_debugger__debug_status',tool_name:'mcp__abele_debugger__debug_status',input:{},expires_at:Date.now()+300000};
      append('prompt.requested',permission);await publish();
      await until(()=>root().querySelector('.abele-node-permission'), 'The permission card');
      root().querySelector('.abele-ai-chat__messages').scrollTop=1e6;await wait(150);
      await shot('node-streaming-permission');
      const card=root().querySelector('.abele-node-permission');
      const readable=card.querySelector('.abele-tool-approval__header').textContent.trim()==='Debugger: status';
      const nativeDetails=!!card.querySelector('details');
      const clipped=[...card.querySelectorAll('button,.clickable-icon')].some(el=>{const r=el.getBoundingClientRect();return r.width&&(r.left<0||r.right>innerWidth+1)});
      append('prompt.resolved',{...permission,state:'resolved',choice:'allow',delivered:true});await publish();
      await until(()=>root().querySelector('.abele-node-permission .abele-result-mark'), 'The decision outcome');
      await shot('node-streaming-permission-delivered');
      append('run.completed',{run_id:'sample-stream'});await publish();await wait(100);
      return JSON.stringify({answers,pickerFailures,failures,working,stop,readable,nativeDetails,clipped,stopped:!root().querySelector('[aria-label="Agent is working"]')});
    } finally {
      await window.__abeleTest.closeNodeSessionFixture();chats.activeTabId.value=active;
    }
  })()`,
          90000
        )
      )
      expect(result).toEqual({
        answers: ANSWERS,
        pickerFailures: [],
        failures: [],
        working: true,
        stop: true,
        readable: true,
        nativeDetails: false,
        clipped: false,
        stopped: true,
      })
    } finally {
      if (layout === 'phone emulation') await reloadApp('app.emulateMobile(false)')
    }
  },
  120000
)
