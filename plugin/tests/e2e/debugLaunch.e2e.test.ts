import { expect, it } from 'vitest'
import { evalLong } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'

targets('desktop')
const shots = shotDir('abele-debug-launch')
async function probe(device: string) {
  return JSON.parse(
    await evalLong(
      `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const states = [];
    for (const state of ['ready', 'empty', 'long', 'error']) {
      window.__abeleTest.openDialog('debugger-launch');
      await wait(400);
      try {
        const modal = [...document.querySelectorAll('.modal.abele-modal')].at(-1);
        const inputs = modal.querySelectorAll('input');
        const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); };
        if (state === 'empty') set(inputs[0], '');
        if (state === 'long') {
          set(inputs[0], 'dist/' + 'sample-folder/'.repeat(16) + 'main.js');
          set(inputs[1], 'order --label "' + 'sample item '.repeat(24) + '"');
        }
        if (state === 'error') {
          [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === 'Run a program').click();
          await wait(150);
          if (!modal.querySelector('[role="alert"]')?.textContent.includes('Cannot find module sample-module')) throw Error('Missing startup stderr');
        }
        await wait(200);
        const rect = modal.getBoundingClientRect();
        const over = [...modal.querySelectorAll('input, button, [role="alert"]')].filter(el => {
          const r = el.getBoundingClientRect(); return r.left < rect.left - 1 || r.right > rect.right + 1;
        }).map(el => el.outerHTML.slice(0,200));
        if (over.length) throw Error('Overflow: '+JSON.stringify(over));
        const image = await require('@electron/remote').getCurrentWebContents().capturePage();
        require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(device)}+'-'+state+'.png', image.toPNG());
        states.push(state);
      } finally {
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', bubbles:true}));
        await wait(250);
      }
    }
    return JSON.stringify(states);
  })()`,
      30000
    )
  ) as string[]
}

it('shows launch fields and retained startup errors on desktop and phone', async () => {
  expect(await probe('desktop')).toEqual(['ready', 'empty', 'long', 'error'])
  expect(await withEmulatedPhone(() => probe('phone'))).toEqual(['ready', 'empty', 'long', 'error'])
})
