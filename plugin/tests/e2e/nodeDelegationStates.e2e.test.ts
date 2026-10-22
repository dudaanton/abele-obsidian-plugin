import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop')
const shots = shotDir('abele-delegation-states')

interface StateReport {
  checks: Record<string, boolean>
  diagnostics: Record<string, unknown>
}

const probe = (device: string) =>
  evalAsync<StateReport>(`(async () => {
  const api = window.__abeleTest;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async fn => { for(let i=0;i<100;i++){const value=fn();if(value)return value;await wait(50)}throw Error('Sample state did not appear: ' + fn.toString()) };
  const seen = {};
  const diagnostics = {};
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
    ['lost', { delegationState: 'lost' }, 'The worker stopped answering; it is unknown whether it finished. Restart it from its chat.'],
    ['completed', { delegationState: 'done' }, 'Done'],
  ]) {
    try {
      api.openDialog('node-delegation-card', options);
      const modal = await until(() => document.querySelector('.modal.abele-modal'));
      await until(() => modal.textContent.includes(expected));
      seen[name] = modal.textContent.includes(expected) && !modal.querySelector('[data-pending-prompts]');
      if (name === 'refused') seen[name] = seen[name] && modal.textContent.includes('Refused') && !modal.textContent.includes('provisioning');
      const card = modal.querySelector('.abele-node-delegation');
      const header = card.querySelector('.setting-item');
      const next = header.nextElementSibling;
      const meta = card.querySelector('.abele-node-delegation__meta');
      const gap = next.getBoundingClientRect().top - meta.getBoundingClientRect().bottom;
      diagnostics[name] = { gap, headerMargin: getComputedStyle(header).marginBottom, headerPadding: getComputedStyle(header).paddingBottom, headerHeight: header.getBoundingClientRect().height, metaHeight: meta.getBoundingClientRect().height };
      seen[name + ' spacing'] = !!next && gap <= 8;
      if(name === 'refused') seen[name + ' dot'] = card.querySelectorAll('.abele-status-dot').length === 1;
      if(name === 'lost') seen[name + ' label'] = card.querySelector('.abele-node-delegation__status').textContent.trim() === 'Lost';
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
      const expected = mode === 'allow-all' ? 'Edits files in its folder without asking and stays inside it.' : mode === 'inherit' ? 'Takes the mode of the chat that delegates.' : 'Asks before each action.';
      await until(() => row.textContent.includes(expected));
      const warning = modal.querySelector('.abele-node-permission-warning');
      const expectedWarning = mode === 'inherit' ? "The delegating chat is in Ask now, so Codex won't start. Choose Without asking." : "Codex can't ask before each action, so it won't start here. Choose Without asking.";
      seen[mode] = row.textContent.includes(expected) && (mode === 'allow-all' ? !warning : warning?.textContent.trim() === expectedWarning) && !row.textContent.includes('· Ask now');
      await shot('codex-' + mode);
    } finally { await close(); }
  }
  ${NODE_PANEL_FIXTURE}
  try {
    await nodePanel.open('feature');
    const model = window.__abeleNodePanelFixture.model;
    const treeGeometry = async () => {
      await wait(350);
      return ['.abele-file-tree', '.abele-file-tree__bar', '.abele-file-tree__body'].map(selector => {
        const el = nodePanel.root().querySelector(selector);
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { selector, top: box.top, height: box.height, padding: style.padding, margin: style.margin, flex: style.flex };
      });
    };
    const beforeTree = await treeGeometry();
    model.report(new Error('No answer from the node. Reconnecting'));
    await until(() => nodePanel.root().textContent.includes('No answer from the node'));
    const duringTree = await treeGeometry();
    seen['quiet connection status'] = !!nodePanel.root().querySelector('[data-connection-status] .abele-status-dot_orange');
    const statusBox = nodePanel.root().querySelector('[data-connection-status]').getBoundingClientRect();
    seen['status visible'] = statusBox.height > 0 && statusBox.top >= 0 && statusBox.bottom <= innerHeight;
    await shot('reconnecting');
    await model.refreshCurrent();
    await until(() => !nodePanel.root().textContent.includes('No answer from the node'));
    seen.recovered = !nodePanel.root().textContent.includes('No answer from the node');
    const afterTree = await treeGeometry();
    diagnostics.tree = { before: beforeTree, during: duringTree, after: afterTree };
    seen['stable tree'] = beforeTree.every((box, i) => Math.abs(box.top - duringTree[i].top) < 1 && Math.abs(afterTree[i].top - duringTree[i].top) < 1);
    await shot('recovered');
  } finally { await nodePanel.close(); }
  return JSON.stringify({ checks: seen, diagnostics });
})()`)

const expectedStates = Object.fromEntries(
  [
    'refused',
    'refused spacing',
    'refused dot',
    'lost',
    'lost spacing',
    'lost label',
    'completed',
    'completed spacing',
    'confirm-all',
    'inherit',
    'allow-all',
    'quiet connection status',
    'status visible',
    'recovered',
    'stable tree',
  ].map((key) => [key, true])
)

it('shows refusal, lost-worker recovery and the selected provider mode on desktop', () => {
  const report = probe('desktop')
  expect(report.checks, JSON.stringify(report.diagnostics)).toEqual(expectedStates)
}, 180000)

it('shows the same states in the phone layout', async () => {
  const result = await withEmulatedPhone(async () => probe('phone'))
  expect(result.checks, JSON.stringify(result.diagnostics)).toEqual(expectedStates)
}, 240000)
