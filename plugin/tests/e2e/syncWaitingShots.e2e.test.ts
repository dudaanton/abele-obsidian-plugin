import { expect, it } from 'vitest'
import { activeVaultName, vaultCli } from './helpers/obsidianCli'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { probePrelude, type Screen } from './helpers/layoutProbe'
import { SYNC_PRELUDE } from './helpers/syncDriver'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')

// Presentation data only: no token is stored, no engine starts and no file is changed.
const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
const waiting = [
  { path: 'Research/Field notes/Survey export.zip', fact: 'quota_waiting: server storage is full' },
  { path: 'Workshop/Reference photos.png', fact: 'quota_exceeded: server storage is full' },
  { path: 'Research/Reading list.md', fact: 'rate_limited: server asked to try again later' },
  { path: 'Workshop/Agenda.md', fact: 'Server unavailable; kept locally until it reconnects' },
].map((item) => ({
  ...item,
  // The state projection removes the code prefix before the UI receives a fact.
  fact: item.fact.replace(/^[a-z_-]+: /, ''),
  kind: 'waiting',
  direction: 'out',
  since,
}))
const refused = {
  path: 'Research/Field notes/Map reference.pdf',
  kind: 'held',
  direction: 'in',
  since,
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
        window.__waitingShotRestore={rows:svc.rows.value,activity:svc.activity.value,available:svc.available.value};
        svc.available.value=true;
        svc.rows.value=[{id:'sample-waiting',kind:'token',address:'https://sync.example',spaceId:'sample-space',tokenId:'sample-token',scope:{kind:'folder',id:'root',path:'/'},secretReference:'',ledgerId:'sample-ledger',paused:false,status:'idle',state:{}}];
        return true;
      `)
      try {
        for (const [state, items, expectedWaiting, expectedRefused] of [
          ['one', waiting.slice(0, 1), 1, 0],
          ['several', waiting, 4, 0],
          ['mixed', [refused, ...waiting], 4, 1],
        ] as const) {
          const result = run<
            Screen & { line: string; status: string; headings: string[]; height: number }
          >(`
            ${probePrelude(shots)}
            svc.activity.value={'sample-waiting':{notSynced:${JSON.stringify(items)}}};
            const root=await openSyncTab();
            const owner=root.ownerDocument.defaultView;
            owner.require('@electron/remote').getCurrentWindow().setContentSize(${width},${height});
            await poll(()=>owner.innerWidth===${width}&&owner.innerHeight===${height});
            connectionRow(root,'sample-waiting').click();
            await poll(()=>inWindows('.abele-sync-window'));
            await wait(300);
            const body=inWindows('.abele-sync-window'),sheet=body.closest('.modal');
            const result=await screen(${JSON.stringify(layout + '-' + state)},sheet,body);
            result.line=textOf(body.querySelector('.abele-sync-window__line'));
            result.status=textOf(document.querySelector('.abele-sync-status-text'));
            result.headings=[...body.querySelectorAll('.abele-section__heading')].map(textOf);
            result.height=owner.innerHeight;
            if(${layout === 'phone'}) {
              result.extra.metaLines=[...body.querySelectorAll('.abele-not-synced__row')].map(row=>{
                const meta=row.querySelector('.abele-not-synced__meta');
                const range=owner.document.createRange();range.selectNodeContents(meta);
                return new Set([...range.getClientRects()].filter(r=>r.height>0).map(r=>Math.round(r.top))).size;
              });
              const scroller=body.closest('.abele-modal__body');
              scroller.scrollTop=scroller.scrollHeight;
              await wait(150);
              const last=[...body.querySelectorAll('.setting-item,.abele-entry-row')].filter(el=>el.getBoundingClientRect().height>0).at(-1);
              result.extra.lastRowBottom=last.getBoundingClientRect().bottom;
              result.extra.footerTop=sheet.querySelector('.abele-modal__footer').getBoundingClientRect().top;
              if(${state === 'mixed'})result.extra.bottomShot=await shoot('phone-mixed-bottom',owner.document);
              scroller.scrollTop=0;
            }
            return result;
          `)
          console.log('[waiting screenshot]', layout, state, JSON.stringify(result))
          expect(result.error).toBe('')
          expect(result.over).toEqual([])
          expect(result.width).toBe(width)
          expect(result.height).toBe(height)
          if (layout === 'phone') {
            expect(result.extra.metaLines as number[]).toEqual(
              expect.arrayContaining([expect.any(Number)])
            )
            expect((result.extra.metaLines as number[]).every((lines) => lines <= 2)).toBe(true)
            expect(result.extra.lastRowBottom as number).toBeLessThanOrEqual(
              result.extra.footerTop as number
            )
          }
          expect(result.line).toBe(
            expectedRefused
              ? '1 file not synced · 4 waiting'
              : `${expectedWaiting} ${expectedWaiting === 1 ? 'file' : 'files'} waiting`
          )
          expect(result.headings).toContain(`Waiting · ${expectedWaiting}`)
          expect(result.headings.includes('Not synced · 1')).toBe(expectedRefused > 0)
          expect(result.status).toBe(
            expectedRefused
              ? '1 file not synced · 4 waiting'
              : `${expectedWaiting} ${expectedWaiting === 1 ? 'file' : 'files'} waiting`
          )
          run(close + 'return true')
          if (state === 'mixed') {
            const summary = run<Screen & { line: string }>(`
              ${probePrelude(shots)}
              const root=await openSyncTab();
              await wait(300);
              const owner=root.ownerDocument.defaultView;
              owner.require('@electron/remote').getCurrentWindow().setContentSize(${width},${height});
              await poll(()=>owner.innerWidth===${width}&&owner.innerHeight===${height});
              const result=await screen(${JSON.stringify(layout + '-status')},root.closest('.modal')||root,root);
              result.line=textOf(root.querySelector('.abele-sync-row__line'));
              result.extra.opening=textOf(root).includes('File exchange is opening');
              const sep=root.querySelector('.abele-sync-row__separator');
              const range=owner.document.createRange(),length=sep.firstChild.textContent.length;
              range.setStart(sep.firstChild,length-1);range.setEnd(sep.firstChild,length);
              result.extra.separatorSpace=range.getBoundingClientRect().width;
              return result;
            `)
            console.log('[waiting summary screenshot]', layout, JSON.stringify(summary))
            expect(summary.error).toBe('')
            expect(summary.line).toBe('1 file not synced · 4 waiting')
            expect(summary.extra.opening).toBe(false)
            expect(summary.extra.separatorSpace as number).toBeGreaterThan(0)
            run(close + 'return true')
            if (layout === 'desktop') {
              const bar = run<{ shot: string; text: string; visible: boolean }>(`
                ${probePrelude(shots)}
                const el=document.querySelector('.abele-sync-status-text');
                const box=el.getBoundingClientRect();
                return {shot:await shoot('desktop-status-bar'),text:textOf(el),visible:box.width>0&&box.height>0};
              `)
              console.log('[waiting status bar screenshot]', JSON.stringify(bar))
              expect(bar.text).toBe('1 file not synced · 4 waiting')
              expect(bar.visible).toBe(true)
            }
          }
        }
      } finally {
        run(
          `${close}const saved=window.__waitingShotRestore;if(saved){svc.rows.value=saved.rows;svc.activity.value=saved.activity;svc.available.value=saved.available;delete window.__waitingShotRestore}return true`
        )
      }
    }
  } finally {
    await setWindowSize(vault, ...size)
    await reloadAs(vault, false)
  }
}, 240000)
