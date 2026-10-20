import { expect, it } from 'vitest'
import { evalLong, reloadPlugin, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { shotDir } from './helpers/shots'
import { NODE_PANEL, NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop', 'phone')
const shots = shotDir('abele-node-remote')
const dialogs = [
  'node-pairing',
  'node-pairing-waiting',
  'node-pairing-recovery',
  'node-pairing-endpoint',
  'node-question',
  'node-question-input',
  'node-settings-access',
  'node-delegation-card',
]

async function inspectDialog(name: string, picture = name) {
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
      const body = modal.querySelector('.abele-modal__body');
      const outside = [];
      for (const field of modal.querySelectorAll('input,textarea,select,button,code,[role="checkbox"]')) {
        const r = field.getBoundingClientRect();
        if (r.width && (r.left < 0 || r.right > innerWidth + 1)) outside.push(field.getAttribute('aria-label') || field.tagName);
      }
      const text = modal.textContent;
      if (${JSON.stringify(name)} === 'node-settings-access') {
        const action=modal.querySelector('[aria-label="Pairing, debugger access, remove"]'), box=action.getBoundingClientRect();
        action.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:box.x+box.width/2,clientY:box.y+box.height/2}));
        await wait(150);
        const menu = [...document.querySelectorAll('.menu-item-title')].map(el => el.textContent);
        if (menu.includes('Delegation grants')) throw Error('Separate delegation permission is still offered');
        if (!menu.includes('Remove')) throw Error('Node row menu did not open');
      }
      let shot;
      if (window.__e2eHost) shot = await window.__e2eHost.shot(${JSON.stringify(shots + '/' + picture + '.png')});
      else { require('fs').writeFileSync(${JSON.stringify(shots + '/' + picture + '.png')}, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG()); shot = 'saved' }
      if (${JSON.stringify(name)} === 'node-settings-access') {
        document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
        await wait(100);
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
  if (name === 'node-delegation-card') {
    expect(result.text).toContain('Open child chat')
    expect(result.text).toContain('Result')
  }
}

it.each(dialogs)(
  '%s fits a real screen with readable identity and usable controls',
  async (name) => inspectDialog(name),
  90000
)

