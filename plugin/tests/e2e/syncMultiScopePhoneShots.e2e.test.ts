import { expect, it } from 'vitest'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { V2Client } from '../../src/sync/v2/client'
import { targets } from './helpers/target'
import { liveSuite } from './helpers/syncLiveCases'
import { fixtureFetch } from './helpers/syncServer'
import { closeSyncScreens } from './helpers/syncScreens'
import { tap, typeText, screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { createServerFolder } from './helpers/syncServerFolder'

targets('phone')
const fixture = liveSuite(false)

it('captures four multi-scope screens on the phone without confirming destructive actions', async () => {
  const s = fixture(),
    phone = s.primary
  const folder = await createServerFolder(s, s.root + '/Field notes', fixtureFetch)
  const workshop = s.root + '/Workshop.md',
    reading = s.root + '/Reading list.md'
  const single = s.root + '/Checklist.md',
    common = s.root + '/Workshop agenda.md'
  const clean = folder.path + '/Itinerary.md',
    edited = folder.path + '/Packing.md'
  const groups = `---\ngroups: ["[[${workshop.replace(/\.md$/, '')}]]", "[[${reading.replace(/\.md$/, '')}]]"]\n---\n`
  await s.put(clean, 'Meet at the visitor centre at nine.')
  await s.put(edited, 'Bring a notebook and a water bottle.')
  await s.put(workshop, 'Plans for the next workshop.')
  await s.put(reading, 'Articles to discuss together.')
  await s.put(single, 'Check the route and confirm the meeting time.')
  await s.put(common, groups + 'Review the draft agenda before the workshop.')
  const ownerId = await s.connect()
  const owner = new V2Client(decodeAccessToken(s.server.rootToken), fixtureFetch)
  const shots = shotDir('abele-sync-multi-scope-phone-shots')
  let restore: (() => Promise<void>) | undefined
  try {
    await phone.long(
      'wait for item-set sharing',
      `await poll(()=>svc.itemSets.several(${JSON.stringify(ownerId)}));return true`
    )
    const issued = await phone.shareSet(
      ownerId,
      ['Folder: ' + folder.path, 'Group: Workshop', 'Group: Reading list', 'File: ' + single],
      'Sample field team'
    )
    await phone.shareSet(ownerId, ['Group: Workshop'], 'Sample workshop access')

    const field = await phone.long<{ x: number; y: number }>(
      'open Share picker',
      `
      const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));
      const box=modal('Share access');let input;await poll(()=>input=box.querySelector('.abele-share-picker input'));
      input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}
    `
    )
    tap(field.x, field.y)
    typeText('Workshop')
    const picker = await phone.long<{ inline: boolean; titles: string[] }>(
      'inline results above the native keyboard',
      `
      const box=modal('Share access');const input=box.querySelector('.abele-share-picker input');let rows;
      await poll(()=>{
        const win=box.ownerDocument.defaultView,doc=box.ownerDocument;
        const keyboard=Math.max(...[doc.documentElement,doc.body].map(el=>parseFloat(win.getComputedStyle(el).getPropertyValue('--keyboard-height'))||0),win.visualViewport?win.innerHeight-win.visualViewport.height:0);
        rows=[...box.querySelectorAll('.abele-share-picker__results .suggestion-item')].filter(one=>one.dataset.shareKind==='group'&&one.dataset.sharePath===${JSON.stringify(workshop)});
        const bottom=Math.min(win.innerHeight-keyboard,win.visualViewport?win.visualViewport.offsetTop+win.visualViewport.height:win.innerHeight);
        return keyboard>1&&doc.activeElement===input&&input.value==='Workshop'&&rows.length===1&&rows.every(one=>{const r=one.getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=bottom});
      },undefined,'inline Workshop result fully above keyboard');
      return {inline:!!box.querySelector('.abele-share-picker__results'),titles:rows.map(one=>textOf(one))}
    `
    )
    expect(picker.inline).toBe(true)
    expect(picker.titles).toHaveLength(1)
    expect(picker.titles[0]).toContain('Workshop')
    screenshot(shots + '/2-share-inline-keyboard.png')
    await phone.long(
      'cancel Share picker',
      `const box=modal('Share access');box.querySelector('input')?.blur();await press(box,'Close');return true`
    )
    closeSyncScreens(phone)

    const preview = await phone.long<{ files: number; access: string; scope: string }>(
      'open group server-delete preview',
      `
      const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(ownerId)}),'share-2');await poll(()=>modal('Share access'));
      const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample field team'));row.click();await poll(()=>modal('Sample field team'));
      const detail=modal('Sample field team');let item;await poll(()=>item=[...detail.querySelectorAll('.abele-share-detail__item')].find(one=>textOf(one.querySelector('.abele-list-row__title'))==='Workshop')||[...detail.querySelectorAll('.abele-share-detail__item')].find(one=>textOf(one).startsWith('Workshop')));
      icon(item,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Delete from the server…'));action.click();let confirm;
      await poll(()=>{confirm=inWindows('.abele-server-delete__facts')?.closest('.modal');return confirm&&textOf(confirm.querySelector('.abele-server-delete__access')).includes('Sample workshop access')&&[...confirm.querySelectorAll('.abele-modal__footer button')].some(one=>one.classList.contains('mod-warning')&&!one.disabled)},undefined,'loaded group preview with named closed access');
      const facts=confirm.querySelector('.abele-server-delete__facts');const count=[...facts.querySelectorAll('dt')].find(one=>textOf(one)==='Files');
      if(![...facts.querySelectorAll('dt')].some(one=>textOf(one)==='Access closed'))throw new Error('Access closed label missing');
      return {files:Number(textOf(count.nextElementSibling).replace(/[^0-9]/g,'')),access:textOf(confirm.querySelector('.abele-server-delete__access')),scope:textOf(confirm.querySelector('.abele-server-delete__scope'))}
    `
    )
    expect(preview.files).toBe(2)
    expect(preview.access).toContain('Sample workshop access')
    expect(preview.access).toContain('Loses Group: Workshop')
    expect(preview.scope).not.toBe('/')
    screenshot(shots + '/3-server-delete-group.png')
    await phone.long(
      'cancel server deletion',
      `await press(inWindows('.abele-server-delete__facts').closest('.modal'),'Cancel');return true`
    )
    closeSyncScreens(phone)
    expect((await s.items()).some((one) => one.path === workshop)).toBe(true)

    await phone.disconnect(ownerId)
    phone.remove([clean, edited, workshop, reading, single, common])
    const receiverId = await s.connect(phone, issued.token, issued.image)
    const api = new V2Client(decodeAccessToken(issued.token), fixtureFetch)
    const tokenId = (await api.connection()).token_id
    const items = (await api.itemClient().items()).items
    expect(items).toHaveLength(4)
    const folderItem = items.find(
      (one) => one.scope.kind === 'folder' && one.scope.path === folder.path
    )
    expect(folderItem).toBeDefined()
    const rows = await phone.long<string[]>(
      'show all four connection items',
      `
      const root=await openSyncTab();connectionRow(root,${JSON.stringify(receiverId)}).click();let rows;
      await poll(()=>{rows=[...inWindows('.abele-connection-items')?.querySelectorAll('.abele-connection-items__item')||[]];return rows.length===4});
      rows.at(-1).scrollIntoView({block:'nearest'});
      await poll(()=>rows.every(one=>{const r=one.getBoundingClientRect(),win=one.ownerDocument.defaultView;const footer=one.closest('.modal').querySelector('.abele-modal__footer')?.getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=Math.min(win.innerHeight,footer?.top??win.innerHeight)}),undefined,'all four item rows visible together');return rows.map(one=>textOf(one))
    `
    )
    for (const title of ['Field notes', 'Workshop', 'Reading list', 'Checklist'])
      expect(rows.some((row) => row.includes(title))).toBe(true)
    screenshot(shots + '/1-connection-four-items.png')
    closeSyncScreens(phone)

    // Detach only this fixture's folder; put it back even if a preview assertion fails.
    restore = async () => {
      phone.create(edited, 'Bring a notebook and a water bottle.')
      const current = (await api.itemClient().items()).items
      if (!current.some((item) => item.removed_at === null && item.scope.id === folder.file_id))
        await owner.itemClient().addItem(tokenId, { kind: 'folder', id: folder.file_id })
    }
    await owner.itemClient().removeItem(tokenId, folderItem!.id)
    await phone.syncNow(receiverId)
    phone.create(edited, 'Bring a notebook, a water bottle and a map.')
    const copy = await phone.long<{ files: string; changed: string; note: string }>(
      'open remove-copy preview',
      `
      const root=await openSyncTab();connectionRow(root,${JSON.stringify(receiverId)}).click();let row;
      await poll(()=>row=[...inWindows('.abele-connection-items')?.querySelectorAll('.abele-connection-items__item_detached')||[]].find(one=>textOf(one).includes('Field notes')));
      icon(row,'more-horizontal');let action;await poll(()=>action=[...settingsDoc().querySelectorAll('.menu-item'),...document.querySelectorAll('.menu-item')].find(one=>textOf(one)==='Remove your copy…'));action.click();let box;
      await poll(()=>{box=modal('Remove your copy of Field notes?');return box&&[...box.querySelectorAll('.abele-modal__footer button')].some(one=>textOf(one)==='Remove 1 file'&&!one.disabled)},undefined,'remove-copy counts including the edited file');
      const fact=label=>{const dt=[...box.querySelectorAll('dt')].find(one=>textOf(one)===label);return textOf(dt?.nextElementSibling)};return {files:fact('Files here'),changed:fact('Changed here'),note:textOf(box.querySelector('.abele-server-delete__note'))}
    `
    )
    expect(copy.files).toBe('2')
    expect(copy.changed).toBe('1, they stay')
    expect(copy.note).toContain('Nothing changes on the server')
    screenshot(shots + '/4-remove-copy.png')
    await phone.long(
      'cancel local-copy removal',
      `await press(modal('Remove your copy of Field notes?'),'Cancel');return true`
    )
    expect(phone.read(clean)).toBe('Meet at the visitor centre at nine.')
    expect(phone.read(edited)).toBe('Bring a notebook, a water bottle and a map.')
    expect((await s.items()).find((one) => one.path === edited)).toBeDefined()
  } finally {
    try {
      closeSyncScreens(phone)
    } finally {
      await restore?.()
    }
  }
}, 360000)
