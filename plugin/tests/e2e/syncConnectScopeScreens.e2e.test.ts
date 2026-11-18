import { expect, it } from 'vitest'
import { activeVaultName, vaultCli } from './helpers/obsidianCli'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { probePrelude, type Screen } from './helpers/layoutProbe'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { SHARE_SET_PICKER } from './helpers/shareSetPicker'
import { closeScopeCapture } from './helpers/closeScopeCapture'

// Both sizes run on the desktop app; this file never takes the real phone.
targets('desktop')

it('captures device-scope states in the real desktop and emulated phone dialogs', async () => {
  const vault = vaultCli(activeVaultName())
  const size = windowSize(vault)
  const shots = shotDir('abele-sync-connect-scope')
  const close = () =>
    vault.evalAwait(`(async () => {
    await (${closeScopeCapture.toString()})(document,window);
    return true;
  })()`)
  const states = [
    'connect-checking',
    'connect-error',
    'connect-default',
    'connect-restricted',
    'picker-empty',
    'picker-long',
    'connection-missing',
    'connection-owned',
    'connection-narrowing',
    'connection-widening',
    'share-pending',
    'share-uploading',
    'share-failure',
    'share-issued',
  ]
  try {
    for (const [width, height] of [
      [1200, 900],
      [390, 844],
    ]) {
      await setWindowSize(vault, width, height)
      await reloadAs(vault, width < 500)
      for (const state of states) {
        try {
          const results = vault.evalAwait<Screen[]>(
            `(async () => {
            ${probePrelude(shots)}
            const poll=async(check,unused,label)=>{if(!await until(check,8000))throw new Error(label)};
            const textOf=el=>el?.textContent?.trim()||'';
            const typeInto=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))};
            ${SHARE_SET_PICKER}
            window.__abeleTest.openDialog('sync-scope-capture',{syncScopeState:${JSON.stringify(state)}});
            let box;
            await poll(()=>box=document.querySelector('.modal.abele-modal'),undefined,'scope fixture modal');
            const state=${JSON.stringify(state)},phone=${width < 500};
            const button=label=>[...box.querySelectorAll('button')].find(one=>textOf(one)===label);
            const capture=async label=>screen(label+'-${width}',box,box.querySelector('.abele-modal__body'));
            const picker=()=>box.querySelector('.abele-share-picker');
            const settlePicker=async()=>{
              picker()?.querySelector('input')?.blur();
              await poll(()=>!picker()?.querySelector('input')?.disabled&&!picker()?.querySelector('.abele-share-picker__results'),undefined,'picker settled after selection');
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            };
            if(state==='connect-checking') await poll(()=>box.querySelector('input[type=password]')?.value&&button('Connect')?.disabled&&!picker(),undefined,'checking before scope is available');
            else if(state==='connect-error') await poll(()=>box.querySelector('.setting-item-error')||box.querySelector('.abele-setting__error')||/could not|unable|failed|unavailable/i.test(textOf(box)),undefined,'Connect preflight error');
            else if(!state.startsWith('share-')) await poll(()=>picker(),undefined,'device scope picker');
            if(state.startsWith('connection-')) {
              picker().scrollIntoView({block:'center'});
              if(state==='connection-narrowing'||state==='connection-widening') {
                await pickShareItem(box,'Folder: Sample collection/Long descriptive parent/Example item '+(state==='connection-narrowing'?'01':'04'));
                await settlePicker();
                await poll(()=>!picker().querySelector('input').disabled,undefined,'scope change settled');
              }
              if(!textOf(box).includes('sample-owned-device-key'))throw new Error('Owned key details missing');
            }
            if(state.startsWith('share-')) {
              await poll(()=>picker()&&!picker().querySelector('input').disabled,undefined,'Share choices ready');
              await pickShareItem(box,'Folder: Sample collection/Long descriptive parent/Example item 01');
              await settlePicker();
              const name=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Name')?.querySelector('input');
              if(!name)throw new Error('Share name missing');typeInto(name,'Sample field team');
              await poll(()=>button('Create token')&&!button('Create token').disabled,undefined,'Share issue enabled');
              if(state!=='share-pending') {
                button('Create token').click();
                if(state==='share-uploading')await poll(()=>box.querySelector('progress'),undefined,'upload progress');
                if(state==='share-failure')await poll(()=>box.querySelector('[role=alert]'),undefined,'upload failure');
                if(state==='share-issued')await poll(()=>box.querySelector('textarea[readonly]'),undefined,'issued token');
              }
            }
            if(state==='picker-empty'||state==='picker-long') {
              const pictures=[];
              for(const kind of ['folder','group','file']) {
                picker().querySelector('[data-scope-kind="'+kind+'"]').click();
                const input=picker().querySelector('input');input.focus();
                typeInto(input,state==='picker-empty'?'Absent sample':'Example item');
                await poll(()=>state==='picker-empty'?(phone?/No matching/i.test(textOf(picker())):!document.querySelector('.suggestion-item[data-share-kind]')):!!document.querySelector('.suggestion-item[data-share-kind="'+kind+'"]'),undefined,'kind results '+kind);
                pictures.push(await capture(state+'-'+kind));
                if(phone&&state==='picker-long') {
                  input.focus();
                  document.documentElement.style.setProperty('--keyboard-height','300px');
                  window.dispatchEvent(new Event('keyboardWillShow'));
                  let option;
                  await poll(()=>{
                    option=picker().querySelector('.suggestion-item[data-share-kind="'+kind+'"]');
                    option?.scrollIntoView({block:'nearest'});
                    const r=option?.getBoundingClientRect(),bottom=window.innerHeight-300;
                    return document.activeElement===input&&r&&r.height>0&&r.top>=0&&r.bottom<=bottom;
                  },undefined,'focused '+kind+' result above emulated keyboard');
                  pictures.push(await capture('phone-keyboard-'+kind));
                  document.documentElement.style.removeProperty('--keyboard-height');
                  window.dispatchEvent(new Event('keyboardWillHide'));
                }
              }
              return pictures;
            }
            await wait(200);
            return [await capture(state)];
          })()`,
            90_000
          )
          expect(results.length).toBeGreaterThan(0)
          for (const result of results) {
            expect(result.error, result.shot).toBe('')
            expect(result.over, result.shot).toEqual([])
            expect(result.clipped, result.shot).toEqual([])
          }
        } finally {
          close()
        }
      }
    }
  } finally {
    close()
    await setWindowSize(vault, ...size)
    await reloadAs(vault, false)
  }
}, 600_000)
