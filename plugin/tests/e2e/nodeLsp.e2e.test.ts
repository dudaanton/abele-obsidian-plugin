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
        const shot = async name => { await wait(350); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); if (['diagnostic-tap','diagnostic-list','long-press'].includes(name)) { const label = document.querySelector('.abele-lsp-menu-message') ?? [...document.querySelectorAll('.menu-item-title')].find(el => el.textContent.includes('Go to definition')); const box = label.getBoundingClientRect(); if (!document.elementFromPoint(box.left+box.width/2,box.top+Math.min(box.height/2,12))?.closest('.menu')) throw Error('Menu content is clipped or covered: ' + name); } require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(mobile ? 'phone-' : 'desktop-')} + name + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG()); };
        const results = [];
        try { for (const state of ['missing','untrusted','loading','errors','eslint','failed','off','ready']) {
          phase = state + '-viewer';
          await window.__abeleTest.openDialog('node-lsp-' + state);
          await until(() => document.querySelector('.abele-lsp-root .cm-content'));
          phase = state + '-status';
          const expected = ({loading:'starting',missing:'degraded',untrusted:'degraded',eslint:'degraded',errors:'ready',failed:'failed',off:'off',ready:'ready'})[state];
          await until(() => document.querySelector('[data-lsp-analysis]')?.dataset.state === expected);
          if (document.querySelector('.abele-lsp-status')) throw Error('Analysis banner rendered inside file');
          if (state === 'errors') await until(() => document.querySelector('.abele-lsp-error') && document.querySelector('[data-lsp-diagnostics]')?.getAttribute('aria-label') === 'Diagnostics: 2');
          await wait(150);
          const modal = document.querySelector('.modal.abele-modal');
          const rect = modal.getBoundingClientRect();
          results.push({state, text: modal.textContent, fits: rect.left >= -1 && rect.right <= innerWidth + 1});
          await shot(state);
          const contentTop = () => document.querySelector('.abele-file-view__code').getBoundingClientRect().top;
          const top = contentTop();
          document.querySelector(${mobile} ? '[data-lsp-overflow]' : '[data-lsp-analysis] button').click();
          if (${mobile}) {
            await until(() => [...document.querySelectorAll('.menu-item-title')].some(el => el.textContent === 'Code analysis'));
            await shot(state + '-overflow');
            [...document.querySelectorAll('.menu-item-title')].find(el => el.textContent === 'Code analysis').closest('.menu-item').click();
          }
          await until(() => [...document.querySelectorAll('.menu-item-title')].some(el => /TypeScript —|Code analysis/.test(el.textContent)));
          await shot(state + '-analysis-menu');
          document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          await until(() => !document.querySelector('.menu'));
          if (Math.abs(contentTop() - top) > 0.5) throw Error('Analysis menu shifted file');
          if (state === 'loading') {
            document.querySelector('[data-lsp-settle]').click();
            await until(() => document.querySelector('[data-lsp-analysis]')?.dataset.state === 'ready');
            if (Math.abs(contentTop() - top) > 0.5) throw Error('Analysis state shifted file');
            if (document.querySelector('[data-lsp-analysis] .abele-status-dot_pulse')) throw Error('Ready analysis still pulses');
            await shot('settled');
          }

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
            p.target.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,ctrlKey:true,clientX:p.x,clientY:p.y}));
            await until(() => document.querySelector('.cm-tooltip-hover'));
            if (!document.querySelector('.cm-tooltip-hover').textContent.includes('Sample documentation.')) throw Error('Hover documentation missing');
            const popup = document.querySelector('.cm-tooltip-hover'), signature = popup.querySelector('pre code');
            if (!signature || !popup.querySelector('.abele-lsp-problem__dot') || !popup.querySelector('hr') || !popup.querySelector('.abele-lsp-documentation')) throw Error('Structured hover content missing');
            if (popup.textContent.includes('typescript:') || !popup.textContent.includes(' · TypeScript')) throw Error('Hover source is not a suffix');
            if (parseFloat(getComputedStyle(popup).borderRadius) <= 0 || getComputedStyle(popup).boxShadow === 'none') throw Error('Popover radius or shadow missing');
            await shot('hover');
            const hoverBox = document.querySelector('.cm-tooltip-hover').getBoundingClientRect();
            const hoverBottom = document.elementFromPoint(hoverBox.left+hoverBox.width/2,hoverBox.bottom-3);
            if (!hoverBottom?.closest('.cm-tooltip-hover')) throw Error('Hover content is clipped or covered');
            const messageBox = document.querySelector('.cm-tooltip-hover .abele-lsp-message').getBoundingClientRect();
            if (hoverBox.bottom > messageBox.bottom + 4 || hoverBox.width > innerWidth) throw Error('Hover box stretches beyond its content: ' + JSON.stringify({inline:document.querySelector('.cm-tooltip-hover').style.cssText,height:getComputedStyle(document.querySelector('.cm-tooltip-hover')).height,bottom:getComputedStyle(document.querySelector('.cm-tooltip-hover')).bottom,right:getComputedStyle(document.querySelector('.cm-tooltip-hover')).right}));
            p.target.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true,clientX:0,clientY:0}));
            if (${mobile}) {
              phase = 'long-press';
              const finger = new Touch({identifier:1,target:p.target,clientX:p.x,clientY:p.y,pageX:p.x+scrollX,pageY:p.y+scrollY});
              p.target.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,view:window,touches:[finger],targetTouches:[finger],changedTouches:[finger]}));
              await until(() => [...document.querySelectorAll('.menu-item-title')].some(e=>e.textContent.includes('Go to definition')));
              if (![...document.querySelectorAll('.abele-lsp-menu-message')].some(e=>e.textContent.includes('Sample documentation.'))) throw Error('Long-press type documentation missing');
              if (!document.querySelector('.abele-lsp-menu-message pre code')) throw Error('Long-press signature is not code');
              p.target.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,view:window,touches:[],targetTouches:[],changedTouches:[finger]}));
              await shot('long-press');
              [...document.querySelectorAll('.menu-item-title')].find(e=>e.textContent.includes('Go to definition')).closest('.menu-item').click();
            } else {
              p.target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,ctrlKey:true,clientX:p.x,clientY:p.y}));
              p.target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:0,ctrlKey:true,clientX:p.x,clientY:p.y}));
            }
            phase = 'definition';
            await until(() => document.querySelector('[data-lsp-destination]')?.textContent === 'node_modules/sample-types/index.d.ts:3');
            await until(() => document.querySelector('[data-lsp-dependency] .cm-content')?.textContent.includes('export declare const sample'));
            if (document.querySelector('[data-lsp-dependency] .cm-content').getAttribute('contenteditable') !== 'false') throw Error('Dependency definition is editable');
            if (document.querySelector('[data-lsp-destination]').getBoundingClientRect().height !== 0) throw Error('Duplicate destination label is visible');
            if (!${mobile}) {
              await wait(200);
              if ([...document.querySelectorAll('.menu-item-title')].some(e=>e.textContent.includes('Go to definition'))) throw Error('Navigation also opened a symbol menu');
            }
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
      expect(
        results
          .filter((result) => result.state !== 'navigation')
          .every((result) => !result.text.includes('TypeScript analysis remains available'))
      ).toBe(true)
      expect(results.some((result) => result.state === 'navigation')).toBe(true)
    }
  } finally {
    evalRaw(
      `document.querySelector('[data-lsp-close]')?.click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));require('@electron/remote').getCurrentWindow().setContentSize(${bounds[0]},${bounds[1]})`
    )
    await reloadApp('app.emulateMobile(false)')
  }
}, 240000)
