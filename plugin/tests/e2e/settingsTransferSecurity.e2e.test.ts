import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toText } from '@/transfer/frames'
import { encodePayload } from '@/transfer/payload'
import type { TransferPayload } from '@/transfer/types'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-transfer-security')
const config = 'window.__abeleTest.AbeleConfig.getInstance()'

const incoming: TransferPayload = {
  v: 1,
  at: '',
  entries: [
    {
      section: 'maps',
      id: 'maps',
      label: 'Sample maps',
      data: {
        mapStyleUrl: 'https://maps.example/sample.json',
        ai: { permissionMode: 'allow-all' },
        secretStore: { sample: true },
      },
      secretIds: ['abele-sample-unrelated-key'],
    },
    {
      section: 'ai-providers',
      id: 'sample-transfer-provider',
      label: 'Sample provider',
      data: {
        id: 'sample-transfer-provider',
        name: 'Sample provider',
        baseUrl: 'https://api.example/v1',
        apiKeyId: 'abele-sample-transfer-key',
        models: [],
      },
      secretIds: ['abele-sample-unrelated-key'],
    },
    {
      section: 'github',
      id: 'github',
      label: 'Sample GitHub preferences',
      data: {
        github: {
          openLinks: false,
          keyId: 'abele-sample-unrelated-key',
          server: 'https://unused.example',
        },
      },
    },
    {
      section: 'github-connections',
      id: 'sample-transfer-connection',
      label: 'Sample connection',
      data: {
        id: 'sample-transfer-connection',
        name: 'Sample connection',
        server: '',
        keyId: 'abele-sample-transfer-key',
        owners: [],
        isDefault: true,
      },
    },
    {
      section: 'automations',
      id: 'sample-transfer-rule',
      label: 'Sample automation',
      data: {
        id: 'sample-transfer-rule',
        name: 'Sample automation',
        enabled: true,
        event: 'note.created',
        scriptName: 'Sample missing script',
        noteTypes: [],
        folders: [],
        params: {},
      },
    },
    {
      section: 'header-buttons',
      id: 'sample-transfer-button',
      label: 'Sample button',
      data: {
        id: 'sample-transfer-button',
        name: 'Sample button',
        enabled: true,
        icon: 'star',
        scriptName: 'Sample missing script',
        noteTypes: [],
        params: {},
      },
    },
  ],
  secrets: {
    'abele-sample-transfer-key': 'invented-arriving-value',
    'abele-sample-unrelated-key': 'invented-unrelated-replacement',
  },
}

describe.skipIf(!available)('settings transfer security in the running app', () => {
  let original: unknown
  let size: [number, number]
  beforeAll(() => {
    original = evalJson(`${config}.exportSettings()`)
    size = evalJson(`require('@electron/remote').getCurrentWindow().getContentSize()`)
    evalRaw(
      `window.__sampleTransferKeys = Object.fromEntries(['abele-sample-transfer-key', 'abele-sample-unrelated-key'].map(id => [id, window.__abeleTest.secrets().get(id)]))`
    )
  })
  afterAll(async () => {
    evalRaw(
      `app.setting.activeTab?.containerEl.ownerDocument.querySelector('.abele-transfer-scan')?.closest('.modal').querySelector('.modal-close-button')?.click(); app.setting.close()`
    )
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`)
    evalRaw(`${config}.applySettings(${JSON.stringify(original)})`)
    await evalLong(
      `${config}.saveSettings().then(() => { for (const [id,value] of Object.entries(window.__sampleTransferKeys ?? {})) window.__abeleTest.secrets().set(id, value); delete window.__sampleTransferKeys; return 'restored' })`
    )
    await reloadApp('app.emulateMobile(false)')
  })

  for (const mobile of [false, true]) {
    it(`applies only owned fields and referenced keys, with executable controls off (${mobile ? 'phone layout' : 'desktop'})`, async () => {
      if (mobile) {
        // Persist the test-key backup across emulation's reload without moving any secrets into settings.
        evalRaw(
          `sessionStorage.setItem('sample-transfer-key-backup', JSON.stringify(window.__sampleTransferKeys))`
        )
        await reloadApp('app.emulateMobile(true)')
        evalRaw(
          `window.__sampleTransferKeys = JSON.parse(sessionStorage.getItem('sample-transfer-key-backup')); sessionStorage.removeItem('sample-transfer-key-backup')`
        )
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      }
      evalRaw(`${config}.applySettings(${JSON.stringify(original)})`)
      evalRaw(
        `window.__abeleTest.secrets().set('abele-sample-unrelated-key', 'invented-existing-value')`
      )
      const text = toText(await encodePayload(incoming), 'TEST')
      const result = JSON.parse(
        await evalLong(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const ready = async (test, step) => { for (let i=0; i<100; i++) { if(test()) return; await wait(50) } throw new Error('Transfer dialog did not become ready: ' + step) };
        // Exercise the real settings entry point. Desktop settings may own a separate document;
        // Obsidian correctly opens its dialog there, not in the main vault document.
        app.setting.open(); app.setting.openTabById('abele');
        const root = app.setting.activeTab.containerEl, doc = root.ownerDocument, view = doc.defaultView;
        const transferTab = () => [...root.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'Transfer');
        await ready(transferTab, 'Transfer tab'); transferTab().click();
        const scan = () => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === 'Scan');
        await ready(scan, 'Scan action'); scan().click();
        const dialog = () => doc.querySelector('.abele-transfer-scan');
        const button = text => [...(dialog()?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === text);
        await ready(() => button('Paste the text'), 'paste action'); button('Paste the text').click();
        await ready(() => dialog()?.querySelector('textarea'), 'paste field');
        const input = dialog().querySelector('textarea'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new view.Event('input', { bubbles: true }));
        await ready(() => button('Apply'), 'review');
        const modal = dialog().closest('.modal'); const rect = modal.getBoundingClientRect();
        const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true });
        const image = await view.require('@electron/remote').getCurrentWindow().webContents.capturePage();
        fs.writeFileSync(${JSON.stringify(`${shots}/${mobile ? 'phone' : 'desktop'}-review.png`)}, image.toPNG());
        button('Apply').click(); await wait(300);
        const c = ${config}, store = window.__abeleTest.secrets();
        const out = { permission: c.ai.permissionMode, store: c.secretStore,
          rule: c.automations.find(x => x.id === 'sample-transfer-rule')?.enabled,
          button: c.headerButtons.find(x => x.id === 'sample-transfer-button')?.enabled,
          selectedKey: store.get('abele-sample-transfer-key') === 'invented-arriving-value',
          unrelatedKey: store.get('abele-sample-unrelated-key') === 'invented-existing-value',
          connectionKey: c.github.connections.find(x => x.id === 'sample-transfer-connection')?.keyId,
          overflow: rect.right > view.innerWidth + 1 || rect.left < -1 };
        modal.querySelector('.modal-close-button')?.click(); app.setting.close(); return JSON.stringify(out);
      })()`)
      )
      expect(result.rule).toBe(false)
      expect(result.button).toBe(false)
      expect(result.selectedKey).toBe(true)
      expect(result.unrelatedKey).toBe(true)
      expect(result.connectionKey).toBe('abele-sample-transfer-key')
      expect(result.store).toEqual((original as any).secretStore)
      expect(result.permission).toBe((original as any).ai.permissionMode)
      expect(result.overflow).toBe(false)
    })
  }
})
