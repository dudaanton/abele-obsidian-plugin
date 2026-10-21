import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import { captureSyncScreen as captureScreen, closeSyncScreens } from './helpers/syncScreens'
import { reloadAs as reloadWindowAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { rendererMemory } from './helpers/rendererMemory'
import type { VaultCli } from './helpers/obsidianCli'

function sampleMemory(vault: VaultCli, phase: string): void {
  console.info(
    '[sync dialogs memory]',
    phase,
    vault.evalAwait(`(${rendererMemory.toString()})(require)`)
  )
}
const reloadAs: typeof reloadWindowAs = async (vault, mobile) => {
  sampleMemory(vault, 'before reload')
  await reloadWindowAs(vault, mobile)
  sampleMemory(vault, 'after reload')
}
const captureSyncScreen: typeof captureScreen = async (...args) => {
  const result = await captureScreen(...args)
  sampleMemory(args[0].vault(), 'after capture ' + args[1])
  return result
}
const fixture = liveSuite(false)
liveCase(
  'syncDialogs',
  'the existing activity log keeps thousands of lines and follows live actions on desktop and phone',
  [85, 90],
  async () => {
    const s = fixture(),
      a = s.primary,
      vault = a.vault(),
      size = windowSize(vault)
    const id = await s.connect()
    try {
      for (const width of [1200, 390]) {
        await setWindowSize(vault, width, width === 1200 ? 900 : 844)
        await reloadAs(vault, width < 500)
        await a.waitIdle()
        const evidence = a.run<{
          retained: number
          rendered: number
          followed: boolean
          keptPosition: boolean
        }>(
          `const id=${JSON.stringify(id)};for(let i=0;i<6000;i++)svc.recordEvent(id,'Uploaded Notes/sample-'+i+'.md');
          const root=await openSyncTab();connectionRow(root,id).click();await poll(()=>inWindows('.abele-sync-window__events'));
          const list=inWindows('.abele-sync-window__events'),body=list.closest('.abele-modal__body');
          await poll(()=>list.querySelectorAll('li').length===5000);body.scrollTop=body.scrollHeight;
          svc.recordEvent(id,'Downloaded Notes/live.md');await poll(()=>list.lastElementChild?.textContent.includes('Notes/live.md'));
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const followed=body.scrollHeight-body.scrollTop-body.clientHeight<5;
          body.scrollTop=100;svc.recordEvent(id,'Deleted locally Notes/removed.md');await poll(()=>list.lastElementChild?.textContent.includes('Notes/removed.md'));
          return {retained:svc.activity.value[id].events.length,rendered:list.querySelectorAll('li').length,followed,keptPosition:Math.abs(body.scrollTop-100)<5}`
        )
        expect(evidence).toEqual({
          retained: 5000,
          rendered: 5000,
          followed: true,
          keptPosition: true,
        })
        const shot = await captureSyncScreen(a, 'token-activity-' + width, '.abele-sync-window')
        expect(shot.error).toBe('')
        expect(shot.over).toEqual([])
        expect(shot.clipped).toEqual([])
        closeSyncScreens(a)
      }
    } finally {
      closeSyncScreens(a)
      await setWindowSize(vault, ...size)
      await reloadAs(vault, false)
    }
  },
  fixture
)
liveCase(
  'syncDialogs',
  'real comparison and upload keep the open activity log live at desktop and phone widths',
  [85, 90],
  async () => {
    const s = fixture(),
      a = s.primary,
      vault = a.vault(),
      size = windowSize(vault)
    const id = await s.connect()
    try {
      for (const width of [1200, 390]) {
        await setWindowSize(vault, width, width === 1200 ? 900 : 844)
        await reloadAs(vault, width < 500)
        await a.waitIdle()
        await a.pause(id, true)
        const folder = s.root + '/Sample activity ' + width
        a.run(
          `const folder=${JSON.stringify(folder)};if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);for(let i=0;i<160;i++)await app.vault.create(folder+'/sample-'+i+'.md','Sample content '+i+' '+${width});return true`
        )
        // Hold real I/O at observable phases, without inventing snapshots or log lines.
        a.run(`const runtime=host.live.get(${JSON.stringify(id)}),fs=runtime.options.fs,read=fs.fingerprint,fetcher=runtime.options.fetch;
          const state=window.__sampleActivity={compareReached:false,uploadReached:false,puts:0};
          const comparison=new Promise(resolve=>state.releaseComparison=resolve),upload=new Promise(resolve=>state.releaseUpload=resolve);
          fs.fingerprint=async function(...args){if(!state.compareReached){state.compareReached=true;await comparison}return read.apply(this,args)};
          runtime.options.fetch=async function(input,init){if(init?.method==='PUT'&&String(input).includes('/v2/uploads/')){if(++state.puts===100){state.uploadReached=true;await upload}await sleep(10)}return fetcher(input,init)};
          state.restore=()=>{state.releaseComparison();state.releaseUpload();fs.fingerprint=read;runtime.options.fetch=fetcher};return true`)
        try {
          await a.pause(id, false)
          await a.long(
            'comparison visible',
            `await poll(()=>window.__sampleActivity.compareReached);const root=await openSyncTab();connectionRow(root,${JSON.stringify(id)}).click();await poll(()=>inWindows('.abele-sync-window')?.textContent.includes('Compar'));return true`
          )
          const comparing = await captureSyncScreen(
            a,
            'token-real-comparison-' + width,
            '.abele-sync-window'
          )
          expect(comparing.error).toBe('')
          expect(comparing.over).toEqual([])
          a.run(`window.__sampleActivity.releaseComparison();return true`)
          await a.long(
            'upload visible',
            `await poll(()=>window.__sampleActivity.uploadReached);await poll(()=>inWindows('.abele-sync-window__line')?.textContent.includes('Uploading'));inWindows('.abele-sync-window').closest('.abele-modal__body').scrollTop=0;return true`
          )
          const uploading = await captureSyncScreen(
            a,
            'token-real-upload-' + width,
            '.abele-sync-window'
          )
          expect(uploading.error).toBe('')
          expect(uploading.over).toEqual([])
          const before = a.run<number>(
            `const list=inWindows('.abele-sync-window__events'),body=list.closest('.abele-modal__body');if(list.querySelectorAll('li').length<100)throw new Error('Expected sustained real activity');body.scrollTop=body.scrollHeight;return list.querySelectorAll('li').length`
          )
          const log = await captureSyncScreen(
            a,
            'token-real-log-bottom-' + width,
            '.abele-sync-window'
          )
          expect(log.error).toBe('')
          a.run(
            `const body=inWindows('.abele-sync-window__events').closest('.abele-modal__body');body.scrollTop=100;window.__sampleActivity.scrollTop=body.scrollTop;window.__sampleActivity.releaseUpload();return true`
          )
          await a.waitIdle()
          const kept = a.run<boolean>(
            `const list=inWindows('.abele-sync-window__events'),body=list.closest('.abele-modal__body');await poll(()=>list.querySelectorAll('li').length>${before});return Math.abs(body.scrollTop-window.__sampleActivity.scrollTop)<5`
          )
          expect(kept).toBe(true)
          const scrolled = await captureSyncScreen(
            a,
            'token-real-log-scrolled-live-' + width,
            '.abele-sync-window'
          )
          expect(scrolled.error).toBe('')
        } finally {
          a.run(`window.__sampleActivity?.restore();delete window.__sampleActivity;return true`)
          await a.waitIdle()
          closeSyncScreens(a)
        }
      }
    } finally {
      closeSyncScreens(a)
      await setWindowSize(vault, ...size)
      await reloadAs(vault, false)
    }
  },
  fixture,
  300000
)
liveCase(
  'syncDialogs',
  'native token connect errors sharing and connection rows fit desktop and phone widths',
  [2, 7, 11, 13, 14],
  async () => {
    const s = fixture(),
      a = s.primary,
      vault = a.vault(),
      size = windowSize(vault)
    try {
      for (const [width, height] of [
        [1200, 900],
        [390, 844],
        [320, 844],
      ]) {
        await setWindowSize(vault, width, height)
        await reloadAs(vault, width < 500)
        a.run(
          `const root=await openSyncTab();await press(root,'Connect…');await poll(()=>modal('Connect to a server'));typeInto(modal('Connect to a server').querySelector('input[placeholder="Paste your token"]'),'not a token');await press(modal('Connect to a server'),'Connect');await poll(()=>modal('Connect to a server').querySelector('[role="alert"]'));return true`
        )
        const connect = await captureSyncScreen(
          a,
          'token-connect-' + width,
          'title:Connect to a server'
        )
        expect(connect.error).toBe('')
        expect(connect.over).toEqual([])
        expect(connect.clipped).toEqual([])
        expect(connect.capped).toEqual([])
        expect(connect.extra.onTop).toBe(true)
        expect(a.rows()).toHaveLength(0)
        closeSyncScreens(a)
      }
      await setWindowSize(vault, 1200, 900)
      await reloadAs(vault, false)
      const id = await s.connect(),
        second = await s.addServer()
      await s.connect(a, second.rootToken)
      a.create(s.root + '/Folder with a long descriptive sample name/sample.md', 'shared')
      a.create(s.root + '/Group with a long descriptive sample name.md', 'group')
      await a.syncNow()
      for (const width of [1200, 390, 320]) {
        await setWindowSize(vault, width, width === 1200 ? 900 : 844)
        await reloadAs(vault, width < 500)
        await a.waitIdle()
        const connections = await captureSyncScreen(a, 'token-connections-' + width)
        expect(connections.error).toBe('')
        expect(connections.over).toEqual([])
        expect(connections.clipped).toEqual([])
        a.run(
          `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'share-2');await poll(()=>modal('Share access'));return true`
        )
        const share = await captureSyncScreen(a, 'token-share-' + width, 'title:Share access')
        expect(share.error).toBe('')
        expect(share.over).toEqual([])
        expect(share.clipped).toEqual([])
        expect(share.extra.onTop).toBe(true)
        closeSyncScreens(a)
      }
    } finally {
      closeSyncScreens(a)
      await setWindowSize(vault, ...size)
      await reloadAs(vault, false)
    }
  },
  fixture
)
liveCase(
  'syncDialogs',
  'incoming code history trash and log keep scrolling bodies and reachable actions',
  [85, 90],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/A folder with a long sample name/history.md',
      size = windowSize(a.vault())
    await s.connect()
    for (let i = 0; i < 61; i++) await s.put(path, 'version ' + i)
    await s.put(
      s.root + '/review-script.js',
      '// inert candidate with a long sample line '.repeat(200)
    )
    await a.syncNow()
    try {
      for (const width of [1200, 390, 320]) {
        await setWindowSize(a.vault(), width, width === 1200 ? 900 : 844)
        await reloadAs(a.vault(), width < 500)
        await a.waitIdle()
        await a.history(path)
        const history = await captureSyncScreen(
          a,
          'token-history-' + width,
          '.abele-version-history'
        )
        expect(history.error).toBe('')
        expect(history.over).toEqual([])
        expect(history.clipped).toEqual([])
        expect(history.capped).toEqual([])
        expect(history.stranded).toEqual([])
        a.run(
          // Older versions load as the end of the history scrolls into view; there is no button.
          `const box=inWindows('.abele-version-history');let end;await poll(()=>(end=box.querySelector('.abele-scroll-more')),20000,'the end of the history');end.scrollIntoView({block:'end'});await poll(()=>box.querySelectorAll('.abele-version-history__row').length>50);return true`
        )
        expect(
          a.run(
            `return inWindows('.abele-version-history').querySelectorAll('.abele-version-history__row').length`
          )
        ).toBeGreaterThan(50)
        a.run(
          `const box=inWindows('.abele-version-history');let older=null;for(const row of [...box.querySelectorAll('.abele-version-history__row')].slice(1)){if(!row.classList.contains('is-active'))row.click();await poll(()=>row.querySelector('.abele-version-history__open'));if(buttonIn(row,'Restore')){older=row;break}row.click();await sleep(50)}if(!older)throw new Error('No restorable historical version');await poll(()=>box.querySelector('.abele-version-history__diff'));return true`
        )
        const preview = await captureSyncScreen(
          a,
          'token-history-preview-' + width,
          '.abele-version-history'
        )
        expect(preview.over).toEqual([])
        expect(preview.clipped).toEqual([])
        expect(preview.stranded).toEqual([])
        a.run(
          `const box=inWindows('.abele-version-history');const older=box.querySelector('.abele-version-history__row.is-active');await press(older,'Restore');await poll(()=>inWindows('.abele-confirm__message'));return true`
        )
        const confirm = await captureSyncScreen(
          a,
          'token-history-confirm-' + width,
          '.abele-confirm__message'
        )
        expect(confirm.over).toEqual([])
        expect(confirm.extra.onTop).toBe(true)
        closeSyncScreens(a)
        a.run(
          `const root=await openSyncTab();const row=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(s.root + '/review-script.js')});icon(row,'eye');await poll(()=>modal('Review incoming code'));return true`
        )
        const code = await captureSyncScreen(a, 'token-code-' + width, '.token-sync-content')
        expect(code.over).toEqual([])
        expect(code.clipped).toEqual([])
        expect(code.extra.buttons).toBeGreaterThan(0)
        expect(code.extra.buttonsInView).toBe(code.extra.buttons)
        expect(code.extra.onTop).toBe(true)
        closeSyncScreens(a)
        a.run(
          `app.commands.executeCommandById('abele:sync-log');await poll(()=>inWindows('.token-sync-settings'));return true`
        )
        const log = await captureSyncScreen(a, 'token-log-' + width, '.token-sync-settings')
        expect(log.over).toEqual([])
        expect(log.clipped).toEqual([])
        closeSyncScreens(a)
      }
    } finally {
      closeSyncScreens(a)
      await setWindowSize(a.vault(), ...size)
      await reloadAs(a.vault(), false)
    }
  },
  fixture
)
liveCase(
  'syncDialogs',
  'held paths and trash date controls fit every supported width',
  [51, 56],
  async () => {
    const s = fixture(),
      a = s.primary,
      id = await s.connect(),
      size = windowSize(a.vault()),
      paths = Array.from(
        { length: 60 },
        (_, i) => s.root + '/long sample folder/held note ' + i + '.md'
      )
    for (const path of paths) a.create(path, 'held sample content')
    await a.syncNow()
    await a.pause(id, true)
    // Exercise sixty file deletions; a directory removal is one directory operation in v2.
    a.remove(paths)
    await a.pause(id, false)
    await a.syncNow()
    expect(
      a.run(`return (await svc.runtimes.get(${JSON.stringify(id)}).heldDeletes()).length`)
    ).toBe(60)
    try {
      for (const width of [1200, 390, 320]) {
        await setWindowSize(a.vault(), width, width === 1200 ? 900 : 844)
        await reloadAs(a.vault(), width < 500)
        await a.waitIdle()
        a.run(
          `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'settings');await poll(()=>inWindows('.abele-held-deletes'),20000,'held deletions in either owner window');return true`
        )
        const held = await captureSyncScreen(a, 'token-held-' + width, '.abele-held-deletes')
        expect(held.over).toEqual([])
        expect(held.clipped).toEqual([])
        expect(held.capped).toEqual([])
        expect(held.stranded).toEqual([])
        expect(a.run(`return textOf(inWindows('.abele-held-deletes__more'))`)).toBe('and 40 more')
        expect(
          a.run(
            `const box=inWindows('.abele-held-deletes');const paths=box.querySelector('.abele-held-deletes__paths').getBoundingClientRect(),actions=box.querySelector('.abele-held-deletes__actions').getBoundingClientRect();return paths.bottom<=actions.top+1`
          )
        ).toBe(true)
        closeSyncScreens(a)
      }
      a.run(
        `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'settings');await poll(()=>inWindows('.abele-held-deletes'));await press(inWindows('.abele-held-deletes'),'Delete everywhere');await poll(()=>inWindows('.abele-confirm__message'));const confirm=inWindows('.abele-confirm__message');await press(confirm.closest('.modal'),'Delete everywhere');return true`
      )
      closeSyncScreens(a)
      await a.syncNow()
      // Keep the folder-deletion behavior as well as the held-file layout guarantee.
      a.remove([s.root + '/long sample folder'])
      await a.syncNow()
      expect(
        (await s.items()).some((one) => one.path.startsWith(s.root + '/long sample folder'))
      ).toBe(false)
      for (const width of [1200, 390, 320]) {
        await setWindowSize(a.vault(), width, width === 1200 ? 900 : 844)
        await reloadAs(a.vault(), width < 500)
        await a.waitIdle()
        await a.trash()
        for (const preset of ['hour', 'today', 'custom']) {
          // Use the actual native dropdown and date field, including the custom-date state.
          a.run(
            `const select=inWindows('.abele-restore-since select');select.value=${JSON.stringify(preset)};select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(100);return true`
          )
          const trash = await captureSyncScreen(
            a,
            'token-trash-' + preset + '-' + width,
            '.abele-deleted-files'
          )
          expect(trash.over).toEqual([])
          expect(trash.clipped).toEqual([])
          expect(trash.capped).toEqual([])
          expect(trash.stranded).toEqual([])
          expect(
            a.run(
              `const row=inWindows('.abele-restore-since').getBoundingClientRect();return row.left>=0&&row.right<=innerWidth+1`
            )
          ).toBe(true)
          expect(a.run(`return !!inWindows('.abele-restore-since input')`)).toBe(
            preset === 'custom'
          )
        }
        closeSyncScreens(a)
      }
    } finally {
      closeSyncScreens(a)
      await setWindowSize(a.vault(), ...size)
      await reloadAs(a.vault(), false)
    }
  },
  fixture
)
