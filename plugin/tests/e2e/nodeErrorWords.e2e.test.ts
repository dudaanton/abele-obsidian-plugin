import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-node-error-words')

const probe = (device: string) =>
  evalAsync<{ visible: boolean; diagnostic: boolean; words: boolean }>(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    await window.__abeleTest.openNodeSessionFixture('idle');
    try {
      const connection = window.__abeleTest.NodeService.getInstance().connection('sample-session-node');
      connection.error.value = 'paired_route_tls_or_unreachable';
      let line;
      for (let i = 0; i < 100; i++) {
        line = document.querySelector('.abele-node-chat [role="alert"] .abele-node-error-words');
        if (line) break;
        await wait(50);
      }
      if (!line) throw new Error('Node error did not render');
      await wait(350);
      const box = line.getBoundingClientRect();
      const root = line.closest('.abele-node-chat').getBoundingClientRect();
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/${device}-tls-error.png',
        (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      const tlsWords = line.textContent.includes('Check its address') && !line.textContent.includes('paired_route_tls_or_unreachable');
      let otherWords = true;
      for (const [code, expected] of [
        ['unauthorized', 'The node refused access. Pair again or check your permissions.'],
        ['outcome_unknown', 'The result is unknown. Refresh and check what happened before trying again.'],
        ['rate_limit', 'The node reached a limit. Wait before trying again.'],
        ['record_too_large', 'The request is too large. Reduce its size and try again.'],
        ['debugger_profile_unavailable', 'The debugger is unavailable. Check the debug configuration and reconnect.'],
        ['output_limit', 'The node returned too much output. Narrow the request or use paging.'],
        ['future_refusal', 'The node could not complete the request. Check the details before trying again.'],
      ]) {
        connection.error.value = code;
        await wait(100);
        const current = line.getBoundingClientRect();
        otherWords &&= line.title === code && line.textContent === expected &&
          current.left >= Math.max(0, root.left) && current.right <= Math.min(innerWidth, root.right) + 1;
      }
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/${device}-unknown-error.png',
        (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
      return {
        visible: box.width > 0 && box.left >= Math.max(0, root.left) && box.right <= Math.min(innerWidth, root.right) + 1 && box.top >= 0 && box.bottom <= innerHeight,
        diagnostic: line.title === 'future_refusal',
        words: tlsWords && otherWords
      };
    } finally {
      await window.__abeleTest.closeNodeSessionFixture();
    }
  })()`)

it('keeps translated node errors inside the chat on desktop and phone', async () => {
  expect(await probe('desktop')).toEqual({ visible: true, diagnostic: true, words: true })
  expect(await withEmulatedPhone(() => probe('phone'))).toEqual({
    visible: true,
    diagnostic: true,
    words: true,
  })
})
