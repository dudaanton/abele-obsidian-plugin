import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-provider-modes')

it('shows owner modes, exact settings and effective delegation policy on a real screen', async () => {
  const result = JSON.parse(
    await evalLong(
      `(async () => {
    const api = window.__abeleTest;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async fn => { for(let i=0;i<200;i++){const value=fn();if(value)return value;await wait(50)}throw Error('Permission screen did not appear: '+fn) };
    const close = async () => { for(const b of document.querySelectorAll('.modal .modal-close-button'))b.click();await wait(200) };
    const shot = async name => {
      const path = ${JSON.stringify(shots)} + '/' + (app.isMobile ? 'phone-' : 'desktop-') + name + '.png';
      if(window.__e2eHost) { const r=await window.__e2eHost.shot(path);if(String(r).startsWith('no picture:'))throw Error(r) }
      else require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
    };
    const states = {};
    try {
      await api.openNodeSessionFixture('idle');
      const chats=api.ChatService.getInstance(), presenter=chats.getNodeSession(chats.activeTabId.value);
      presenter.providerReports.value.push({provider:'codex',available:true,configuration:{per_action_approval:false,permission_modes:['manual','bypassPermissions']},capabilities:{}});
      const root=await until(()=>document.querySelector('.abele-node-chat'));
      root.querySelector('.abele-node-chat__agent').click();
      await until(()=>[...document.querySelectorAll('.menu-item-title')].some(el=>el.textContent.includes('Codex')));
      states.picker=document.body.textContent.includes('This provider cannot ask before each action.') && document.body.textContent.includes('Codex · Agent permission settings');
      await shot('picker');
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(150);
      await api.closeNodeSessionFixture();
      api.openDialog('node-agent-permissions');
      const settings=await until(()=>document.querySelector('.abele-agent-editor'));
      states.settings=settings.textContent.includes('Without asking') && settings.textContent.includes('--claude-allow-bypass') && settings.textContent.includes('confined to that folder');
      await shot('agent-settings');
      const select=[...settings.querySelectorAll('select')].find(el=>[...el.options].some(option=>option.value==='confirm-all') && [...el.options].some(option=>option.value==='allow-all'));
      const configured=api.AgentRegistry.getInstance().list({includeUtility:true,includeNode:true}).find(agent=>agent.node?.id==='sample-permission-node');
      states.ownerChoice=select?.value==='confirm-all' && configured?.permissionMode==='confirm-all';
      select.value='allow-all';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);
      states.ownerChoice=states.ownerChoice && configured.permissionMode==='allow-all';
      await shot('agent-settings-without-asking');await close();
      for(const state of ['refused','node-opt-in','running','unknown']) {
        api.openDialog('node-delegation-card',{permissionState:state});
        const card=await until(()=>document.querySelector('.abele-node-delegation'));
        const text=card.textContent;
        states[state]=state==='refused' ? text.includes('cannot ask before each action') && [...card.querySelectorAll('button')].some(b=>b.textContent.includes('Agent permission settings'))
          : state==='node-opt-in' ? text.includes('--claude-allow-bypass')
          : state==='running' ? text.includes('Without asking') : text.includes('Permission mode not reported');
        await shot('delegation-'+state);await close();
      }
      return JSON.stringify(states);
    } finally { await close();await api.closeNodeSessionFixture() }
  })()`,
      120000
    )
  )
  expect(result).toEqual({
    picker: true,
    settings: true,
    ownerChoice: true,
    refused: true,
    'node-opt-in': true,
    running: true,
    unknown: true,
  })
})
