import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'

targets('desktop')
const shots = shotDir('abele-debugger-reconnect')

async function probe(label: string) {
  return JSON.parse(
    await evalLong(
      `(async () => {
    const api = window.__abeleTest, wait = ms => new Promise(r => setTimeout(r, ms));
    const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await wait(50) } throw Error('Debugger refresh did not settle') };
    const panel = () => document.querySelector('.abele-debug-panel');
    const retry = () => panel()?.querySelector('.abele-debug-panel__notice [aria-label="Try to reconnect"]');
    const shot = async name => {
      await wait(200);
      if (!panel() || panel().getBoundingClientRect().width < 200) throw Error('Debugger panel is not visible');
      const image = await require('@electron/remote').getCurrentWebContents().capturePage();
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png', image.toPNG());
    };
    try {
      const stale = await api.openDebuggerReconnectFixture('survived');
      if (stale.status !== 'lost' || stale.current || !retry()) throw Error('Missing stale timestamp refresh');
      await shot('stale');
      retry().click();
      await until(() => api.debuggerReconnectFixtureState().current);
      const resumed = api.debuggerReconnectFixtureState();
      if (!panel().classList.contains('abele-debug-panel_paused') || retry()) throw Error('Session did not resume');
      await shot('resumed');
      await api.closeDebuggerReconnectFixture();
      await api.openDebuggerReconnectFixture('gone');
      if (!retry()) throw Error('Missing timestamp refresh for the ended session');
      retry().click();
      await until(() => api.debuggerReconnectFixtureState().unavailable);
      const gone = api.debuggerReconnectFixtureState();
      if (retry() || !panel().querySelector('[aria-label="Start a new run"]') ||
          !panel().textContent.includes('Debug session ended. Start a new run.')) throw Error('Missing explicit new-run state');
      await shot('session-gone');
      return { stale, resumed, gone };
    } finally { await api.closeDebuggerReconnectFixture() }
  })()`,
      60000
    )
  ) as {
    stale: { status: string; current: boolean; reads: number; connects: number }
    resumed: { status: string; current: boolean; reads: number; connects: number }
    gone: { status: string; unavailable: boolean; reads: number; connects: number }
  }
}

it('refreshes the stale timestamp row on an already connected node on desktop and phone geometry', async () => {
  const desktop = await probe('desktop')
  expect(desktop.stale).toMatchObject({ status: 'lost', current: false, reads: 1, connects: 0 })
  expect(desktop.resumed).toMatchObject({ status: 'paused', current: true, reads: 2, connects: 1 })
  expect(desktop.gone).toMatchObject({ status: 'exited', unavailable: true, reads: 2, connects: 1 })
  const phone = await withEmulatedPhone(() => probe('phone'))
  expect(phone).toEqual(desktop)
})
