import { expect, it } from 'vitest'
import { enterPhone, evalLong, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const shots = shotDir('abele-node-rate-limit-phone')

it('keeps one near-limit notice readable across several turns on an emulated phone', async () => {
  try {
    await enterPhone(390, 844)
    const result = JSON.parse(
      await evalLong(
        `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        await window.__abeleTest.openNodeSessionFixture('rate-limit');
        let root;
        for (let i = 0; i < 200; i++) {
          root = document.querySelector('.abele-node-chat');
          if (root?.textContent.includes('Sample 3 checked.')) break;
          await wait(50);
        }
        if (!root?.textContent.includes('Sample 3 checked.')) throw Error('Node chat did not render');
        root.querySelector('.abele-ai-chat__messages').scrollTop = 0;
        await wait(350);
        const text = root.textContent;
        const notice = [...root.querySelectorAll('*')].find(el => el.childElementCount === 0 && el.textContent.includes('Usage limit close'));
        const box = notice?.getBoundingClientRect();
        const path = ${JSON.stringify(shots)} + '/node-rate-limit-several-turns-phone.png';
        require('fs').writeFileSync(path, (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG());
        return JSON.stringify({
          mobile: app.isMobile,
          width: innerWidth,
          copies: text.split('Usage limit close').length - 1,
          replies: [1, 2, 3].filter(n => text.includes('Sample ' + n + ' checked.')).length,
          iso: text.includes('T18:00:00.000Z'),
          readable: !!box && box.width > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
        });
      })()`,
        90000
      )
    ) as {
      mobile: boolean
      width: number
      copies: number
      replies: number
      iso: boolean
      readable: boolean
    }
    expect(result.mobile).toBe(true)
    expect(result.width).toBe(390)
    expect(result.copies).toBe(1)
    expect(result.replies).toBe(3)
    expect(result.iso).toBe(false)
    expect(result.readable).toBe(true)
  } finally {
    try {
      await evalLong('window.__abeleTest.closeNodeSessionFixture().then(() => "1")', 30000)
    } finally {
      await reloadApp('app.emulateMobile(false)')
    }
  }
})
