/**
 * The agents list against a real node (`ABELE_NODE_CLI`) reached as a paired device: a connected
 * node is never listed as offline, a session at work shows under Working and opens its chat, and
 * an idle one stays out of the list. Pictured on a computer and a phone.
 */
import { afterAll, expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { PAIRED_PRELUDE, startPairedNode } from './helpers/pairedNode'

targets('desktop', 'phone')
const shots = shotDir('abele-agents-node')
let node: Awaited<ReturnType<typeof startPairedNode>> | undefined
afterAll(async () => node?.close())

it('lists a connected node by what its sessions do, never as offline', async () => {
  node = await startPairedNode()
  const busy = await node.session('Sample busy session')
  await node.session('Sample quiet session')
  const tab = await node.open(busy, 'Sample busy session')
  const r = JSON.parse(
    await evalLong(
      `(async()=>{${PAIRED_PRELUDE}
      const close=async()=>{for(const b of document.querySelectorAll('.modal .modal-close-button'))b.click();await wait(200)};
      const presenter=chats.getNodeSession(${JSON.stringify(tab)});
      await presenter.send('slow');
      const client=nodes.connection(${JSON.stringify(node.registration)}).client;
      for(let i=0;i<300;i++){if((await client.sessionState(${JSON.stringify(busy)})).turn)break;await wait(100)}
      await close();
      app.commands.executeCommandById('abele:agents');
      const root=await until(()=>document.querySelector('.abele-agents'),'The agents list');
      await until(()=>root.textContent.includes('Sample busy session'),'The busy session in the list',30000);
      const sections=[...root.querySelectorAll('.abele-fold-heading__text')].map(e=>e.textContent.trim());
      const text=root.textContent;
      const path=${JSON.stringify(shots)}+'/agents-node-online-'+(app.isMobile?'phone':'desktop')+'.png';
      if(window.__e2eHost)await window.__e2eHost.shot(path);
      else require('fs').writeFileSync(path,(await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      const row=[...root.querySelectorAll('.abele-agents__row')].find(e=>e.textContent.includes('Sample busy session'));
      row.click();
      await until(()=>!document.querySelector('.abele-agents'),'The list closing on open');
      const active=chats.activeTabId.value;
      try{await presenter.interrupt?.()}catch{}
      return JSON.stringify({sections,offline:text.includes('Offline'),cannot:text.includes("Can't load"),quiet:text.includes('Sample quiet session'),active})})()`,
      120000
    )
  ) as { sections: string[]; offline: boolean; cannot: boolean; quiet: boolean; active: string }
  expect(r.sections).toContain('Working')
  expect(r.sections).not.toContain('Offline')
  expect(r.offline).toBe(false)
  expect(r.cannot).toBe(false)
  expect(r.quiet).toBe(false)
  expect(r.active).toBe(tab)
}, 300000)
