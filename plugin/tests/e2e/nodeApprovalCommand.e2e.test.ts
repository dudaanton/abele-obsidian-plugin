import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-approval-command')

async function inspect(label: string) {
  for (const [name, command, open] of [
    ['normal', 'npm test', false],
    ['long', 'echo ' + 'sample '.repeat(45) + 'end', true],
    ['hidden', 'echo \u202e\u001b\nline', true],
  ] as const) {
    try {
      await evalLong(
        `window.__abeleTest.openDialog('node-delegation-card', ${JSON.stringify({ delegationState: 'prompt', delegationCommand: command })})`
      )
      const report = JSON.parse(
        await evalLong(`(async () => {
        for(let i=0;i<100&&!document.querySelector('[data-node-command]');i++)await new Promise(r=>setTimeout(r,50));
        const command=document.querySelector('[data-node-command]');
        command.scrollIntoView({block:'center'});
        const card=command.closest('.abele-tool-approval');
        return JSON.stringify({command:command.textContent,open:card.querySelector('.abele-disclosure__control').getAttribute('aria-expanded'),overflow:card.scrollWidth>card.clientWidth+1});
      })()`)
      ) as { command: string; open: string; overflow: boolean }
      expect(report.command).toBe(
        command.replace('\u202e', '\\u202e').replace('\u001b', '\\u001b').replace('\n', '\\n')
      )
      expect(report.open).toBe(String(open))
      expect(report.overflow).toBe(false)
      columnShot(`${shots}/${label}-${name}.png`)
    } finally {
      await evalLong(
        `(() => {document.querySelector('.abele-node-delegation')?.closest('.modal-container')?.querySelector('.modal-close-button')?.click();return true})()`
      )
    }
  }
}

it('shows complete worker commands on desktop and phone layouts', async () => {
  await inspect('desktop')
  try {
    await enterPhone()
    await inspect('phone')
  } finally {
    await reloadApp('app.emulateMobile(false)')
  }
}, 90000)
