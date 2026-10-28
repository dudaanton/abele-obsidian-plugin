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
        const stopAtStart = modal.querySelector('[role="checkbox"][aria-label="Stop at start"]');
        if (!stopAtStart || stopAtStart.getAttribute('aria-checked') !== 'false') throw Error('Stop at start must default off');
        if (state === 'ready') {
          stopAtStart.click();
          const configuration = [...modal.querySelectorAll('.abele-disclosure__control')].find(el => el.textContent.includes('Runtime and environment'));
          if (!configuration) throw Error('Missing runtime configuration');
          configuration.click();
          await wait(100);
          for (const label of ['Runtime arguments', 'Working folder', 'Environment variables']) {
            if (!modal.querySelector('[aria-label="'+label+'"]')) throw Error('Missing launch field: '+label);
          }
          require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(device)}+'-configuration.png', (await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
          configuration.click();
          await wait(100);
          if (stopAtStart.getAttribute('aria-checked') !== 'true') throw Error('Stop at start did not enable');
          require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(device)}+'-stop-at-start.png', (await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
          stopAtStart.click();
        }
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
          if (!modal.querySelector('[role="alert"]')?.textContent.includes('The program exited before the debugger could attach.')) throw Error('Missing plain startup explanation');
          if (modal.innerText.includes('debugger_startup_handoff_lost')) throw Error('Internal code visible before opening details');
          [...modal.querySelectorAll('.abele-disclosure__control')].at(-1).click();
          await wait(100);
          if (!modal.innerText.includes('debugger_startup_handoff_lost')) throw Error('Missing technical details');
          const detailsImage = await require('@electron/remote').getCurrentWebContents().capturePage();
          require('fs').writeFileSync(${JSON.stringify(shots)}+'/'+${JSON.stringify(device)}+'-details.png', detailsImage.toPNG());
          [...modal.querySelectorAll('.abele-disclosure__control')].at(-1).click();
        }
        await wait(200);
        const rect = modal.getBoundingClientRect();
        if (${JSON.stringify(device)} === 'desktop' && rect.height > 500) throw Error('Short launch form is not sized to its content: '+rect.height);
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
