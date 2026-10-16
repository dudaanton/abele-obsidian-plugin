/** Actual node renderers alongside an Obsidian code block, on both clients. */
import { expect, it } from 'vitest'
import { evalLong, evalRaw } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'
targets('desktop', 'phone')
const shots = shotDir('abele-node-syntax')
it('uses the same token colours as Obsidian for shell, TypeScript and diffs', async () => {
  for (const kind of ['sh', 'ts', 'diff']) {
    try {
      await evalLong(`window.__abeleTest.openDialog('node-syntax-${kind}')`)
      const result = JSON.parse(
        await evalLong(`(async()=>{
        const root=document.querySelector('.abele-syntax-fixture'),wait=ms=>new Promise(r=>setTimeout(r,ms));
        for(let i=0;i<100&&!root.querySelector('.markdown-rendered .token');i++)await wait(50);
        const ref=root.querySelector('.markdown-rendered .token.keyword');
        const code=root.querySelector('.cm-content .token.keyword,.abele-diff .token.keyword');
        const tool=root.querySelector('pre .token.keyword');
        return JSON.stringify({reference:ref&&getComputedStyle(ref).color,code:code&&getComputedStyle(code).color,tool:tool&&getComputedStyle(tool).color,tokens:root.querySelectorAll('.token').length})
      })()`)
      ) as { reference: string; code: string; tool: string; tokens: number }
      expect(result.tokens).toBeGreaterThan(3)
      expect(result.reference).toBeTruthy()
      expect(result.code).toBe(result.reference)
      expect(result.tool).toBe(result.reference)
      columnShot(`${shots}/${kind}.png`)
      evalRaw(
        `document.querySelector('.abele-syntax-fixture .markdown-rendered')?.scrollIntoView({block:'end'})`
      )
      columnShot(`${shots}/${kind}-reference.png`)
    } finally {
      evalRaw(`document.querySelector('.modal-close-button')?.click()`)
    }
  }
}, 60000)