it.skipIf(onPhone())(
  'node settings access fits a phone screen',
  async () => {
    try {
      await enterPhone()
      await inspectDialog('node-settings-access', 'node-settings-access-phone')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  90000
)

// The node workspaces window is gone: its folders, worktrees, chats and actions are the node
// panel's place row, modes, place search and place menu, and a new chat's agent is chosen from
// the menu. Each is measured on a real screen the way the window was.
it('the node panel fits a real screen with readable identity and usable controls', async () => {
  const result = JSON.parse(
    await evalLong(
      `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (document.querySelector('.modal')) throw Error('Another dialog is open');
    ${NODE_PANEL_FIXTURE}
    const outsideOf = (root, where) => [...root.querySelectorAll('input,textarea,select,button,[role="button"],[role="tab"]')].flatMap(field => {
      const r = field.getBoundingClientRect();
      return r.width && (r.left < 0 || r.right > innerWidth + 1) ? [where + ': ' + (field.getAttribute('aria-label') || field.tagName)] : [];
    });
    const offscreen = (root, where) => { const r = root.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1) ? [where] : [] };
    const shot = async (file) => {
      const path = ${JSON.stringify(shots)} + '/' + file + '.png';
      if (window.__e2eHost) return window.__e2eHost.shot(path);
      require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      return 'saved';
    };
    try {
      const panel = await nodePanel.open('feature');
      const outside = [...offscreen(panel, 'panel'), ...outsideOf(panel, 'panel')];
      const row = panel.querySelector('.abele-node-place__row');
      const place = {
        name: panel.querySelector('.abele-node-place__name')?.textContent.trim(),
        where: panel.querySelector('.abele-node-place__where')?.textContent.trim(),
        tooltip: row.getAttribute('aria-label') || '',
        menu: panel.querySelector('.abele-node-place > .abele-obsidian-icon')?.getAttribute('aria-label') || '',
        codes: !!panel.querySelector('.abele-branch-codes__drift'),
      };
      const modes = [...panel.querySelectorAll('.abele-node-modes [role="tab"]')].map(t => t.getAttribute('aria-label'));
      const groups = [...panel.querySelectorAll('.abele-file-tree__group')].map(g => g.querySelector('.tree-item-inner')?.textContent.trim() ?? g.textContent.trim());
      const controls = panel.querySelectorAll('button,[role="button"],[role="tab"],input').length;
      const shotsTaken = [await shot('node-panel')];
      const search = await nodePanel.places();
      outside.push(...offscreen(search, 'place search'), ...outsideOf(search, 'place search'));
      const places = [...search.querySelectorAll('.suggestion-item')].map(i => i.querySelector('.suggestion-title')?.textContent.trim());
      shotsTaken.push(await shot('node-panel-places'));
      await nodePanel.dismiss();
      const worktreeMenu = await nodePanel.menu();
      outside.push(...offscreen(worktreeMenu, 'worktree menu'));
      const worktreeItems = nodePanel.items(worktreeMenu);
      shotsTaken.push(await shot('node-panel-menu'));
      await nodePanel.dismiss();
      const agents = await nodePanel.newChat();
      outside.push(...offscreen(agents, 'agent choice'), ...outsideOf(agents, 'agent choice'));
      const agentText = agents.textContent;
      shotsTaken.push(await shot('node-panel-new-chat'));
      await nodePanel.dismiss();
      await nodePanel.select('root');
      const folderMenu = await nodePanel.menu();
      outside.push(...offscreen(folderMenu, 'folder menu'));
      const folderItems = nodePanel.items(folderMenu);
      shotsTaken.push(await shot('node-panel-folder-menu'));
      await nodePanel.dismiss();
      return JSON.stringify({ outside, place, modes, groups, controls, places, worktreeItems, folderItems, agentText, shots: shotsTaken });
    } finally {
      await nodePanel.close();
    }
  })()`,
      90000
    )
  ) as {
    outside: string[]
    place: { name: string; where: string; tooltip: string; menu: string; codes: boolean }
    modes: string[]
    groups: string[]
    controls: number
    places: string[]
    worktreeItems: { title: string; warning: boolean; disabled: boolean }[]
    folderItems: { title: string; warning: boolean; disabled: boolean }[]
    agentText: string
    shots: string[]
  }
  expect(result.outside).toEqual([])
  expect(result.controls).toBeGreaterThan(0)
  for (const shot of result.shots) expect(shot).not.toMatch(/^no picture:/)
  // Readable identity: the branch, the folder it is checked out in, and the node, in the row.
  expect(result.place.name).toBe(NODE_PANEL.feature)
  expect(result.place.where).toBe(NODE_PANEL.repository)
  expect(result.place.tooltip).toContain(`${NODE_PANEL.repository} / ${NODE_PANEL.feature}`)
  expect(result.place.tooltip).toContain(NODE_PANEL.node)
  expect(result.place.menu).toBe(`What can be done in ${NODE_PANEL.feature}`)
  expect(result.place.codes).toBe(true)
  // The working changes, in the header's modes and in their groups.
  expect(result.modes).toEqual([
    'Files',
    'Changes: 3 files',
    'History',
    'Pull requests: none open',
    'Sessions: 1',
  ])
  expect(result.groups.join(' ')).toContain('Changes')
  expect(result.groups.join(' ')).toContain('Staged')
  expect(result.groups.join(' ')).toContain('Committed')
  // Every folder, worktree and chat of the node, in the place search.
  expect(result.places).toEqual(
    expect.arrayContaining([
      `${NODE_PANEL.repository} / ${NODE_PANEL.root}`,
      `${NODE_PANEL.repository} / ${NODE_PANEL.feature}`,
      NODE_PANEL.notes,
      NODE_PANEL.chat,
    ])
  )
  // What the window did, now in the place menu: start a chat, create, delete and unregister,
  // register a folder, the repository's Claude permissions; what cannot be undone apart, last.
  const titles = (items: { title: string }[]) => items.map((i) => i.title)
  expect(titles(result.worktreeItems)).toEqual(
    expect.arrayContaining([
      'New chat here',
      'Switch to another branch…',
      'Compare with…',
      'New worktree',
      'Attach a worktree',
      'Copy path',
      'Remove from the list',
      'Delete the worktree…',
      'Open a folder…',
      'Refresh',
      NODE_PANEL.node,
      'Node details',
    ])
  )
  expect(titles(result.folderItems)).toEqual(
    expect.arrayContaining([
      'New chat here',
      'New worktree',
      'Use the repository’s Claude permissions',
      'Remove the folder from the node…',
      'Open a folder…',
    ])
  )
  for (const items of [result.worktreeItems, result.folderItems]) {
    const warnings = items.filter((i) => i.warning).map((i) => i.title)
    expect(warnings.length).toBeGreaterThan(0)
    const at = (title: string) => titles(items).indexOf(title)
    for (const title of warnings) {
      expect(at(title)).toBeGreaterThan(at('Copy path'))
      expect(at(title)).toBeLessThan(at('Open a folder…'))
    }
  }
  expect(result.worktreeItems.find((i) => i.title === 'New chat here')?.disabled).toBe(false)
  // The node's own word on each agent it offers.
  expect(result.agentText).toContain('pi')
  expect(result.agentText).toContain('Claude Code')
  expect(result.agentText).toContain(NODE_PANEL.diagnostic)
}, 120000)

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
