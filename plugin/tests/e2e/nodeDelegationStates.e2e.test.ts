import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop')
const shots = shotDir('abele-delegation-states')

const probe = (device: string) =>
  evalAsync<Record<string, boolean>>(`(async () => {
  const api = window.__abeleTest;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async fn => { for(let i=0;i<100;i++){const value=fn();if(value)return value;await wait(50)}throw Error('Sample state did not appear: ' + fn.toString()) };
  const seen = {};
  const close = async () => {
    const modal = document.querySelector('.modal.abele-modal');
    if (!modal) return;
    const button = [...(modal.closest('.modal-container')?.querySelectorAll('.modal-header-button, .modal-close-button') ?? [])].find(el => el.getBoundingClientRect().width);
    if (button) button.click();
    else document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
    await until(() => !modal.isConnected);
  };
  const shot = async name => {
    await wait(250);
    const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(device)} + '-' + name + '.png';
    require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
  };
  for (const [name, options, expected] of [
    ['refused', { permissionState: 'refused' }, 'Open agent settings'],
    ['lost', { delegationState: 'lost' }, 'The developer disconnected. Restart it from its chat.'],
    ['completed', { delegationState: 'done' }, 'Done'],
  ]) {
    try {
      api.openDialog('node-delegation-card', options);
      const modal = await until(() => document.querySelector('.modal.abele-modal'));
      await until(() => modal.textContent.includes(expected));
      seen[name] = modal.textContent.includes(expected) && !modal.querySelector('[data-pending-prompts]');
      if (name === 'refused') seen[name] = seen[name] && modal.textContent.includes('Failed') && !modal.textContent.includes('provisioning');
      await shot(name);
    } finally { await close(); }
  }
  for (const mode of ['confirm-all', 'inherit', 'allow-all']) {
    try {
      api.openDialog('node-agent-permissions', { agentInherit: mode === 'inherit' });
      const modal = await until(() => document.querySelector('.abele-agent-editor'));
      modal.querySelectorAll('.abele-tabs__tab').forEach(tab => { if(tab.textContent.trim()==='Access')tab.click() });
      const row = await until(() => [...modal.querySelectorAll('.setting-item')].find(row => row.textContent.includes('Permission mode')));
      if(mode === 'allow-all') { const select=row.querySelector('select');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true})); }
      const expected = mode === 'allow-all' ? 'Without asking: edits' : "in Ask it won't start";
      await until(() => row.textContent.includes(expected));
      seen[mode] = row.textContent.includes(expected);
      await shot('codex-' + mode);
    } finally { await close(); }
  }
  ${NODE_PANEL_FIXTURE}
  try {
    await nodePanel.open('feature');
    const model = window.__abeleNodePanelFixture.model;
    model.report(new Error('No answer from the node. Reconnecting'));
    await until(() => nodePanel.root().textContent.includes('No answer from the node'));
    await shot('reconnecting');
    await model.refreshCurrent();
    await until(() => !nodePanel.root().textContent.includes('No answer from the node'));
    seen.recovered = !nodePanel.root().textContent.includes('No answer from the node');
    await shot('recovered');
  } finally { await nodePanel.close(); }
  return JSON.stringify(seen);
})()`)

it('shows refusal, lost-worker recovery and the selected provider mode on desktop', () => {
  expect(Object.values(probe('desktop'))).toEqual(Array(7).fill(true))
}, 180000)

it('shows the same states in the phone layout', async () => {
  const result = await withEmulatedPhone(async () => probe('phone'))
  expect(Object.values(result)).toEqual(Array(7).fill(true))
}, 240000)
