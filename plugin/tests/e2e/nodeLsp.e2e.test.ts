import { expect, it } from 'vitest'
import { targets } from './helpers/target'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-node-lsp')

it('shows language analysis states and navigation on desktop and a phone-sized screen', async () => {
  const bounds = evalJson<number[]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )
  try {
    for (const mobile of [false, true]) {
      await reloadApp(`app.emulateMobile(${mobile})`)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '390,844' : '1000,800'})`
      )
      const results = JSON.parse(
        await evalLong(
          `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        let phase = 'start';
        const runtimeErrors = [];
        const onError = event => runtimeErrors.push(String(event.reason ?? event.message));
        window.addEventListener('unhandledrejection', onError);
        window.addEventListener('error', onError);
        const until = async predicate => { for (let i=0;i<100;i++) { if(predicate()) return; await wait(50) } await shot('failure-' + phase); throw Error('Language fixture did not settle: ' + phase + ' · ' + document.querySelector('.modal.abele-modal')?.textContent + ' · runtime: ' + runtimeErrors.join('; ')) };
        const close = async () => { phase += '-close'; const button = document.querySelector('[data-lsp-close]'); if(!button) throw Error('Fixture dismiss action is missing'); button.click(); await until(() => !document.querySelector('.modal.abele-modal')); };
        const shot = async name => require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(mobile ? 'phone-' : 'desktop-')} + name + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
        const results = [];
        try { for (const state of ['missing','untrusted','loading','errors','eslint']) {
          phase = state + '-viewer';
          await window.__abeleTest.openDialog('node-lsp-' + state);
          await until(() => document.querySelector('.abele-lsp-root .cm-content'));
          phase = state + '-status';
          await until(() => document.body.textContent.includes(({loading: 'Loading language analysis', missing: 'Language server missing', untrusted: 'Trust folder', eslint: 'TypeScript analysis remains available', errors: 'sample'})[state]));
          if (state === 'errors') await until(() => document.querySelector('.abele-lsp-error') && document.querySelector('[data-lsp-diagnostics]')?.getAttribute('aria-label') === 'Diagnostics: 2');
          await wait(150);
          const modal = document.querySelector('.modal.abele-modal');
          const rect = modal.getBoundingClientRect();
          results.push({state, text: modal.textContent, fits: rect.left >= -1 && rect.right <= innerWidth + 1});
          await shot(state);
          if (state === 'errors') {
            phase = 'diagnostic-tap';
            const dot = document.querySelector('.modal.abele-modal .abele-lsp-gutter span[title]');
            const dotBox = dot.getBoundingClientRect();
            dot.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:dotBox.left+dotBox.width/2,clientY:dotBox.top+dotBox.height/2}));
            await until(() => document.querySelector('.abele-lsp-menu-message'));
            const message = document.querySelector('.abele-lsp-menu-message');
            if(!message.textContent.includes('typescript') || !message.textContent.includes('eslint') || getComputedStyle(message.parentElement).whiteSpace === 'nowrap') throw Error('Diagnostic messages are truncated');
            await shot('diagnostic-tap');
            document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            await until(() => !document.querySelector('.abele-lsp-menu-message'));
            phase = 'diagnostic-list';
            document.querySelector('.modal.abele-modal [data-lsp-diagnostics]').click();
            await until(() => document.querySelectorAll('.abele-lsp-menu-message').length === 2);
            await shot('diagnostic-list');
            document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            await until(() => !document.querySelector('.abele-lsp-menu-message'));
            const point = () => {
              const content = document.querySelector('.modal.abele-modal .abele-lsp-root .cm-content'), walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
              for(let node; node=walker.nextNode();) { const at=node.textContent.indexOf('sample'); if(at<0)continue; const range=document.createRange(); range.setStart(node,at+1);range.setEnd(node,at+2); const b=range.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,target:node.parentElement}; }
              throw Error('Identifier not drawn');
            };
            let p=point();
            phase = 'hover';
            p.target.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:p.x,clientY:p.y}));
            await until(() => document.querySelector('.cm-tooltip-hover'));
            await shot('hover');
            p.target.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true,clientX:0,clientY:0}));
            if (${mobile}) {
              phase = 'long-press';
              const touch=new Event('touchstart',{bubbles:true});Object.defineProperty(touch,'touches',{value:[{clientX:p.x,clientY:p.y}]});p.target.dispatchEvent(touch);
              await until(() => [...document.querySelectorAll('.menu-item-title')].some(e=>e.textContent.includes('Go to definition')));
              await shot('long-press');
              [...document.querySelectorAll('.menu-item-title')].find(e=>e.textContent.includes('Go to definition')).closest('.menu-item').click();
            } else p.target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,metaKey:true,clientX:p.x,clientY:p.y}));
            phase = 'definition';
            await until(() => document.querySelector('[data-lsp-destination]')?.textContent === 'sample.ts:1');
            await shot('definition');
            if (${mobile}) await wait(1100);
            phase = 'references';
            p=point();p.target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:p.x,clientY:p.y}));
            await until(() => [...document.querySelectorAll('.menu-item-title')].some(e=>e.textContent.includes('Find references')));
            [...document.querySelectorAll('.menu-item-title')].find(e=>e.textContent.includes('Find references')).closest('.menu-item').click();
            await until(() => document.querySelector('[data-lsp-destination]')?.textContent === 'sample.ts:2');
            results.push({state:'navigation', text:'definition and references', fits:true});
          }
          await close();
        }
        return JSON.stringify(results);
        } finally { window.removeEventListener('unhandledrejection', onError); window.removeEventListener('error', onError); }
      })()`,
          90000
        )
      ) as { state: string; text: string; fits: boolean }[]
      expect(results.every((result) => result.fits)).toBe(true)
      expect(results.find((result) => result.state === 'missing')?.text).toContain(
        'abele-node lsp install --popular'
      )
      expect(results.find((result) => result.state === 'untrusted')?.text).toContain('Trust folder')
      expect(results.find((result) => result.state === 'eslint')?.text).toContain(
        'TypeScript analysis remains available'
      )
      expect(results.some((result) => result.state === 'navigation')).toBe(true)
    }
  } finally {
    evalRaw(
      `document.querySelector('[data-lsp-close]')?.click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));require('@electron/remote').getCurrentWindow().setContentSize(${bounds[0]},${bounds[1]})`
    )
    await reloadApp('app.emulateMobile(false)')
  }
}, 240000)
