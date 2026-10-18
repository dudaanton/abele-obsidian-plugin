import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'

targets('desktop')
const shots = shotDir('abele-debugger-menu')
async function probe(label: string) {
  return JSON.parse(
    await evalLong(
      `(async () => {
    const results = [];
    try {
    for (const kind of ['file', 'node', 'place']) {
      for (const state of ['ready', 'refused', 'offline', 'reconnected', 'old', 'disabled', 'missing']) {
        const rows = await window.__abeleTest.openDebuggerMenuFixture(kind, state);
        const debug = rows.filter(row => /^(Debug|Run a program|Attach to a running program)( —|$)/.test(row.title));
        if (debug.length !== 3 || debug.some(row => row.title.includes('Checking'))) throw Error('Unsettled snapshot: '+JSON.stringify(rows));
        if (debug.some(row => row.disabled !== (state !== 'ready'))) throw Error('Incorrect availability: '+JSON.stringify(debug));
        await new Promise(resolve => setTimeout(resolve, 200));
        const image = await require('@electron/remote').getCurrentWebContents().capturePage();
        require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(label)}+'-'+kind+'-'+state+'.png', image.toPNG());
        window.__abeleTest.closeDebuggerMenuFixture();
        await new Promise(resolve => setTimeout(resolve, 50));
        results.push({kind, state, debug});
      }
    }
    return JSON.stringify(results);
    } finally { window.__abeleTest.closeDebuggerMenuFixture() }
  })()`,
      90000
    )
  ) as { kind: string; state: string; debug: { title: string; disabled: boolean }[] }[]
}

it('settles real context-menu snapshots before display on desktop and phone geometry', async () => {
  const desktop = await probe('desktop')
  expect(desktop).toHaveLength(21)
  const phone = await withEmulatedPhone(() => probe('phone'))
  expect(phone).toEqual(desktop)
})
