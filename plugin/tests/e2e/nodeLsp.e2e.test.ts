import { expect, it } from 'vitest'
import { onPhone, targets } from './helpers/target'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-lsp')

it('shows language analysis states and navigation on desktop and a phone-sized screen', async () => {
  const bounds = onPhone()
    ? undefined
    : evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
  try {
    for (const mobile of onPhone() ? [true] : [false, true]) {
      await reloadApp(`app.emulateMobile(${mobile})`)
      if (!onPhone())
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
        const shot = async name => { await wait(350); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); if (['diagnostic-tap','diagnostic-list','long-press'].includes(name)) { const label = document.querySelector('.abele-lsp-menu-message') ?? [...document.querySelectorAll('.menu-item-title')].find(el => el.textContent.includes('Go to definition')); const box = label.getBoundingClientRect(); if (!document.elementFromPoint(box.left+box.width/2,box.top+Math.min(box.height/2,12))?.closest('.menu')) throw Error('Menu content is clipped or covered: ' + name); } const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(mobile ? 'phone-' : 'desktop-')} + name + '.png'; if (window.__e2eHost) await window.__e2eHost.shot(path); else require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG()); };
        const results = [];
        try { for (const state of ['missing','untrusted','loading','errors','eslint','failed','off','ready']) {
          phase = state + '-viewer';
          await window.__abeleTest.openDialog('node-lsp-' + state);
          await until(() => document.querySelector('.abele-file-view .cm-content'));
          phase = state + '-status';
          const expected = ({loading:'starting',missing:'degraded',untrusted:'degraded',eslint:'degraded',errors:'ready',failed:'failed',off:'off',ready:'ready'})[state];
          await until(() => document.querySelector('[data-lsp-analysis]')?.dataset.state === expected);
          if (document.querySelector('.abele-lsp-status')) throw Error('Analysis banner rendered inside file');
          const headerBox = document.querySelector('.abele-lsp-fixture-header').getBoundingClientRect();
          const fileBox = document.querySelector('.abele-file-view').getBoundingClientRect();
          if (headerBox.bottom > fileBox.top + 0.5) throw Error('Fixture header overlaps file content');
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
          if (state === 'untrusted' && ![...document.querySelectorAll('.menu-item-title')].some(el => el.textContent === 'Trust this folder…')) throw Error('Owner trust action is missing');
          await shot(state + '-analysis-menu');
          document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          await until(() => !document.querySelector('.menu'));
          if (Math.abs(contentTop() - top) > 0.5) throw Error('Analysis menu shifted file');
          if (state === 'loading') {
            document.querySelector('[data-lsp-settle]').dispatchEvent(new Event('lsp-settle'));
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
              content.querySelector('.cm-line')?.scrollIntoView({block:'center'});
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
            await shot('references-menu');
            [...document.querySelectorAll('.menu-item-title')].find(e=>e.textContent.includes('Find references')).closest('.menu-item').click();
            await until(() => document.querySelectorAll('[data-reference-row]').length === 2);
            if (document.querySelector('[data-reference-row].is-active')) throw Error('Reference is active before the first click');
            document.querySelector('[data-node-references]').scrollIntoView({block:'start'});
            await shot('references-one');
            [...document.querySelectorAll('[data-reference-row]')].find(row => JSON.parse(row.dataset.referenceRow)[1] === 1).click();
            await until(() => document.querySelector('[data-lsp-destination]')?.textContent === 'sample.ts:2');
            if (!${mobile} && !document.querySelector('[data-reference-row].is-active')) throw Error('Desktop references disappeared after navigation');
            if (${mobile}) await until(() => !document.querySelector('[data-node-references]'));
            for (const mode of ['several', 'long', 'empty']) {
              phase = 'references-' + mode;
              document.querySelector('[data-lsp-settle]').dispatchEvent(new CustomEvent('reference-mode', {detail:mode}));
              await wait(50);
              p=point();p.target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:p.x,clientY:p.y}));
              await until(() => [...document.querySelectorAll('.menu-item-title')].some(e=>e.textContent.includes('Find references')));
              [...document.querySelectorAll('.menu-item-title')].find(e=>e.textContent.includes('Find references')).closest('.menu-item').click();
              await until(() => {
                const list = document.querySelector('[data-node-references]');
                return list && !list.textContent.includes('Finding references') && (mode === 'empty' ? list.textContent.includes('No references to sample.') : list.querySelectorAll('[data-reference-file]').length === (mode === 'long' ? 99 : 5));
              });
              const list = document.querySelector('[data-node-references]');
              list.scrollIntoView({block:'start'});
              const listBox = list.getBoundingClientRect();
              if (listBox.left < -1 || listBox.right > innerWidth + 1) throw Error('References list overflows the screen');
              if (mode === 'several' && !list.querySelector('[title="Definition"]')) throw Error('Definition marker missing');
              if (mode === 'long' && (list.querySelectorAll('[data-reference-row]').length !== 13 || !list.textContent.includes('Show 10 more'))) throw Error('Long references are not folded and capped');
              if (${mobile} && !list.closest('.modal.mod-lg')) throw Error('Phone references do not use a tall modal');
              for (const heading of list.querySelectorAll('.abele-fold-heading')) {
                const count = heading.querySelector('.abele-fold-heading__count');
                if (!count || Math.abs(count.getBoundingClientRect().right - heading.getBoundingClientRect().right) > 12) throw Error('Reference file count is not aligned at the right edge');
              }
              for (const group of list.querySelectorAll('[data-reference-file]')) {
                const rows = [...group.querySelectorAll('[data-reference-row]')];
                const starts = rows.map(row => row.querySelector('code').getBoundingClientRect().left);
                if (starts.some(left => Math.abs(left - starts[0]) > 1)) throw Error('Definition glyph shifts the line text');
                if (${mobile} && rows.length === 1 && group.getBoundingClientRect().height > 56) throw Error('Phone reference group is too tall');
              }
              if (mode === 'several' && list.querySelector('[data-reference-file]').dataset.referenceFile !== 'sample.ts') throw Error('Current file references are missing or not first');
              if (mode !== 'empty') {
                const origin = list.querySelector('[data-reference-file="sample.ts"]');
                if (!origin?.textContent.includes('export const sample: string = 42') || !origin.textContent.includes('console.log(sample)')) throw Error('Original-file reference snippets do not match its source');
              }
              if (mode === 'empty' && list.textContent.includes('0 references')) throw Error('Empty references repeats the count');
              if (!${mobile}) {
                const viewer = list.closest('.abele-file-view');
                const preview = viewer.querySelector('.abele-file-view__file');
                if (preview.getBoundingClientRect().bottom < viewer.getBoundingClientRect().bottom - 4) throw Error('File preview leaves unused space below it');
              }
              if (!${mobile} && mode === 'several') {
                const target = [...list.querySelectorAll('[data-reference-row]')].find(row => JSON.parse(row.dataset.referenceRow)[0] === 'src/sample-001.ts');
                target.click();
                await until(() => document.querySelector('[data-lsp-destination]')?.textContent === 'src/sample-001.ts:1' && document.querySelector('.abele-lsp-root .abele-file-view__path')?.textContent === 'src/sample-001.ts');
                if (!target.classList.contains('is-active')) throw Error('Opened reference is not active');
              }
              await shot('references-' + mode);
              if (mode === 'long') {
                const more = [...list.querySelectorAll('button')].find(button => button.textContent.includes('Show 10 more'));
                if (!more) throw Error('Show more action is missing');
                more.click();
                await until(() => list.querySelectorAll('[data-reference-file]').length === 109 && !list.textContent.includes('Show 10 more'));
              }
              if (${mobile}) {
                if (mode === 'several') {
                  phase = 'references-definition-tap';
                  const definition = list.querySelector('[title="Definition"]')?.closest('[data-reference-row]');
                  if (!definition) throw Error('Definition result is missing');
                  definition.click();
                  await until(() => document.querySelector('[data-lsp-destination]')?.textContent === 'sample.ts:1');
                } else {
                  phase = 'references-' + mode + '-close';
                  const closeButton = list.closest('.modal').querySelector('.modal-close-button, .modal-header-button.mod-raised');
                  if (!closeButton) throw Error('Host modal close control is missing');
                  closeButton.click();
                }
                await until(() => !document.querySelector('[data-node-references]'));
              }
            }
            results.push({state:'navigation', text:'definition and references', fits:true});
          }
          await close();
        }
        for (const [admission, reason] of Object.entries({
          comparison: 'Open the file view to analyze code.',
          pastRevision: 'This view is a past revision.',
          nodeUnsupported: 'Code analysis is not available on this node.',
          noConnection: 'No connection to this node is available.',
          offline: 'The node is offline.',
          contentUnavailable: 'File contents are not available for analysis.',
          fileTooLarge: 'File too large for analysis (limit: 512 KiB).',
          noServers: 'No language server accepted this file.',
          documentLimit: 'The node reached its analysis document limit.',
          describeFailure: 'Sample description timeout',
          linkedWorktree: 'TypeScript — running',
        })) {
          phase = 'admission-' + admission;
          await window.__abeleTest.openDialog('node-lsp-ready', { lspAdmission: admission });
          const expected = admission === 'linkedWorktree' ? 'ready' : ['documentLimit', 'describeFailure'].includes(admission) ? 'failed' : 'off';
          await until(() => document.querySelector('[data-lsp-analysis]')?.dataset.state === expected);
          document.querySelector(${mobile} ? '[data-lsp-overflow]' : '[data-lsp-analysis] button').click();
          if (${mobile}) {
            await until(() => [...document.querySelectorAll('.menu-item-title')].some(el => el.textContent === 'Code analysis'));
            [...document.querySelectorAll('.menu-item-title')].find(el => el.textContent === 'Code analysis').closest('.menu-item').click();
          }
          await until(() => [...document.querySelectorAll('.menu-item-title')].some(el => el.textContent.includes(reason)));
          await shot('admission-' + admission + '-menu');
          document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          await until(() => !document.querySelector('.menu'));
          const rect = document.querySelector('.modal.abele-modal').getBoundingClientRect();
          results.push({ state: admission, text: reason, fits: rect.left >= -1 && rect.right <= innerWidth + 1 });
          await close();
        }
        return JSON.stringify(results);
        } catch (error) { await shot('failure-' + phase); throw Error(phase + ': ' + (error.stack ?? error.message ?? error)); }
        finally { window.removeEventListener('unhandledrejection', onError); window.removeEventListener('error', onError); }
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
    if (bounds)
      evalRaw(
        `document.querySelector('[data-lsp-close]')?.click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));require('@electron/remote').getCurrentWindow().setContentSize(${bounds[0]},${bounds[1]})`
      )
    if (onPhone())
      evalRaw(
        `document.querySelector('[data-lsp-close]')?.click();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`
      )
    else await reloadApp('app.emulateMobile(false)')
  }
}, 240000)
