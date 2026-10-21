import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-manager')

async function closeFixture() {
  await evalLong(`(async () => {
    const card=document.querySelector('.abele-node-delegation,.abele-node-manager-run,.abele-agents');
    const close=[...(card?.closest('.modal-container')?.querySelectorAll('.modal-header-button,.modal-close-button')??[])].find(el=>el.getBoundingClientRect().width);
    if(close)close.click();
    else document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
    for(let i=0;i<100;i++) {
      if(!card?.isConnected)return true;
      await new Promise(r=>setTimeout(r,50));
    }
    throw Error('The previous manager fixture did not unmount');
  })()`)
}

async function inspectCards(label: string) {
  for (const state of [
    'working',
    'done',
    'failed',
    'empty',
    'paused',
    'paused-prompt',
    'warning',
    'prompt',
    'answering',
  ]) {
    try {
      await evalLong(
        `window.__abeleTest.openDialog('node-delegation-card', {delegationState:${JSON.stringify(state)}})`
      )
      const report = JSON.parse(
        await evalLong(`(async () => {
        for (let i=0;i<100&&!document.querySelector('.abele-node-delegation');i++) await new Promise(r=>setTimeout(r,50));
        const card=document.querySelector('.abele-node-delegation'), details=card.querySelector('details');
        return JSON.stringify({overflow:card.scrollWidth>card.clientWidth+1,open:details.open,prompt:!!card.querySelector('[data-pending-prompts],.abele-tool-approval'),text:card.textContent})
      })()`)
      ) as { overflow: boolean; open: boolean; prompt: boolean; text: string }
      expect(report.overflow).toBe(false)
      expect(report.open).toBe(
        state === 'working' ||
          state === 'empty' ||
          state === 'prompt' ||
          state === 'answering' ||
          state === 'paused-prompt'
      )
      expect(report.prompt).toBe(
        state === 'working' ||
          state === 'prompt' ||
          state === 'answering' ||
          state === 'paused-prompt'
      )
      if (state === 'paused') expect(report.text).toContain('Paused; can continue')
      if (state === 'paused-prompt') {
        expect(report.text).toContain('Time limit reached while waiting for your answer')
        expect(report.text).toContain('Allow')
      }
      if (state === 'warning') expect(report.text).toContain('Sample cleanup warning')
      if (state === 'prompt')
        expect(report.text).toContain('npm test -- tests/sample-parser.test.ts')
      expect(report.text).toContain('work/sample-parser-boundaries')
      columnShot(`${shots}/${label}-${state}.png`)
    } finally {
      await closeFixture()
    }
  }
  try {
    await evalLong(`window.__abeleTest.openDialog('agents', {agentsState:'manager-team'})`)
    const overview = JSON.parse(
      await evalLong(`(async () => {
      for(let i=0;i<100&&!document.querySelector('.abele-agents');i++)await new Promise(r=>setTimeout(r,50));
      const root=document.querySelector('.abele-agents');
      return JSON.stringify({rows:root.querySelectorAll('.abele-agents__row').length,text:root.textContent,overflow:root.scrollWidth>root.clientWidth+1});
    })()`)
    ) as { rows: number; text: string; overflow: boolean }
    expect(overview.rows).toBe(4)
    expect(overview.text).toContain('Sample manager')
    expect(overview.text).toContain('Sample parser developer')
    expect(overview.text).toContain('Done')
    expect(overview.overflow).toBe(false)
    columnShot(`${shots}/${label}-overview.png`)
  } finally {
    await closeFixture()
  }
}

async function inspectRuns(label: string) {
  for (const state of [
    'pending_approval',
    'running',
    'exited',
    'denied',
    'timed_out',
    'cancelled',
    'applied',
    'failed',
    'outcome_unknown',
  ]) {
    try {
      await evalLong(
        `window.__abeleTest.openDialog('node-manager-run', {managerRunState:${JSON.stringify(state)}})`
      )
      const report = JSON.parse(
        await evalLong(`(async () => {
        for(let i=0;i<100&&!document.querySelector('.abele-node-manager-run');i++) await new Promise(r=>setTimeout(r,50));
        const root=document.querySelector('.abele-node-manager-run');
        return JSON.stringify({overflow:root.scrollWidth>root.clientWidth+1,text:root.textContent,approval:!!root.querySelector('.abele-tool-approval'),stops:[...root.querySelectorAll('button')].filter(button => button.textContent.trim()==='Stop').length});
      })()`)
      ) as { overflow: boolean; text: string; approval: boolean; stops: number }
      expect(report.overflow).toBe(false)
      expect(report.approval).toBe(state === 'pending_approval')
      expect(report.stops).toBe(['pending_approval', 'running'].includes(state) ? 1 : 0)
      if (state === 'failed') expect(report.text).toContain('src/sample-parser.ts')
      if (state === 'outcome_unknown') expect(report.text).toContain('The result is unknown')
      columnShot(`${shots}/${label}-command-${state}.png`)
    } finally {
      await closeFixture()
    }
  }
}

it('shows durable command approvals, output and every terminal outcome', async () => {
  await inspectRuns(onPhone() ? 'phone' : 'desktop')
}, 90000)

it('shows bounded activity, prompts and collapsed terminal reports', async () => {
  await inspectCards(onPhone() ? 'phone' : 'desktop')
}, 90000)

it.skipIf(onPhone())(
  'fits the phone layout',
  async () => {
    try {
      await enterPhone()
      await inspectCards('phone-emulated')
      await inspectRuns('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  120000
)
