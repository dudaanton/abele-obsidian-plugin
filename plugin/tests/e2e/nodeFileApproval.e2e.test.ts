import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-file-approval')

async function inspect(label: string) {
  try {
    await evalLong(`window.__abeleTest.openDialog('file-approval-comparison')`)
    const report = JSON.parse(
      await evalLong(`(async()=>{
      for(let i=0;i<100&&document.querySelectorAll('.abele-tool-approval').length<2;i++)await new Promise(r=>setTimeout(r,50));
      return JSON.stringify([...document.querySelectorAll('.abele-tool-approval')].map(card=>({
        text:card.textContent,diff:!!card.querySelector('.abele-diff'),overflow:card.scrollWidth>card.clientWidth+1
      })));
    })()`)
    ) as { text: string; diff: boolean; overflow: boolean }[]
    expect(report).toHaveLength(2)
    for (const card of report) {
      expect(card.text).toContain('src/sample.ts')
      expect(card.text).not.toMatch(/expected_content_id|operation_id|old_text|new_text/)
      expect(card.diff).toBe(true)
      expect(card.overflow).toBe(false)
    }
    columnShot(`${shots}/${label}-node-and-vault.png`)
  } finally {
    await evalLong(
      `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))`
    )
  }
}

it('shows pending node and vault edit diffs on desktop and phone', async () => {
  await inspect('desktop')
  try {
    await enterPhone()
    await inspect('phone')
  } finally {
    await reloadApp('app.emulateMobile(false)')
  }
}, 90000)
