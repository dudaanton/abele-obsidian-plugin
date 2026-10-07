import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
targets('desktop')
const shots = process.env.NODE_PRESENTATION_SHOTS ?? '/tmp/abele-node-presentation'
it('keeps desktop node headers, approvals, queued inputs and workspace controls compact', () => {
  const result = evalAsync<{ header: number; titleWidth: number; queueCopies: number; sameActionRow: boolean; accent: boolean; cardsClipped: string[]; paths: boolean }>(`(async () => {
    const wait=ms=>new Promise(r=>setTimeout(r,ms)), until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await wait(50)}throw Error('Node presentation fixture did not render')}
    const chats=window.__abeleTest.ChatService.getInstance(),active=chats.activeTabId.value,layout=app.workspace.getLayout()
    const win=require('@electron/remote').getCurrentWindow(),bounds=win.getBounds(),fs=require('fs');fs.mkdirSync(${JSON.stringify(shots)},{recursive:true})
    const messages=[{id:'reply',role:'assistant',content:'**Completed:** a sample edit.',thinking:'Sample exposed reasoning.',timestamp:0},{id:'tool',role:'tool-call',content:'Allowed by your Claude settings',toolName:'Edit',toolParams:{file_path:'sample.txt'},toolResult:'Edited',toolStatus:'approved',toolDiff:{old:'before',new:'after'},timestamp:0},{id:'input:followup',role:'user',content:'Sample queued follow-up',timestamp:0}]
    const presenter={id:'desktop-node-fixture',reference:{kind:'node-session',nodeId:'sample-node',registrationId:'sample-registration',sessionId:'sample-session',title:'Sample node session'},label:{value:'Sample node session'},provider:{value:'claude'},state:{value:'needs-attention'},isStreaming:{value:true},connection:{state:{value:'connected'},error:{value:''}},error:{value:''},draft:{value:{text:'',attachments:[]}},queued:{value:[]},rejected:{value:[]},messages:{value:messages},projection:{value:{activeRuns:['sample-run'],queuedInputs:[{id:'followup',text:'Sample queued follow-up'}],children:{tool:[{id:'child',role:'assistant',content:'Sample nested work',timestamp:0}]},artifacts:[],unknown:[],prompts:[{prompt_id:'sample-prompt',state:'pending',tool_name:'Bash',input:{command:'printf sample > sample-file.txt'},expires_at:Date.now()+300000}]}},send:async()=>{},answer:async()=>{},cancelInput:async()=>{},interrupt:async()=>{},openResource:()=>{},destroy:()=>{}}
    const shot=async name=>fs.writeFileSync(${JSON.stringify(shots)}+'/'+name+'.png',(await win.webContents.capturePage()).toPNG())
    const cuts=[]
    const rings=root=>{for(const field of root.querySelectorAll('input,textarea,button,[tabindex="0"]')){if(!field.getBoundingClientRect().width)continue;field.focus();const r=field.getBoundingClientRect(),reach=(${outwardBoxShadowReach.toString()})(getComputedStyle(field).boxShadow);for(let el=field.parentElement;el&&el!==document.documentElement;el=el.parentElement){const s=getComputedStyle(el);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;const b=el.getBoundingClientRect(),left=b.left+el.clientLeft;if(Math.max(left-(r.left-reach),r.right+reach-(left+el.clientWidth))>.5)cuts.push(field.getAttribute('aria-label')||field.textContent)}field.blur()}}
    try {
      win.setSize(1200,900);await wait(200)
      chats.nodeSessions.set(presenter.id,presenter);chats.tabOrder.value=[...chats.tabOrder.value,presenter.id];chats.activeTabId.value=presenter.id;await chats.revealSidebar({focus:false})
      await until(()=>document.querySelector('.abele-node-chat'));await wait(350)
      const root=document.querySelector('.abele-node-chat'),header=root.querySelector('.abele-ai-chat__header').getBoundingClientRect().height
      rings(root);await shot('desktop-node-claude-chat')
      const scroll=root.querySelector('.abele-ai-chat__messages');scroll.scrollTop=scroll.scrollHeight;await wait(100);await shot('desktop-node-claude-permission')
      const approve=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve'),deny=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Deny')
      const sameActionRow=!!approve&&!!deny&&Math.abs(approve.getBoundingClientRect().top-deny.getBoundingClientRect().top)<2,accent=!!approve?.classList.contains('mod-cta')
      const queueCopies=[...root.querySelectorAll('.abele-chat-msg_user')].filter(e=>e.textContent.includes('Sample queued follow-up')).length
      window.__abeleTest.openDialog('node-workspaces');await until(()=>document.querySelector('.abele-node-workspaces'));await wait(200)
      const modal=document.querySelector('.modal.abele-modal');rings(modal);await shot('desktop-node-workspaces')
      const paths=!!modal.querySelector('.abele-node-path summary[title]')
      for(const d of modal.querySelectorAll('details'))d.open=true;rings(modal)
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(150)
      return {header,titleWidth:root.querySelector('.abele-node-chat__title')?.getBoundingClientRect().width ?? 0,queueCopies,sameActionRow,accent,cardsClipped:cuts,paths}
    } finally {
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));chats.nodeSessions.delete(presenter.id);chats.tabOrder.value=chats.tabOrder.value.filter(id=>id!==presenter.id);chats.activeTabId.value=active
      win.setBounds(bounds);await app.workspace.changeLayout(layout)
    }
  })()`)
  expect(result.header).toBeLessThan(60)
  expect(result.titleWidth).toBeGreaterThan(130)
  expect(result.queueCopies).toBe(1)
  expect(result.sameActionRow).toBe(true)
  expect(result.accent).toBe(true)
  expect(result.cardsClipped).toEqual([])
  expect(result.paths).toBe(true)
})
