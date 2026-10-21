import { afterAll, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { horizontalOverflow } from './helpers/horizontalOverflow'
import { targets } from './helpers/target'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-node-obsidian-tools')
afterAll(async () => {
  if (available && evalJson<boolean>('!!app.isMobile')) await reloadApp('app.emulateMobile(false)')
})

it.skipIf(!available).each([
  { name: 'desktop', width: 1280, height: 900, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
])('shows node tool settings, ordinary calls and a durable approval on $name', async (size) => {
  if (size.mobile) await reloadApp('app.emulateMobile(true)')
  evalRaw(
    `require('@electron/remote').getCurrentWindow().setContentSize(${size.width}, ${size.height})`
  )
  const result = await evalLong(`(async () => {
    const api = window.__abeleTest, config = api.AbeleConfig.getInstance(), registry = api.AgentRegistry.getInstance();
    const before = JSON.parse(JSON.stringify(config.ai)), wait = (ms=250) => new Promise(r=>setTimeout(r,ms));
    const win = require('@electron/remote').getCurrentWindow(), bounds = win.getBounds();
    const overflow = [], shots = [];
    let settingsWindow;
    const capture = async (name, doc=document) => {
      await wait();
      const root = doc.querySelector('.abele-agent-editor') || doc.querySelector('.abele-settings__content') || doc.querySelector('.abele-node-chat');
      if (root) overflow.push(...(${horizontalOverflow.toString()})(root));
      const target = doc === document ? win : settingsWindow;
      if (!target) throw Error('Missing screenshot window');
      const image = await target.webContents.capturePage();
      require('fs').writeFileSync(${JSON.stringify(shots + '/' + size.name + '-')} + name + '.png', image.toPNG()); shots.push(name);
    };
    const press = async (doc, selector, text) => {
      const item = [...doc.querySelectorAll(selector)].find(el=>el.textContent.trim()===text);
      if (!item) throw Error('Missing control: '+text); item.click(); await wait();
    };
    try {
      config.ai.enabled = true;
      const agent = registry.create({ name: 'Claude Code', utility: true, description: 'Sample node agent', node: { id: 'sample-tools-node', name: 'Sample node', provider: 'claude' } });
      registry.create({ name: 'pi', utility: true, node: { id: 'sample-tools-node', name: 'Sample node', provider: 'pi' } });
      registry.create({ name: 'Codex', utility: true, node: { id: 'sample-tools-node', name: 'Sample node', provider: 'codex' } });
      api.nodeToolRunners['sample-tools-node'] = { state: 'device', device: 'Sample desktop' };
      await config.saveSettings();
      app.setting.open(); app.setting.openTabById('abele'); await wait(600);
      const doc = app.setting.activeTab.containerEl.ownerDocument;
      settingsWindow = require('@electron/remote').BrowserWindow.getAllWindows().find(w=>w.getTitle().startsWith('Settings - '+app.vault.getName()+' - '));
      if (settingsWindow) settingsWindow.setContentSize(${size.width},${size.height});
      await press(doc,'.abele-settings__nav .abele-tabs__tab','AI Agent');
      await press(doc,'.abele-ai-settings__tabs .abele-tabs__tab','Agents');
      const card = [...doc.querySelectorAll('.abele-card')].find(el=>el.textContent.includes('Claude Code') && el.textContent.includes('Sample node'));
      if (!card) throw Error('Node agent is missing from the ordinary agent list');
      card.scrollIntoView({block:'center'}); await capture('agents',doc); card.click(); await wait();
      const editor = doc.querySelector('.abele-agent-editor');
      if (!editor) throw Error('Shared agent dialog is missing');
      const tabs = [...editor.querySelectorAll('.abele-tabs__tab')].map(el=>el.textContent.trim());
      if (JSON.stringify(tabs)!==JSON.stringify(['Basic','Access'])) throw Error('Wrong node-agent tabs: '+tabs);
      if (!editor.querySelector('.abele-status-dot_green') || !editor.textContent.includes('Runs in Obsidian on Sample desktop')) throw Error('Connected executor line is missing');
      await capture('agent-connected',doc);
      api.nodeToolRunners['sample-tools-node'] = { state: 'none' }; await wait();
      if (!editor.querySelector('.abele-status-dot_orange')) throw Error('Missing executor is not shown');
      await capture('agent-missing-device',doc);
      doc.querySelector('.modal-container .modal-close-button')?.click(); app.setting.close(); await wait();
      await api.openNodeSessionFixture('obsidian-tools'); await wait(500);
      const root = [...document.querySelectorAll('.abele-node-chat')].find(el=>el.getClientRects().length);
      if (!root) throw Error('Node chat missing');
      for (const [selector,name] of [['[data-message-id="obsidian:sample-create"]','create-note'],['[data-message-id="obsidian:sample-edit"]','edit-diff'],['.abele-tool-approval','approval']]) {
        let row = root.querySelector(selector);
        if (!row && name!=='approval') row = [...root.querySelectorAll('.abele-chat-msg')].find(el=>el.textContent.includes(name==='create-note'?'A sample note created':'An updated sample note'));
        if (!row) throw Error('Missing ordinary Obsidian call: '+name);
        row.scrollIntoView({block:'center'}); await capture(name);
      }
      if (!root.textContent.includes('Text waiting for approval.')) throw Error('Approval does not show the note text');
      const approval=root.querySelector('.abele-tool-approval');
      for (const label of ['Deny','Allow','Stop']) if (![...approval.querySelectorAll('button')].some(b=>b.textContent.trim()===label)) throw Error('Missing approval action '+label);
      const history = [...root.querySelectorAll('.abele-disclosure__control')].find(el=>el.textContent.includes('Delegation'));
      if (!history) throw Error('Missing hosted delegation history'); history.click(); await wait();
      if (!root.textContent.includes('A retained sample answer')) throw Error('Retained delegation history is missing');
      history.scrollIntoView({block:'center'}); await capture('delegate-history');
      const questionnaire = root.querySelector('.abele-node-questionnaire');
      if (!questionnaire) throw Error('Missing hosted questionnaire');
      questionnaire.scrollIntoView({block:'center'}); await capture('questionnaire');
      const option = [...questionnaire.querySelectorAll('.abele-chat-question__answer')].find(el=>el.textContent==='Reference');
      if (!option) throw Error('Missing single-choice option'); option.closest('button').click(); await wait();
      const answer = root.querySelector('.abele-node-questionnaire textarea');
      await capture('questionnaire-input');
      if (!answer) throw Error('Missing text answer'); answer.value='Sample label'; answer.dispatchEvent(new Event('input',{bubbles:true})); await wait();
      await press(document,'.abele-node-questionnaire button','Answer');
      for (const name of ['One','Two']) {
        const option = [...root.querySelectorAll('.abele-node-questionnaire .abele-chat-question__answer')].find(el=>el.textContent===name);
        if (!option) throw Error('Missing multi-choice option '+name); option.closest('button').click(); await wait();
      }
      await capture('questionnaire-multi');
      await press(document,'.abele-node-questionnaire button','Answer');
      if (root.querySelector('.abele-node-questionnaire')) throw Error('Answered questionnaire is still pending');
      const sent = api.nodeSessionCalls.find(call=>call.method==='questionnaire.answer');
      if (JSON.stringify(sent?.params.answers)!==JSON.stringify(['Reference','Sample label',['One','Two']])) throw Error('Wrong questionnaire answers');
      return {overflow,shots};
    } finally {
      await api.closeNodeSessionFixture();
      app.setting.close(); if(settingsWindow&&!settingsWindow.isDestroyed()) settingsWindow.close();
      delete api.nodeToolRunners['sample-tools-node'];
      config.ai = before; registry.notifyConfigReloaded(); await config.saveSettings();
      win.setBounds(bounds);
    }
  })()`)
  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  expect(parsed.overflow).toEqual([])
  expect(parsed.shots).toHaveLength(10)
})
