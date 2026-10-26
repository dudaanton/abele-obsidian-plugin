import { expect, it } from 'vitest'
import { activeVaultName, vaultCli } from './helpers/obsidianCli'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { probePrelude, type Screen } from './helpers/layoutProbe'
import { SYNC_PRELUDE } from './helpers/syncDriver'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')

// Presentation data only: no token is stored, no engine starts and no file is changed.
const waiting = [
  { path: 'Research/Field notes/Survey export.zip', fact: 'quota_waiting: server storage is full' },
  { path: 'Workshop/Reference photos.png', fact: 'quota_exceeded: server storage is full' },
  { path: 'Research/Reading list.md', fact: 'rate_limited: server asked to try again later' },
  { path: 'Workshop/Agenda.md', fact: 'Server unavailable; kept locally until it reconnects' },
].map((item) => ({ ...item, kind: 'waiting', direction: 'out', since: '2025-01-01T12:00:00Z' }))
const refused = {
  path: 'Research/Field notes/Map reference.pdf',
  kind: 'held',
  direction: 'in',
  since: '2025-01-01T12:00:00Z',
  fact: 'Changed while it was being placed',
}

it('pictures temporary waits apart from refusals and compares connection and status counts', async () => {
  const vault = vaultCli(activeVaultName())
  const size = windowSize(vault)
  const shots = shotDir('abele-sync-waiting')
  const run = <T>(body: string) =>
    vault.evalAwait<T>(`(async () => { ${SYNC_PRELUDE}\n${body} })()`)
  const close = `for(const doc of new Set([document,settingsDoc()]))for(const button of [...doc.querySelectorAll('.modal-close-button,.modal-header-button:has(svg.lucide-x)')].reverse())button.click();await closeSettings();`
  try {
    for (const [layout, width, height] of [
      ['desktop', 1280, 900],
      ['phone', 390, 844],
    ] as const) {
      await setWindowSize(vault, width, height)
      await reloadAs(vault, layout === 'phone')
      run(`
        if(svc.rows.value.length)throw new Error('Screenshot fixture needs an unconnected pool vault');
        window.__waitingShotRestore={rows:svc.rows.value,activity:svc.activity.value};
        svc.rows.value=[{id:'sample-waiting',kind:'token',address:'https://sync.example',spaceId:'sample-space',tokenId:'sample-token',scope:{kind:'folder',id:'root',path:'/'},secretReference:'',ledgerId:'sample-ledger',paused:false,status:'idle',state:{}}];
        return true;
      `)
      try {
        for (const [state, items, expectedWaiting, expectedRefused] of [
          ['one', waiting.slice(0, 1), 1, 0],
          ['several', waiting, 4, 0],
          ['mixed', [refused, ...waiting], 4, 1],
        ] as const) {
          const result = run<Screen & { line: string; status: string; headings: string[] }>(`
            ${probePrelude(shots)}
            svc.activity.value={'sample-waiting':{notSynced:${JSON.stringify(items)}}};
            const root=await openSyncTab();
            connectionRow(root,'sample-waiting').click();
            await poll(()=>inWindows('.abele-sync-window'));
            await wait(300);
            const body=inWindows('.abele-sync-window'),sheet=body.closest('.modal');
            const result=await screen(${JSON.stringify(layout + '-' + state)},sheet,body);
            result.line=textOf(body.querySelector('.abele-sync-window__line'));
            result.status=textOf(document.querySelector('.abele-sync-status-text'));
            result.headings=[...body.querySelectorAll('.abele-section__heading')].map(textOf);
            return result;
          `)
          console.log('[waiting screenshot]', layout, state, JSON.stringify(result))
          expect(result.error).toBe('')
          expect(result.over).toEqual([])
          expect(result.line).toBe(
            expectedRefused ? '1 file not synced · Waiting (4)' : `Waiting (${expectedWaiting})`
          )
          expect(result.headings).toContain(`Waiting · ${expectedWaiting}`)
          expect(result.headings.includes('Not synced · 1')).toBe(expectedRefused > 0)
          expect(result.status).toBe(
            expectedRefused ? '1 file not synced · Waiting (4)' : `Waiting (${expectedWaiting})`
          )
          run(close + 'return true')
          if (state === 'mixed') {
            const summary = run<Screen>(`
              ${probePrelude(shots)}
              const root=await openSyncTab();
              await wait(300);
              return screen(${JSON.stringify(layout + '-status')},root.closest('.modal')||root,root);
            `)
            console.log('[waiting summary screenshot]', layout, JSON.stringify(summary))
            expect(summary.error).toBe('')
            run(close + 'return true')
          }
        }
      } finally {
        run(
          `${close}const saved=window.__waitingShotRestore;if(saved){svc.rows.value=saved.rows;svc.activity.value=saved.activity;delete window.__waitingShotRestore}return true`
        )
      }
    }
  } finally {
    await setWindowSize(vault, ...size)
    await reloadAs(vault, false)
  }
}, 240000)
