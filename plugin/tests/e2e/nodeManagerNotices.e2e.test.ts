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
      const api=window.__abeleTest,id=await api.openRegularChatFixture();
      const session=api.ChatService.getInstance().getSession(id);
      window.__sampleNoticeChat=id;
      session.runAgentLoop=async()=>{};session.afterTurn=async()=>{};session.checkAnswer=async()=>{};
      await session.saveForRelease();
      const previous=session.messages.value.length;
      session.wakeDelegationResult('sample-hidden-id','Read node_command_status for sample-hidden-id');
      for(let i=0;i<100;i++){
        if(session.messages.value.length>previous&&[...document.querySelectorAll('.abele-ai-chat .abele-chat-msg')].at(-1)?.textContent.includes('Node activity update'))break;
        await new Promise(r=>setTimeout(r,50));
      }
      const rows=[...document.querySelectorAll('.abele-ai-chat .abele-chat-msg')],row=rows.at(-1);
      row?.scrollIntoView({block:'center'});
      return JSON.stringify({system:row?.classList.contains('abele-chat-msg_system'),text:row?.textContent,overflow:row?.scrollWidth>row?.clientWidth+1});
    })()`)
    ) as { system: boolean; text: string; overflow: boolean }
    expect(report.system).toBe(true)
    expect(report.text).not.toContain('sample-hidden-id')
    expect(report.text).toContain('Node activity update')
    expect(report.overflow).toBe(false)
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
      '(async()=>{const api=window.__abeleTest;if(window.__sampleNoticeChat)await api.ChatService.getInstance().deleteChat(window.__sampleNoticeChat);await api.closeRegularChatFixture();delete window.__sampleNoticeChat})()'
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
      "document.querySelector('.abele-node-manager-run')?.closest('.modal-container')?.querySelector('.modal-close-button')?.click()"
    )
  }
}

it('renders manager wakes as a quiet system row', async () => {
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
