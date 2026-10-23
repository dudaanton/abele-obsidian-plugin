import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-manager-notices')

async function inspect(label: string) {
  try {
    const report = JSON.parse(
      await evalLong(`(async()=>{
      const api=window.__abeleTest,chats=api.ChatService.getInstance(),id=chats.createTab();
      const session=chats.getSession(id);
      window.__sampleNoticeChat=id;
      session.runAgentLoop=async()=>{};session.afterTurn=async()=>{};session.checkAnswer=async()=>{};
      await session.addUserNote('Sample manager notice probe');
      await session.saveForRelease();
      if(!session.currentChatFile.value)throw Error('Sample parent chat was not saved');
      await chats.revealSidebar({focus:false});
      const previous=session.messages.value.length;
      session.wakeDelegationResult('sample-hidden-id','Read node_command_status for sample-hidden-id');
      for(let i=0;i<100&&session.messages.value.length===previous;i++)await new Promise(r=>setTimeout(r,50));
      const notice=session.messages.value.at(-1);
      if(notice?.role!=='system'||notice.sessionMark?.text!=='Node activity update')throw Error('Wake was not retained as a system notice');
      await new Promise(r=>setTimeout(r,100));
      const transcript=document.querySelector('.abele-ai-chat .abele-ai-chat__messages');
      return JSON.stringify({text:transcript?.textContent,noticeRows:[...transcript.querySelectorAll('.abele-chat-msg_system')].filter(row=>row.textContent.includes('Node activity update')).length});
    })()`)
    ) as { text: string; noticeRows: number }
    expect(report.text).not.toContain('sample-hidden-id')
    expect(report.noticeRows).toBe(0)
    columnShot(`${shots}/${label}-wake.png`)
    const queued = await evalLong(`(async()=>{
      const session=window.__abeleTest.ChatService.getInstance().activeSession.value;
      session.isStreaming.value=true;
      session.wakeDelegationResult('sample-hidden-queued-id','Read node_command_status for sample-hidden-queued-id');
      await new Promise(r=>setTimeout(r,100));
      return document.querySelector('.abele-ai-chat__queued')?.textContent??'';
    })()`)
    expect(queued).toContain('Node activity update')
    expect(queued).not.toContain('sample-hidden-queued-id')
    columnShot(`${shots}/${label}-queued-wake.png`)
    await evalLong(
      `(async()=>{const session=window.__abeleTest.ChatService.getInstance().activeSession.value;session.isStreaming.value=false;await session.drainQueue()})()`
    )
  } finally {
    await evalLong(
      '(async()=>{const api=window.__abeleTest;if(window.__sampleNoticeChat)await api.ChatService.getInstance().deleteChat(window.__sampleNoticeChat);delete window.__sampleNoticeChat})()'
    )
  }
}

async function inspectEscalation(label: string) {
  try {
    await evalLong("window.__abeleTest.openDialog('node-manager-run', {managerCodexApproval:true})")
    const report = JSON.parse(
      await evalLong(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('[data-manager-command]');i++)await new Promise(r=>setTimeout(r,50));
      const root=document.querySelector('.abele-tool-approval');
      return JSON.stringify({text:root?.textContent,overflow:root?.scrollWidth>root?.clientWidth+1});
    })()`)
    ) as { text: string; overflow: boolean }
    expect(report.text).toContain("npm test -- 'sample case'")
    expect(report.text).toContain('/workspace/sample-project')
    expect(report.text).toContain('Run the sample checks')
    expect(report.text).not.toContain('sample-hidden-thread')
    expect(report.overflow).toBe(false)
    columnShot(`${shots}/${label}-escalation.png`)
  } finally {
    await evalLong(
      `(async()=>{const root=document.querySelector('.abele-node-manager-run');const close=[...(root?.closest('.modal-container')?.querySelectorAll('.modal-header-button,.modal-close-button')??[])].find(el=>el.getBoundingClientRect().width);if(close)close.click();else document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));for(let i=0;i<100&&root?.isConnected;i++)await new Promise(r=>setTimeout(r,50));if(root?.isConnected)throw Error('Sample command dialog did not close')})()`
    )
  }
}

it('retains delivered wakes without empty transcript rows and shows queued notices', async () => {
  await inspect(onPhone() ? 'phone' : 'desktop')
  await inspectEscalation(onPhone() ? 'phone' : 'desktop')
}, 60000)

it.skipIf(onPhone())(
  'fits the phone layout',
  async () => {
    try {
      await enterPhone()
      await inspect('phone-emulated')
      await inspectEscalation('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  90000
)
