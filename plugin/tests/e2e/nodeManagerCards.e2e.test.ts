import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets, onPhone } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const shots = shotDir('abele-node-manager')

async function inspectToolPermissions(label: string) {
  await evalLong(`window.__abeleTest.openDialog('agent-tools')`)
  try {
    const report = JSON.parse(
      await evalLong(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let row;
      for (let i=0;i<100;i++) {
        const heading = [...document.querySelectorAll('.abele-tool-modes__group > .abele-fold-heading')].find(el => el.textContent.includes('Node'));
        if(heading?.getAttribute('aria-expanded') === 'false')heading.click();
        row = [...document.querySelectorAll('.abele-tool-modes__action')].find(el => el.textContent.includes('Hand work'));
        if(row)break;
        await wait(50);
      }
      if(!row)throw Error('Node action permissions did not appear');
      row.querySelector('.abele-tool-modes__members-toggle').click();
      await wait(100);
      row.scrollIntoView({block:'start'});
      return JSON.stringify([...row.querySelectorAll('.abele-tool-modes__members .setting-item')].map(el => ({name:el.querySelector('code').textContent,mode:el.querySelector('select').value})));
    })()`)
    ) as { name: string; mode: string }[]
    expect(report.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'node_delegate',
        'node_delegations',
        'node_delegation_send',
        'node_delegation_status',
        'node_delegation_cancel',
        'node_command_run',
        'node_command_status',
        'node_command_cancel',
        'node_git_integrate',
      ])
    )
    expect(report.every((row) => row.mode === 'off')).toBe(true)
    columnShot(`${shots}/${label}-node-tools-off.png`)
    await evalLong(
      `(() => {const rows=[...document.querySelectorAll('.abele-tool-modes__members .setting-item')];rows.at(-1)?.scrollIntoView({block:'end'});return true})()`
    )
    columnShot(`${shots}/${label}-node-tools-off-end.png`)
  } finally {
    await evalLong(
      `(() => {document.querySelector('.abele-agent-editor')?.closest('.modal-container')?.querySelector('.modal-close-button')?.click();return true})()`
    )
  }
}

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
        const card=document.querySelector('.abele-node-delegation'), details=card.querySelector('.abele-node-delegation__details > .abele-disclosure__control');
        if(!details)throw Error('The activity disclosure control is missing');
        return JSON.stringify({overflow:card.scrollWidth>card.clientWidth+1,open:details.getAttribute('aria-expanded')==='true',prompt:!!card.querySelector('[data-pending-prompts],.abele-tool-approval'),text:card.textContent})
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
      if (state === 'warning') {
        const revealed = await evalLong(`(async()=>{
          const card=document.querySelector('.abele-node-delegation');
          card.querySelector('.abele-node-delegation__details > .abele-disclosure__control').click();
          for(let i=0;i<100;i++){
            const content=card.querySelector('.abele-node-delegation__details > .abele-disclosure__content');
            if(content)return content.textContent;
            await new Promise(r=>setTimeout(r,50));
          }
          throw Error('The activity disclosure did not reveal its content');
        })()`)
        expect(revealed).toContain('Sample cleanup warning')
      }
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
  for (const escaped of [false, true]) {
    try {
      await evalLong(
        `window.__abeleTest.openDialog('node-manager-run', {managerEscapedCommand:${escaped}})`
      )
      const report = JSON.parse(
        await evalLong(`(async () => {
        for(let i=0;i<100&&!document.querySelector('[data-manager-approval]');i++)await new Promise(r=>setTimeout(r,50));
        const root=document.querySelector('[data-manager-approval]');
        const run=root.closest('.abele-node-manager-run');
        const answers=[...run.querySelectorAll('button')].filter(button=>['Stop','Deny','Allow'].includes(button.textContent.trim()));
        return JSON.stringify({open:root.querySelector('[data-manager-evidence] .abele-disclosure__control').getAttribute('aria-expanded')==='true',text:root.textContent,command:root.querySelector('[data-manager-command]').textContent,duplicate:run.textContent.includes('npm test -- tests/sample-parser.test.ts'),nativeDetails:!!run.querySelector('details'),buttonsVisible:answers.length===3&&answers.every(button=>{const box=button.getBoundingClientRect();return box.width>0&&box.top>=0&&box.bottom<=window.innerHeight}),overflow:root.scrollWidth>root.clientWidth+1});
      })()`)
      ) as {
        open: boolean
        text: string
        command: string
        duplicate: boolean
        nativeDetails: boolean
        buttonsVisible: boolean
        overflow: boolean
      }
      expect(report.open).toBe(false)
      expect(report.command).toBe(
        escaped ? "printf $'sample\\U0000000aline\\U0000000d\\U0000202e\\U0000200b'" : 'npm test'
      )
      expect(report.duplicate).toBe(false)
      expect(report.nativeDetails).toBe(false)
      expect(report.buttonsVisible).toBe(true)
      expect(report.text).toContain('sample-project')
      const evidence = await evalLong(
        `(async()=>{const root=document.querySelector('[data-manager-approval]');root.querySelector('[data-manager-evidence] .abele-disclosure__control').click();for(let i=0;i<100&&!root.querySelector('[data-manager-evidence] pre');i++)await new Promise(r=>setTimeout(r,50));return root.querySelector('[data-manager-evidence]').textContent})()`
      )
      expect(evidence).toContain('sample-session')
      expect(report.text).not.toMatch(/[\n\r\u202e\u200b]/u)
      expect(report.overflow).toBe(false)
      columnShot(`${shots}/${label}-approval-${escaped ? 'escaped' : 'normal'}.png`)
    } finally {
      await closeFixture()
    }
  }
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
        const states=[...root.querySelectorAll('[data-manager-state]')];
        return JSON.stringify({overflow:root.scrollWidth>root.clientWidth+1,text:root.textContent,stateLines:states.length,stateText:states[0]?.textContent,dot:!!states[0]?.querySelector('.abele-status-dot'),approval:!!root.querySelector('.abele-tool-approval'),stops:[...root.querySelectorAll('button')].filter(button => button.textContent.trim()==='Stop').length});
      })()`)
      ) as {
        overflow: boolean
        text: string
        stateLines: number
        stateText: string
        dot: boolean
        approval: boolean
        stops: number
      }
      expect(report.overflow).toBe(false)
      expect(report.stateLines).toBe(1)
      expect(report.dot).toBe(true)
      expect(report.stateText).not.toContain('(restart)')
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

it.skipIf(onPhone())(
  'shows node actions Off in ordinary agent tool permissions',
  async () => {
    await inspectToolPermissions('desktop')
  },
  30000
)

it('shows bounded activity, prompts and collapsed terminal reports', async () => {
  await inspectCards(onPhone() ? 'phone' : 'desktop')
}, 90000)

it.skipIf(onPhone())(
  'fits the phone layout',
  async () => {
    try {
      await enterPhone()
      await inspectToolPermissions('phone-emulated')
      await inspectCards('phone-emulated')
      await inspectRuns('phone-emulated')
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  },
  120000
)
