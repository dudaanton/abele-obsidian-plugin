import { expect, it } from 'vitest'
import { evalLong, enterPhone, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { columnShot } from './helpers/columnShots'
import { shotDir } from './helpers/shots'

targets('desktop')
const shots = shotDir('abele-approval-command')

async function closeFixture() {
  await evalLong(`(async()=>{
    const card=document.querySelector(".abele-node-delegation");
    const close=[...(card?.closest(".modal-container")?.querySelectorAll(".modal-header-button,.modal-close-button")??[])].find(el=>el.getBoundingClientRect().width);
    if(close)close.click();
    else document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27,bubbles:true}));
    for(let i=0;i<100;i++){if(!card?.isConnected)return true;await new Promise(r=>setTimeout(r,50))}
    throw Error("The previous command fixture did not unmount");
  })()`)
}

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
      await closeFixture()
    }
  }
  try {
    await evalLong(
      `window.__abeleTest.openDialog('node-delegation-card', ${JSON.stringify({ delegationState: 'prompt', delegationCommand: ['git', 'add', '--', 'src/sample file.ts'] })})`
    )
    const text = await evalLong(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('[data-node-command]');i++)await new Promise(r=>setTimeout(r,50));
      const line=document.querySelector('[data-node-command]');line.scrollIntoView({block:'center'});return line.textContent;
    })()`)
    expect(text).toBe("git add -- 'src/sample file.ts'")
    columnShot(`${shots}/${label}-argv.png`)
  } finally {
    await closeFixture()
  }
  try {
    await evalLong(
      `window.__abeleTest.openDialog('node-delegation-card', {delegationState:'owner-stopped'})`
    )
    const text = await evalLong(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('.abele-node-delegation');i++)await new Promise(r=>setTimeout(r,50));
      return document.querySelector('.abele-node-delegation').textContent;
    })()`)
    expect(text).toContain('Stopped by you. Restart it from its chat.')
    expect(
      await evalLong(`!!document.querySelector('.abele-node-delegation .abele-status-dot_faint')`)
    ).toBe('true')
    expect(text).not.toContain('Paused; can continue')
    const meta = JSON.parse(
      await evalLong(`(()=>{
      const card=document.querySelector('.abele-node-delegation');
      return JSON.stringify({text:card.querySelector('.abele-node-delegation__meta').textContent,label:card.querySelector('.abele-status-dot').getAttribute('aria-label')});
    })()`)
    )
    expect(meta.text).not.toContain('·')
    expect(meta.label).toBe('Stopped')
    columnShot(`${shots}/${label}-owner-stopped.png`)
  } finally {
    await closeFixture()
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
