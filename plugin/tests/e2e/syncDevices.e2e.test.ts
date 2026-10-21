import { expect, it } from 'vitest'
import { V2Client } from '../../src/sync/v2/client'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { waitFor } from './helpers/syncVault'
import { AccessClient, sha256 } from '@abele/sync-sdk/core'
import { fixtureFetch } from './helpers/syncServer'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import {
  exerciseTrustedWindow,
  openTrustedConnection,
  toggleTrusted,
  expectTrustedRow,
  expectDeviceLocalTrust,
} from './helpers/syncTrustedConnection'
import { closeSyncScreens, captureSyncScreen } from './helpers/syncScreens'
import { SHARE_SET_PICKER } from './helpers/shareSetPicker'
const fixture = liveSuite()
it('multi-scope S6: deleting one file item leaves the other item connected', async () => {
  const s = fixture(),
    owner = s.primary,
    receiver = s.peer!
  const ownerId = await s.connect(),
    folder = s.root + '/Kept folder',
    single = s.root + '/Delete one.md'
  owner.create(folder + '/kept.md', 'still shared')
  owner.create(single, 'server delete candidate')
  await owner.syncNow(ownerId)
  await owner.long(
    'item capability',
    `await poll(()=>svc.itemSets.several(${JSON.stringify(ownerId)}));return true`
  )
  const issued = await owner.shareSet(
    ownerId,
    ['Folder: ' + folder, 'File: ' + single],
    'Sample deletion share'
  )
  const receiverId = await s.connect(receiver, issued.token)
  await owner.long(
    'open single-file deletion preview',
    `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample deletion share'));row.click();await poll(()=>modal('Sample deletion share'));const detail=modal('Sample deletion share');let item;await poll(()=>item=[...detail.querySelectorAll('.abele-share-detail__item')].find(one=>one.textContent.includes('Delete one')));icon(item,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Delete from the server…'),undefined,'DOM item deletion menu action');action.click();await poll(()=>inWindows('.abele-server-delete__facts'),undefined,'single-file deletion facts');return true`
  )
  const confirmation = await captureSyncScreen(
    owner,
    'multi-scope-delete-one',
    '.abele-server-delete__facts'
  )
  expect(confirmation.over).toEqual([])
  expect(confirmation.clipped).toEqual([])
  await owner.long(
    'confirm single-file server deletion',
    `const box=inWindows('.abele-server-delete__facts').closest('.modal');const facts=[...box.querySelectorAll('dt')].find(one=>textOf(one)==='Files');if(textOf(facts?.nextElementSibling)!=='1')throw new Error('Expected one file in deletion preview');const button=[...box.querySelectorAll('.abele-modal__footer button')].find(one=>one.classList.contains('mod-warning'));if(!button||button.disabled)throw new Error('Explicit deletion confirmation unavailable');button.click();await poll(()=>syncModalClosed(box),undefined,'single-file deletion confirmation completed');return true`
  )
  closeSyncScreens(owner)
  await receiver.syncNow(receiverId)
  expect((await s.items()).some((item) => item.path === single)).toBe(false)
  expect(receiver.read(single)).toBe('server delete candidate')
  expect(owner.read(single)).toBe('server delete candidate')
  expect(receiver.read(folder + '/kept.md')).toBe('still shared')
  expect(receiver.rows()).toHaveLength(1)
  receiver.create(folder + '/kept.md', 'other item still writes')
  await receiver.syncNow(receiverId)
  expect((await s.items()).find((item) => item.path === folder + '/kept.md')?.kind).toBe('note')
  const updated = (await s.items()).find((item) => item.path === folder + '/kept.md')
  expect(updated && updated.kind !== 'directory' ? updated.sha : null).toBe(
    await sha256(new TextEncoder().encode('other item still writes'))
  )
  expect(owner.read(single)).toBe('server delete candidate')
  owner.create(single, 'kept local edit')
  owner.create(folder + '/kept.md', 'owner still writes')
  await owner.syncNow(ownerId)
  expect((await s.items()).some((item) => item.path === single)).toBe(false)
  expect((await s.items()).find((item) => item.path === folder + '/kept.md')).toMatchObject({
    sha: await sha256(new TextEncoder().encode('owner still writes')),
  })
  owner.run(
    `await app.plugins.disablePlugin('abele');await app.plugins.enablePlugin('abele');return true`
  )
  await owner.waitIdle(ownerId)
  await owner.syncNow(ownerId)
  expect(owner.read(single)).toBe('kept local edit')
  expect((await s.items()).some((item) => item.path === single)).toBe(false)
  owner.create(folder + '/kept.md', 'owner writes after restart')
  await owner.syncNow(ownerId)
  expect((await s.items()).find((item) => item.path === folder + '/kept.md')).toMatchObject({
    sha: await sha256(new TextEncoder().encode('owner writes after restart')),
  })

  const wholePath = s.root + '/Whole token file.md'
  owner.create(wholePath, 'whole token kept bytes')
  await owner.syncNow(ownerId)
  await owner.shareSet(ownerId, ['File: ' + wholePath], 'Sample whole deletion')
  await owner.long(
    'delete the whole issued token',
    `const shares=await svc.itemSets.shares(${JSON.stringify(ownerId)});const share=shares.find(one=>one.label==='Sample whole deletion');if(!share)throw new Error('Share unavailable');await poll(()=>svc.itemSets.deleteFacts(share.id,null)?.canWrite);await svc.itemSets.deleteFromServer(share.id,null);return true`
  )
  await owner.syncNow(ownerId)
  expect(owner.read(wholePath)).toBe('whole token kept bytes')
  expect((await s.items()).some((item) => item.path === wholePath)).toBe(false)
  owner.run(
    `await app.plugins.disablePlugin('abele');await app.plugins.enablePlugin('abele');return true`
  )
  await owner.waitIdle(ownerId)
  owner.create(folder + '/kept.md', 'owner writes after whole deletion')
  await owner.syncNow(ownerId)
  expect(owner.read(wholePath)).toBe('whole token kept bytes')
  expect((await s.items()).some((item) => item.path === wholePath)).toBe(false)
  expect((await s.items()).find((item) => item.path === folder + '/kept.md')).toMatchObject({
    sha: await sha256(new TextEncoder().encode('owner writes after whole deletion')),
  })
}, 300000)
it('multi-scope S1–S6, S8, S10: one editable key, retained copies and one uploader', async () => {
  const s = fixture(),
    owner = s.primary,
    receiver = s.peer!
  const ownerId = await s.connect()
  const folder = s.root + '/Collection',
    groupA = s.root + '/First group.md',
    groupB = s.root + '/Second group.md'
  const single = s.root + '/Single note.md',
    shared = s.root + '/Common note.md'
  const memberships = `---\ngroups: ["[[${groupA.replace(/\.md$/, '')}]]", "[[${groupB.replace(/\.md$/, '')}]]"]\n---\n`
  owner.create(folder + '/clean.md', 'unchanged copy')
  owner.create(folder + '/Nested/other.md', 'nested unchanged copy')
  owner.create(folder + '/edited.md', 'original copy')
  owner.create(groupA, 'first group')
  owner.create(groupB, 'second group')
  owner.create(shared, memberships + 'shared by both groups')
  owner.create(single, 'one file')
  owner.create(s.root + '/Private.md', 'not shared')
  await owner.syncNow(ownerId)
  await owner.long(
    'item capability to load',
    `await poll(()=>svc.itemSets.several(${JSON.stringify(ownerId)}));return true`
  )
  await owner.long(
    'refuse a folder already covered by the selected folder',
    `
    const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));
    const box=modal('Share access');${SHARE_SET_PICKER}await pickShareItem(box,${JSON.stringify('Folder: ' + folder)});
    const input=box.querySelector('.abele-share-picker input');typeInto(input,${JSON.stringify(folder + '/Nested')});let choice;
    await poll(()=>choice=[...box.ownerDocument.querySelectorAll('.suggestion-item')].find(one=>one.dataset.shareKind==='folder'&&one.dataset.sharePath===${JSON.stringify(folder + '/Nested')}),undefined,'covered nested folder suggestion');
    if(choice.getAttribute('aria-disabled')!=='true'||!choice.textContent.includes('In Collection'))throw new Error('Covered folder must be refused');choice.click();
    if(box.querySelectorAll('.multi-select-pill').length!==1)throw new Error('Covered folder was selected');await press(box,'Close');await closeSettings();return true
  `
  )
  const issued = await owner.shareSet(ownerId, [
    'Folder: ' + folder,
    'Group: First group',
    'File: ' + single,
  ])
  const token = decodeAccessToken(issued.token)
  expect(token.v).toBe(2)
  if (token.v !== 2) throw new Error('Expected an item-set key')
  expect(token.items).toHaveLength(3)
  const keyApi = new V2Client(token, fixtureFetch)
  const inventory = (await keyApi.itemClient().items()).items
  const folderItem = inventory.find((item) => item.scope.kind === 'folder')!
  const receiverId = await s.connect(receiver, issued.token)
  expect(receiver.rows()).toHaveLength(1)
  expect(receiver.read(single)).toBe('one file')
  expect(receiver.read(shared)).toContain('shared by both groups')
  expect(receiver.exists(s.root + '/Private.md')).toBe(false)
  await owner.long(
    'add a group through share detail',
    `
    const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));
    const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample item set'));row.click();await poll(()=>modal('Sample item set'));
    const detail=modal('Sample item set');${SHARE_SET_PICKER}
    await pickShareItem(detail,'Group: Second group',false);
    await poll(()=>[...detail.querySelectorAll('.abele-share-detail__item')].some(one=>one.textContent.includes('Second group')));
    await press(detail,'Close');await press(box,'Close');await closeSettings();return true
  `
  )
  const added = (await keyApi.itemClient().items()).items.find(
    (one) => one.scope.path === groupB && one.removed_at === null
  )!
  expect(added).toBeDefined()
  await waitFor(
    'added group to be ready',
    async () => (await new V2Client(token, fixtureFetch, added.id).connection()).status === 'active'
  )
  await receiver.syncNow(receiverId)
  expect(receiver.read(groupB)).toBe('second group')
  receiver.run(
    `window.__sampleCommits=0;window.__sampleObservers=svc.itemSets.store.get(${JSON.stringify(receiverId)}).items.map(item=>host.live.get(item.recordId)?.observeTransport((path,active)=>{if(active&&path==='/v2/commit')window.__sampleCommits++})).filter(Boolean);return true`
  )
  try {
    receiver.create(shared, memberships + 'one local edit')
    await receiver.syncNow(receiverId)
    expect(receiver.run('return window.__sampleCommits')).toBe(1)
    await owner.syncNow(ownerId)
    expect(owner.read(shared)).toContain('one local edit')
    expect((await s.items()).filter((item) => /conflict/i.test(item.path))).toHaveLength(0)
  } finally {
    receiver.run(
      'for(const close of window.__sampleObservers||[])close();delete window.__sampleObservers;delete window.__sampleCommits;return true'
    )
  }
  const groupPreview = await owner.long<{ files: number; warnings: string[] }>(
    'preview group deletion with its overlapping group',
    `
    const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));
    const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample item set'));row.click();await poll(()=>modal('Sample item set'));
    const detail=modal('Sample item set');let item;await poll(()=>item=[...detail.querySelectorAll('.abele-share-detail__item')].find(one=>one.textContent.includes('First group')));icon(item,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Delete from the server…'),undefined,'DOM item deletion menu action');action.click();let confirmation;
    await poll(()=>{confirmation=inWindows('.abele-server-delete__facts')?.closest('.modal');return confirmation&&[...confirmation.querySelectorAll('.abele-modal__footer button')].some(one=>one.classList.contains('mod-warning')&&!one.disabled)},undefined,'loaded writable group deletion preview');
    const count=[...confirmation.querySelectorAll('dt')].find(one=>textOf(one)==='Files');return {files:Number(textOf(count.nextElementSibling).replace(/[^0-9]/g,'')),warnings:[...confirmation.querySelectorAll('.abele-server-delete__also')].map(one=>textOf(one))}
  `
  )
  expect(groupPreview.files).toBe(2)
  expect(groupPreview.warnings.some((warning) => warning.includes('Second group'))).toBe(true)
  const groupShot = await captureSyncScreen(
    owner,
    'multi-scope-group-overlap',
    '.abele-server-delete__facts'
  )
  expect(groupShot.over).toEqual([])
  expect(groupShot.clipped).toEqual([])
  owner.run(
    `const box=inWindows('.abele-server-delete__facts').closest('.modal');await press(box,'Cancel');return true`
  )
  closeSyncScreens(owner)
  await receiver.long(
    'pause one item',
    `const root=await openSyncTab();connectionRow(root,${JSON.stringify(receiverId)}).click();let row;await poll(()=>row=[...settingsDoc().querySelectorAll('.abele-connection-items__item'),...document.querySelectorAll('.abele-connection-items__item')].find(one=>one.textContent.includes('Collection')));icon(row,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Pause on this device'));action.click();await poll(()=>svc.itemSets.items(${JSON.stringify(receiverId)}).some(one=>one.id===${JSON.stringify(folderItem.id)}&&one.state.kind==='paused'));return true`
  )
  closeSyncScreens(receiver)
  receiver.create(folder + '/edited.md', 'unsent local edit')
  await owner.long(
    'remove an item through share detail',
    `
    const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));
    const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample item set'));row.click();await poll(()=>modal('Sample item set'));
    const detail=modal('Sample item set');let item;await poll(()=>item=[...detail.querySelectorAll('.abele-share-detail__item')].find(one=>one.textContent.includes('Collection')));icon(item,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Remove from this share…'));action.click();await press(detail,'Remove');await poll(()=>![...detail.querySelectorAll('.abele-share-detail__item')].some(one=>one.textContent.includes('Collection')));
    await press(detail,'Close');await press(box,'Close');await closeSettings();return true
  `
  )
  expect(
    (await keyApi.itemClient().items()).items.find((one) => one.id === folderItem.id)?.removed_at
  ).not.toBeNull()
  await receiver.syncNow(receiverId)
  expect(receiver.read(folder + '/clean.md')).toBe('unchanged copy')
  expect(receiver.read(folder + '/edited.md')).toBe('unsent local edit')
  expect((await s.items()).some((item) => item.path === folder + '/clean.md')).toBe(true)
  receiver.run(
    `const root=await openSyncTab();connectionRow(root,${JSON.stringify(receiverId)}).click();await poll(()=>inWindows('.abele-connection-items__item_detached'));return true`
  )
  const removed = await captureSyncScreen(
    receiver,
    'multi-scope-retained-copies',
    '.abele-connection-items'
  )
  expect(removed.over).toEqual([])
  expect(removed.clipped).toEqual([])
  receiver.run(
    `const row=inWindows('.abele-connection-items__item_detached');icon(row,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Remove your copy…'));action.click();await poll(()=>modal('Remove your copy of Collection?'));return true`
  )
  const confirmation = await captureSyncScreen(
    receiver,
    'multi-scope-remove-copy',
    'title:Remove your copy of Collection?'
  )
  expect(confirmation.over).toEqual([])
  receiver.run(
    `await press(modal('Remove your copy of Collection?'),'Remove 2 files');await poll(()=>!modal('Remove your copy of Collection?'));return true`
  )
  closeSyncScreens(receiver)
  expect(receiver.exists(folder + '/clean.md')).toBe(false)
  expect(receiver.exists(folder + '/Nested/other.md')).toBe(false)
  expect(receiver.read(folder + '/edited.md')).toBe('unsent local edit')
  expect(owner.read(folder + '/clean.md')).toBe('unchanged copy')
  await receiver.disconnect(receiverId)
  const reconnected = await s.connect(receiver, issued.token)
  expect(receiver.rows()).toHaveLength(1)
  const current = receiver.run<{ path: string; state: { kind: string } }[]>(
    `return svc.itemSets.items(${JSON.stringify(reconnected)})`
  )
  expect(current.some((item) => item.path === groupB)).toBe(true)
  expect(current.some((item) => item.path === folder)).toBe(false)
}, 240000)
liveCase(
  'syncDevices',
  'trusted folder connections persist a device-local toggle and approve only trusted incoming code',
  [85],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/trusted-folder'
    const owner = await s.connect()
    a.create(folder + '/sample.md', 'folder marker')
    await a.syncNow()
    const token = await a.share(owner, 'Folder: ' + folder)
    await a.disconnect(owner)
    // Both vaults use the same token; trust must remain a preference of just one device.
    const sender = await s.connect(a, token),
      recipient = await s.connect(b, token)
    try {
      expect(
        b.run(
          `return svc.registry.records().find(one=>one.id===${JSON.stringify(recipient)}).scope`
        )
      ).toMatchObject({ kind: 'folder', path: folder })
      await exerciseTrustedWindow(b, recipient, 'trusted-connection-desktop')
      openTrustedConnection(b, recipient)
      toggleTrusted(b, recipient, true)
      const installed = folder + '/automatic.js',
        content = '// inert incoming code sample'
      a.create(installed, content)
      await s.cycle()
      b.run(
        `await poll(async()=>await app.vault.adapter.exists(${JSON.stringify(installed)})&&!svc.candidates.value.some(one=>one.path===${JSON.stringify(installed)})&&svc.activity.value[${JSON.stringify(recipient)}]?.events?.some(one=>one.text.includes('Installed code from ')&&one.text.includes(${JSON.stringify(installed)})),30000,'trusted incoming code installed and logged');return true`
      )
      expect(b.read(installed)).toBe(content)
      expect(b.run(`return !!modal('Review incoming code')`)).toBe(false)
      expectDeviceLocalTrust(b, recipient, true)
      expectDeviceLocalTrust(a, sender, false)
      openTrustedConnection(a, sender)
      expectTrustedRow(a, false)
      closeSyncScreens(a)
      openTrustedConnection(b, recipient)
      expectTrustedRow(b, true)
      expect(
        b.run(
          `const box=inWindows('.abele-sync-window');return [...box.querySelectorAll('.abele-sync-window__events li')].some(one=>textOf(one).includes('Installed code from ')&&textOf(one).includes(${JSON.stringify(installed)}))`
        )
      ).toBe(true)
      toggleTrusted(b, recipient, false)
      closeSyncScreens(b)
      const pending = folder + '/waiting.js'
      a.create(pending, '// inert code waiting for approval')
      await s.cycle()
      b.run(
        `await poll(()=>svc.candidates.value.some(one=>one.path===${JSON.stringify(pending)}&&one.source.id===${JSON.stringify(recipient)}),30000,'untrusted incoming code remains pending');return true`
      )
      expect(b.exists(pending)).toBe(false)
      // Another completed exchange must not silently approve the waiting code.
      await s.cycle()
      expect(b.exists(pending)).toBe(false)
      expect(b.candidates().filter((one) => one.path === pending)).toHaveLength(1)
      openTrustedConnection(b, recipient)
      expectTrustedRow(b, false)
    } finally {
      closeSyncScreens(a)
      closeSyncScreens(b)
    }
  },
  fixture
)
liveCase(
  'syncDevices',
  '117 a rendered sharing QR connects a desktop recipient and exchanges files',
  [117],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      id = await s.connect(),
      path = s.root + '/qr.md'
    const qr = await a.shareQr(id)
    expect(qr.image).toMatch(/^data:image\/png;base64,/)
    await s.connect(b, qr.token, qr.image)
    b.create(path, 'decoded QR recipient writes')
    await s.cycle()
    expect(a.read(path)).toBe('decoded QR recipient writes')
  },
  fixture
)
liveCase(
  'syncDevices',
  '21a revoking one own device keeps the other own device exchanging',
  [21],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      owner = await s.connect(),
      path = s.root + '/own-device.md'
    const ownToken = await a.share(owner, 'Whole vault', 'My other device')
    await s.connect(b, ownToken)
    a.create(path, 'before own-device revoke')
    await s.cycle()
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(owner)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='My other device'));if(row.querySelector('svg.lucide-ban')){icon(row,'ban');await press(box,'Revoke')}else{const title=textOf(row.querySelector('.setting-item-name'));row.click();await poll(()=>modal(title));const detail=modal(title);await press(detail,'Revoke…');await press(detail,'Revoke');await poll(()=>detail.textContent.includes('Revoked'));await press(detail,'Close')};await press(box,'Close');await closeSettings();return true`
    )
    await expect(b.syncNow()).rejects.toThrow()
    expect(b.read(path)).toBe('before own-device revoke')
    a.create(path, 'remaining own device edit')
    await a.syncNow(owner)
    const remote = (await s.items()).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(remote.file_id, remote.version_id))
    ).toBe('remaining own device edit')
  },
  fixture
)
liveCase(
  'syncDevices',
  'folder departure keeps the owner file and return delivers its current bytes',
  [43, 45, 46, 47, 48, 49, 51],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/shared',
      path = folder + '/note.md',
      outside = s.root + '/private/note.md',
      id = await s.connect()
    a.create(path, 'shared source')
    await a.syncNow()
    await s.connect(b, await a.share(id, 'Folder: ' + folder))
    await s.cycle()
    b.rename(path, folder + '/renamed.md')
    await s.cycle()
    expect(a.read(folder + '/renamed.md')).toBe('shared source')
    expect(a.exists(path)).toBe(false)
    a.rename(folder + '/renamed.md', outside)
    await s.cycle()
    expect(a.read(outside)).toBe('shared source')
    expect(b.read(folder + '/renamed.md')).toBe('shared source')
    a.create(outside, 'current private edit')
    a.rename(outside, path)
    await s.cycle()
    expect(b.read(path)).toBe('current private edit')
    b.remove([path])
    await s.cycle()
    expect(a.exists(path)).toBe(false)
  },
  fixture
)
liveCase(
  'syncDevices',
  'group note arrival and background indexing never publish a private attachment',
  [74, 76, 77, 78, 79, 80, 81],
  async () => {
    const s = fixture(),
      a = s.primary,
      group = s.root + '/ConsentGroup.md',
      note = s.root + '/consent.md',
      asset = s.root + '/private.bin',
      neighbor = s.root + '/neighbor.bin'
    await s.put(group, 'consent group')
    await s.put(note, '---\ngroups: ["[[' + s.root + '/ConsentGroup]]"]\n---\n![[' + asset + ']]')
    const root = (await s.items()).find((one) => one.path === group)!
    a.create(asset, 'private immutable bytes')
    a.create(neighbor, 'private neighbor')
    await s.connect(a, await s.server.issue({ kind: 'group', id: root.file_id }))
    await a.syncNow()
    expect(a.questions()).toHaveLength(0)
    expect((await s.items()).some((one) => one.path === asset)).toBe(false)
    a.open(note)
    await a.consent('Allow')
    await a.syncNow()
    expect((await s.items()).some((one) => one.path === asset)).toBe(true)
    expect((await s.items()).some((one) => one.path === neighbor)).toBe(false)
    a.create(asset, 'future permitted edit')
    await a.syncNow()
    const sent = (await s.items()).find((one) => one.path === asset)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(sent.file_id, sent.version_id))
    ).toBe('future permitted edit')
    await s.connect(s.peer!, await s.server.issue({ kind: 'group', id: root.file_id }))
    await s.peer!.syncNow()
    expect(s.peer!.read(asset)).toBe('future permitted edit')
    expect(s.peer!.questions()).toHaveLength(0)
    const second = await s.addServer()
    await s.put(group, 'consent group', second)
    await s.put(
      note,
      '---\ngroups: ["[[' + s.root + '/ConsentGroup]]"]\n---\n![[' + asset + ']]',
      second
    )
    const otherRoot = (await s.items(second)).find((one) => one.path === group)!
    await s.connect(a, await second.issue({ kind: 'group', id: otherRoot.file_id }))
    await a.syncNow()
    expect(a.questions()).toHaveLength(0)
    expect((await s.items(second)).some((one) => one.path === asset)).toBe(false)
    a.open(s.root + '/ConsentGroup.md')
    a.open(note)
    await a.consent('Deny')
    await a.syncNow()
    expect((await s.items(second)).some((one) => one.path === asset)).toBe(false)
    expect(a.read(asset)).toBe('future permitted edit')
  },
  fixture
)
liveCase(
  'syncDevices',
  'two servers share one vault and an unavailable server does not stop the other',
  [24, 25, 26, 27, 28, 102],
  async () => {
    const s = fixture(),
      a = s.primary,
      second = await s.addServer(),
      path = s.root + '/both.md'
    const first = await s.connect(),
      other = await s.connect(a, second.rootToken)
    a.create(path, 'same local edit')
    await a.syncNow()
    expect((await s.items()).map((one) => one.path)).toContain(path)
    expect((await s.items(second)).map((one) => one.path)).toContain(path)
    await s.put(path, 'remote edit', second)
    await a.syncNow()
    await a.syncNow(first)
    const file = (await s.items()).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(file.file_id, file.version_id))
    ).toBe('remote edit')
    await second.kill()
    a.create(path, 'offline edit')
    await expect(a.syncNow(other)).rejects.toThrow()
    await a.syncNow(first)
    expect(a.rows()).toHaveLength(2)
    expect((await s.items()).find((one) => one.path === path)?.version_id).not.toBe(file.version_id)
  },
  fixture
)
liveCase(
  'syncDevices',
  'folder and group tokens from Share connect the second pool vault',
  [6, 11, 13, 14, 15, 16, 21, 37, 42, 57, 58, 60, 61],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/folder',
      group = s.root + '/Group.md',
      member = s.root + '/member.md'
    const id = await s.connect()
    a.create(folder + '/sample.md', 'folder content')
    a.create(folder + '/linked.md', '[[' + folder + '/sample|Shared target]]')
    a.create(group, 'group root')
    a.create(member, '---\ngroups: ["[[' + s.root + '/Group]]","[[Unrelated group]]"]\n---\nmember')
    a.create(s.root + '/private.md', 'private')
    await a.syncNow()
    const folderToken = await a.share(id, 'Folder: ' + folder),
      groupToken = await a.share(id, 'Group: Group')
    b.create(folder + '/local.md', 'local inside shared folder')
    b.create(s.root + '/outside.md', 'local outside shared folder')
    b.create(
      s.root + '/local-member.md',
      '---\ngroups: ["[[' + s.root + '/Group]]"]\n---\npre-existing local member'
    )
    await s.connect(b, folderToken)
    await s.connect(b, groupToken)
    await s.cycle()
    expect(b.read(folder + '/sample.md')).toBe('folder content')
    expect(b.read(member)).toContain('[[Unrelated group]]')
    expect(b.exists(s.root + '/private.md')).toBe(false)
    expect(a.read(folder + '/local.md')).toBe('local inside shared folder')
    expect(a.read(s.root + '/local-member.md')).toContain('pre-existing local member')
    expect(b.read(folder + '/linked.md')).toBe('[[' + folder + '/sample|Shared target]]')
    b.open(folder + '/linked.md')
    expect(
      b.run(
        `const leaf=app.workspace.getLeaf(false),state=leaf.getViewState();await leaf.setViewState({...state,state:{...state.state,mode:'preview'}});let link;await poll(()=>link=leaf.view.containerEl.querySelector('a.internal-link[data-href="'+${JSON.stringify(folder + '/sample')}+'"]'));link.click();await poll(()=>app.workspace.getActiveFile()?.path===${JSON.stringify(folder + '/sample.md')});return app.workspace.getActiveFile().path`
      )
    ).toBe(folder + '/sample.md')
    expect((await s.items()).some((one) => one.path === s.root + '/outside.md')).toBe(false)
    b.create(member, b.read(member)! + '\nrecipient edit')
    await s.cycle()
    expect(a.read(member)).toContain('recipient edit')
    const onward = await b.share(s.ids.get(b)![0], 'Folder: ' + folder)
    expect(onward).toMatch(/^[A-Za-z0-9+/=_-]+$/)
    await a.pause(id, true)
    const thirdPath = folder + '/onward-recipient.md'
    b.create(thirdPath, 'new content for third recipient')
    await b.syncNow()
    expect(a.exists(thirdPath)).toBe(false)
    const third = await s.connect(a, onward)
    expect(third).not.toBe(id)
    expect(a.read(thirdPath)).toBe('new content for third recipient')
    a.create(thirdPath, 'third recipient edit')
    await a.syncNow(third)
    await b.syncNow()
    expect(b.read(thirdPath)).toBe('third recipient edit')
    const friend = AccessClient.fromToken(folderToken, { fetch: fixtureFetch })
    await AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch }).revoke(
      (await friend.connection()).token_id
    )
    await expect(b.syncNow(s.ids.get(b)![0])).rejects.toThrow()
    a.create(thirdPath, 'onward recipient still authorized after friend revoke')
    await a.syncNow(third)
    const forwarded = (await s.items()).find((one) => one.path === thirdPath)!
    expect(
      new TextDecoder().decode(
        await s.client().versionBytes(forwarded.file_id, forwarded.version_id)
      )
    ).toBe('onward recipient still authorized after friend revoke')
  },
  fixture
)
liveCase(
  'syncDevices',
  'root owner revokes access issued by another participant',
  [19],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/delegated',
      path = folder + '/note.md'
    const owner = await s.connect()
    a.create(path, 'shared participant content')
    await a.syncNow()
    const participant = await s.connect(b, await a.share(owner, 'Folder: ' + folder))
    const onward = await b.share(participant, 'Folder: ' + folder, 'Issued by participant')
    await a.pause(owner, true)
    const recipient = await s.connect(a, onward)
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(owner)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Issued by participant'));if(row.querySelector('svg.lucide-ban')){icon(row,'ban');await press(box,'Revoke')}else{const title=textOf(row.querySelector('.setting-item-name'));row.click();await poll(()=>modal(title));const detail=modal(title);await press(detail,'Revoke…');await press(detail,'Revoke');await poll(()=>detail.textContent.includes('Revoked'));await press(detail,'Close')};await press(box,'Close');await closeSettings();return true`
    )
    b.create(path, 'after root-owner revocation')
    await b.syncNow(participant)
    await expect(a.syncNow(recipient)).rejects.toThrow()
    expect(a.read(path)).toBe('shared participant content')
    expect(
      (
        await AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch }).tokens()
      ).items.find((one) => one.label === 'Issued by participant')?.revoked_at
    ).toBeTruthy()
  },
  fixture
)
liveCase(
  'syncDevices',
  'several partial scopes on one server isolate private files while another root connection works',
  [24, 25, 26],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      owner = await s.connect(),
      left = s.root + '/left',
      right = s.root + '/right',
      group = s.root + '/IsolatedGroup.md'
    a.create(left + '/left.md', 'left scope')
    a.create(right + '/right.md', 'right scope')
    a.create(group, 'group definition')
    a.create(
      s.root + '/group-member.md',
      '---\ngroups: ["[[' + s.root + '/IsolatedGroup]]"]\n---\ngroup scope'
    )
    a.create(s.root + '/owner-private.md', 'owner private')
    await a.syncNow()
    const leftToken = await a.share(owner, 'Folder: ' + left),
      rightToken = await a.share(owner, 'Folder: ' + right),
      groupToken = await a.share(owner, 'Group: IsolatedGroup')
    await s.connect(b, leftToken)
    expect(b.read(left + '/left.md')).toBe('left scope')
    expect(b.exists(right + '/right.md')).toBe(false)
    await s.connect(b, rightToken)
    await s.connect(b, groupToken)
    expect(b.read(right + '/right.md')).toBe('right scope')
    expect(b.read(s.root + '/group-member.md')).toContain('group scope')
    expect(b.exists(s.root + '/owner-private.md')).toBe(false)
    b.create(s.root + '/recipient-private.md', 'recipient private')
    b.create(left + '/new.md', 'left edit')
    await b.syncNow()
    const own = await s.addServer()
    await s.connect(b, own.rootToken)
    await b.syncNow()
    expect((await s.items()).some((one) => one.path === s.root + '/recipient-private.md')).toBe(
      false
    )
    expect((await s.items(own)).some((one) => one.path === s.root + '/recipient-private.md')).toBe(
      true
    )
    expect((await s.items(own)).some((one) => one.path === s.root + '/owner-private.md')).toBe(
      false
    )
    const leftView = await new (await import('@abele/sync-sdk/core')).V2EngineClient(leftToken, {
      fetch: fixtureFetch,
    }).manifest(null)
    expect(
      leftView.items.some(
        (one) => one.path.startsWith(right + '/') || one.path === s.root + '/group-member.md'
      )
    ).toBe(false)
    const groupView = await new (await import('@abele/sync-sdk/core')).V2EngineClient(groupToken, {
      fetch: fixtureFetch,
    }).manifest(null)
    expect(
      groupView.items.some(
        (one) => one.path.startsWith(left + '/') || one.path.startsWith(right + '/')
      )
    ).toBe(false)
  },
  fixture
)
liveCase(
  'syncDevices',
  'revoke stops exchange but keeps files and other device tokens active',
  [18, 19, 22],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/retained.md',
      id = await s.connect()
    const issued = await a.share(id, 'Whole vault', 'Sample revoked recipient')
    await s.connect(b, issued)
    a.create(path, 'retained local content')
    await s.cycle()
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample revoked recipient'));if(row.querySelector('svg.lucide-ban')){icon(row,'ban');await press(box,'Revoke')}else{const title=textOf(row.querySelector('.setting-item-name'));row.click();await poll(()=>modal(title));const detail=modal(title);await press(detail,'Revoke…');await press(detail,'Revoke');await poll(()=>detail.textContent.includes('Revoked'));await press(detail,'Close')};await press(box,'Close');await closeSettings();return true`
    )
    await expect(b.syncNow()).rejects.toThrow()
    expect(b.read(path)).toBe('retained local content')
    a.create(s.root + '/active.md', 'still active')
    await a.syncNow()
    expect((await s.items()).map((one) => one.path)).toContain(s.root + '/active.md')
    const access = AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch })
    expect(
      (await access.tokens()).items.some(
        (one) => one.label === 'Sample revoked recipient' && one.revoked_at
      )
    ).toBe(true)
  },
  fixture
)
liveCase(
  'syncDevices',
  'disconnect is local and leaves other connections and files intact',
  [22, 23, 34],
  async () => {
    const s = fixture(),
      a = s.primary,
      second = await s.addServer(),
      id = await s.connect(),
      other = await s.connect(a, second.rootToken),
      path = s.root + '/kept.md'
    a.create(path, 'kept')
    await a.syncNow()
    await a.disconnect(id)
    expect(a.read(path)).toBe('kept')
    expect(a.rows().map((one) => one.id)).toEqual([other])
    a.create(path, 'still active')
    await a.syncNow(other)
    expect((await s.items(second)).find((one) => one.path === path)).toBeDefined()
  },
  fixture
)
