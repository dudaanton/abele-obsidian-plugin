import { expect, it } from 'vitest'
import { evalLong, reloadPlugin } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-remote')
it.each([
  'node-pairing',
  'node-pairing-waiting',
  'node-pairing-recovery',
  'node-pairing-endpoint',
  'node-question',
  'node-question-input',
  'node-workspaces',
  'node-delegation-grants',
  'node-delegation-card',
])(
  '%s fits a real screen with readable identity and usable controls',
  async (name) => {
    const result = JSON.parse(
      await evalLong(
        `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (document.querySelector('.modal')) throw Error('Another dialog is open');
    window.__abeleTest.openDialog(${JSON.stringify(name)});
    let modal;
    try {
      for (let i=0; i<100 && !modal; i++) { await wait(50); modal = document.querySelector('.modal.abele-modal') }
      if (!modal) throw Error('Node dialog did not open');
      await wait(400);
      if (${JSON.stringify(name)} === 'node-workspaces') for (const details of modal.querySelectorAll('details')) details.open = true;
      const body = modal.querySelector('.abele-modal__body');
      const outside = [];
      for (const field of modal.querySelectorAll('input,textarea,select,button,code,[role="checkbox"]')) {
        const r = field.getBoundingClientRect();
        if (r.width && (r.left < 0 || r.right > innerWidth + 1)) outside.push(field.getAttribute('aria-label') || field.tagName);
      }
      const text = modal.textContent;
      if (${JSON.stringify(name)} === 'node-workspaces') {
        const provider=modal.querySelector('[aria-label="Node provider"]');
        provider.value='pi';provider.dispatchEvent(new Event('change',{bubbles:true}));
        provider.scrollIntoView({block:'center'});await wait(100);
      }
      if (${JSON.stringify(name)} === 'node-delegation-grants') {
        const select=(label,value)=>{const field=modal.querySelector('select[aria-label="'+label+'"]');field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}))};
        select('Delegation project','sample-project');select('Delegation provider','pi');await wait(100);
        modal.querySelector('[aria-label="Approve delegation actions"]').click();await wait(100);
      }
      let shot;
      if (window.__e2eHost) shot = await window.__e2eHost.shot(${JSON.stringify(shots + '/' + name + '.png')});
      else { require('fs').writeFileSync(${JSON.stringify(shots + '/' + name + '.png')}, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG()); shot = 'saved' }
      body.scrollTop = body.scrollHeight;
      if (${JSON.stringify(name)} === 'node-delegation-grants') {
        await wait(150);
        if (window.__e2eHost) { const bottom=await window.__e2eHost.shot(${JSON.stringify(shots + '/' + name + '-actions.png')}); if (bottom.startsWith('no picture:')) throw Error(bottom) }
        else require('fs').writeFileSync(${JSON.stringify(shots + '/' + name + '-actions.png')}, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      }
      return JSON.stringify({ outside, text, shot, controls: modal.querySelectorAll('input,textarea,select,button').length });
    } finally {
      modal?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      for (let i=0; i<100 && document.querySelector('.modal'); i++) await wait(20);
      if (document.querySelector('.modal')) throw Error('Node dialog did not close');
    }
  })()`,
        60000
      )
    ) as { outside: string[]; text: string; shot: string; controls: number }
    expect(result.outside).toEqual([])
    expect(result.controls).toBeGreaterThan(0)
    expect(result.shot).not.toMatch(/^no picture:/)
    if (name === 'node-pairing-waiting') {
      expect(result.text).toContain('Waiting for owner confirmation')
      expect(result.text).toContain('c'.repeat(64))
    }
    if (name === 'node-pairing-recovery') {
      expect(result.text).toContain('d'.repeat(64))
      expect(result.text).toContain('a'.repeat(64))
    }
    if (name === 'node-pairing-endpoint') {
      expect(result.text).toContain('wss://previous.example.ts.net:9443/channel')
      expect(result.text).toContain('wss://sample.example.ts.net:8443/channel')
    }
    if (name === 'node-workspaces') expect(result.text).toContain('Compaction not accepted')
    if (name === 'node-delegation-grants') expect(result.text).toContain('Owner approval for this device')
    if (name === 'node-delegation-card') { expect(result.text).toContain('Open child chat'); expect(result.text).toContain('Result') }
  },
  90000
)

it('persists a device-local non-extractable key across a real plugin restart', async () => {
  const namespace = 'test-' + crypto.randomUUID()
  let pin = ''
  try {
    pin = JSON.parse(
      await evalLong(
        `(async () => {
      const api = window.__abeleTest, store = new api.NodeDeviceKeyStore(${JSON.stringify(namespace)});
      try {
        const d = { ...(await api.nodePairingCrypto.generateIdentity()), node_id: 'sample-persistence-node', endpoint: 'wss://sample.example.ts.net:8443/channel', node_fingerprint: 'a'.repeat(64) };
        await store.transaction(d.node_id, async () => ({device:d,result:undefined}));
        return JSON.stringify(await api.nodePairingCrypto.fingerprint(d.public_key));
      } finally { store.close() }
    })()`,
        60000
      )
    ) as string
    await reloadPlugin()
    const restored = JSON.parse(
      await evalLong(
        `(async () => {
      const api = window.__abeleTest, store = new api.NodeDeviceKeyStore(${JSON.stringify(namespace)});
      try {
        const d = await store.load('sample-persistence-node'), c = api.nodePairingCrypto;
        return JSON.stringify({ pin: await c.fingerprint(d.public_key), extractable: d.private_key.extractable, verifies: await c.verifyProof(d.public_key, ['sample-restart'], await c.signProof(d.private_key, ['sample-restart'])) });
      } finally { store.close() }
    })()`,
        60000
      )
    ) as { pin: string; extractable: boolean; verifies: boolean }
    expect(restored).toEqual({ pin, extractable: false, verifies: true })
  } finally {
    await evalLong(
      `(async () => { await new Promise((resolve,reject) => { const request=indexedDB.deleteDatabase(${JSON.stringify('abele-node-keys-' + namespace)}); request.onsuccess=resolve; request.onerror=()=>reject(request.error); request.onblocked=()=>reject(Error('Fixture key database still open')) }); return 'removed' })()`,
      60000
    )
  }
}, 120000)
