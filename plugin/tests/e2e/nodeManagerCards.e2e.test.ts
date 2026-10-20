import { expect, it } from 'vitest'
import { evalLong, evalRaw, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-manager')

async function inspectCards(label: string) {
  for (const state of ['working', 'done', 'failed', 'empty']) {
    try {
      await evalLong(
        `window.__abeleTest.openDialog('node-delegation-card', {delegationState:${JSON.stringify(state)}})`
      )
      const report = JSON.parse(
        await evalLong(`(async () => {
        for (let i=0;i<100&&!document.querySelector('.abele-node-delegation');i++) await new Promise(r=>setTimeout(r,50));
        const card=document.querySelector('.abele-node-delegation'), details=card.querySelector('details');
        return JSON.stringify({overflow:card.scrollWidth>card.clientWidth+1,open:details.open,prompt:!!card.querySelector('[data-pending-prompts]'),text:card.textContent})
      })()`)
      ) as { overflow: boolean; open: boolean; prompt: boolean; text: string }
      expect(report.overflow).toBe(false)
      expect(report.open).toBe(state === 'working' || state === 'empty')
      expect(report.prompt).toBe(state === 'working')
      expect(report.text).toContain('work/sample-parser-boundaries')
      columnShot(`${shots}/${label}-${state}.png`)
    } finally {
      evalRaw(`document.querySelector('.modal-close-button')?.click()`)
    }
  }
}

it('shows bounded activity, prompts and collapsed terminal reports', async () => {
  await inspectCards(onPhone() ? 'phone' : 'desktop')
}, 90000)

it.skipIf(onPhone())(
  'fits the phone layout',
  async () => {
    try {
      await enterPhone()
      await inspectCards('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  120000
)
