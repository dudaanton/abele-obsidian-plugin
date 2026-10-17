import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
targets('desktop')
const shots = shotDir('abele-debugger-access')
async function probe(label: string) {
  return JSON.parse(
    await evalLong(
      `(async () => {
    const api = window.__abeleTest, wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async fn => { for (let i = 0; i < 100; i++) { const v = fn(); if (v) return v; await wait(50) } throw Error('Debugger access UI did not appear') };
    const shot = async name => { await wait(200); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png', image.toPNG()) };
    const card = () => document.querySelector('.abele-debugger-access-card');
    const press = (root, text) => { const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text); if (!b) throw Error('Missing '+text); b.click() };
    try {
      await api.openDebuggerAccessFixture();
      await until(card); card().scrollIntoView({ block: 'center' }); await shot('pending');
      press(card(), 'Allow'); await until(() => card()?.textContent.includes('agent can retry'));
      const retry = api.retryDebuggerAccessFixture(); await wait(250);
      document.querySelector('.abele-chat-run > .tree-item-self[aria-expanded="false"]')?.click();
      await until(() => document.querySelector('[data-node-message="sample-retried-tool"]'));
      card().scrollIntoView({ block: 'center' }); await shot('allowed-and-retried');
      api.openDebuggerGrantsFixture(); await until(() => document.querySelector('[aria-label="Revoke debugger access"]')); await shot('grants');
      document.querySelector('[aria-label="Revoke debugger access"]').click();
      await until(() => [...document.querySelectorAll('.modal')].some(m => m.textContent.includes('Revoked'))); await shot('revoked');
      document.querySelector('[aria-label^="Delete this grant"]').click();
      await until(() => [...document.querySelectorAll('.modal')].some(m => m.textContent.includes('No debugger grants')));
      await api.closeDebuggerAccessFixture();
      for (const state of ['long', 'error', 'old']) {
        await api.openDebuggerAccessFixture(state); await wait(300);
        if (state === 'error') { press(card(), 'Allow'); await wait(200) }
        if (state === 'old' && !document.querySelector('.abele-node-debugger-access').textContent.includes('Update this node')) throw Error('Missing update explanation');
        document.querySelector('.abele-node-debugger-access').scrollIntoView({ block: 'center' });
        await shot(state); await api.closeDebuggerAccessFixture();
      }
      return { retry };
    } finally { await api.closeDebuggerAccessFixture() }
  })()`,
      90000
    )
  ) as { retry: { observation: string; execution: string } }
}
it('shows debugger access, explicit retry and grant cleanup on desktop and phone geometry', async () => {
  const desktop = await probe('desktop')
  expect(desktop.retry).toEqual({ observation: 'current', execution: 'running' })
  const phone = await withEmulatedPhone(() => probe('phone'))
  expect(phone.retry).toEqual(desktop.retry)
})
