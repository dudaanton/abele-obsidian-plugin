import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { vaultCli } from './helpers/obsidianCli'
const screens = [
  'folder',
  'group',
  'initial-batch',
  'invitation',
  'creation',
  'books',
  'publication',
  'unshare',
  'script-approval',
  'plugin-code',
  'personal-join',
]
const cases = screens
  .map((screen) => ({ screen, state: 'pending' }))
  .concat([
    { screen: 'group', state: 'scope-updating' },
    { screen: 'publication', state: 'offline' },
    { screen: 'publication', state: 'cache-unknown' },
    { screen: 'books', state: 'revoked' },
    { screen: 'books', state: 'unsupported-transport' },
    { screen: 'books', state: 'recovery' },
  ])
describe.skipIf(!process.env.ABELE_FENCED_UI_STAGE)(
  'fenced screens native desktop inspection',
  () => {
    it.each(cases)(
      '$screen $state has readable bounds/scroll/close and no state mutation',
      async ({ screen, state }) => {
        if (process.env.ABELE_FENCED_UI_STAGE !== 'readonly')
          throw new Error('Only readonly fenced UI stage is allowed')
        const name = process.env.OBSIDIAN_TEST_VAULT
        if (!name) throw new Error('Exclusive pool vault required')
        const cli = vaultCli(name),
          scratch = fileURLToPath(new URL('../../../.scratch/fenced-ui/', import.meta.url))
        mkdirSync(scratch, { recursive: true })
        const before = cli.evalAwait<any>(
          `({keys:['abele-sync-connection','abele-sync-scoped-join','abele-sync-scoped-connection'].map(k=>app.loadLocalStorage(k)),size:require('@electron/remote').getCurrentWindow().getBounds()})`
        )
        let result: any
        try {
          cli.evalAwait(
            `(()=>{const w=require('@electron/remote').getCurrentWindow();w.setContentSize(980,820);return window.__abeleTest.openFencedScreen(${JSON.stringify(screen)},${JSON.stringify(state)})})()`
          )
          await new Promise((r) => setTimeout(r, 350))
          result = cli.evalAwait<any>(
            `(async()=>{const modal=[...document.querySelectorAll('.modal')].find(e=>e.classList.contains('abele-modal'));if(!modal)throw new Error('No inspected modal');const root=modal.getBoundingClientRect(),over=[...modal.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&s.display!=='none'&&s.visibility!=='hidden'&&r.right>Math.min(root.right,innerWidth)+2}).map(e=>e.className);const scrolls=[...modal.querySelectorAll('*')].filter(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>{e.scrollTop=e.scrollHeight;return{height:e.clientHeight,reached:e.scrollTop+e.clientHeight>=e.scrollHeight-2,lastClear:!e.lastElementChild||e.lastElementChild.getBoundingClientRect().bottom<=e.getBoundingClientRect().bottom+2}});const close=[...modal.querySelectorAll('button')].find(e=>/^(Close|Cancel|Later)$/.test(e.textContent.trim())),closeVisible=!!close&&close.getBoundingClientRect().bottom<=innerHeight+2;await new Promise(r=>requestAnimationFrame(r));const win=require('@electron/remote').getCurrentWebContents(),image=await win.capturePage();require('fs').writeFileSync(${JSON.stringify(join(scratch, screen + '-' + state + '.png'))},image.toPNG());return{width:innerWidth,height:innerHeight,root:{x:root.x,y:root.y,width:root.width,height:root.height},over,scrolls,closeVisible,buttons:[...modal.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled})),text:modal.textContent}})()`
          )
          writeFileSync(
            join(scratch, screen + '-' + state + '.json'),
            JSON.stringify(result, null, 2)
          )
          expect(result.over).toEqual([])
          expect(result.closeVisible).toBe(true)
          expect(result.scrolls.every((s: any) => s.reached && s.lastClear)).toBe(true)
          expect(result.text).not.toContain('undefined')
          writeFileSync(
            join(scratch, screen + '-' + state + '.json'),
            JSON.stringify(result, null, 2)
          )
        } finally {
          cli.evalAwait(
            `(()=>{window.__abeleTest.closeFencedScreen();require('@electron/remote').getCurrentWindow().setBounds(${JSON.stringify(before.size)});return true})()`
          )
        }
        const after = cli.evalAwait(
          `['abele-sync-connection','abele-sync-scoped-join','abele-sync-scoped-connection'].map(k=>app.loadLocalStorage(k))`
        )
        expect(after).toEqual(before.keys)
      }
    )
  }
)
