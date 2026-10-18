import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const shots = shotDir('node-pairing-wrap')

describe.skipIf(!isObsidianRunning() || !hasTestApi())(
  'localized pairing actions on the phone',
  () => {
    it.each(['ru', 'en-XA'])(
      'wraps the full pending label in %s',
      async (locale) => {
        await withEmulatedPhone(async () => {
          const result = JSON.parse(
            await evalLong(
              `(async () => {
        ${WAIT_PRELUDE}
        const api = window.__abeleTest;
        await api.setTestLocale(${JSON.stringify(locale)});
        try {
          void api.openDialog('node-pairing-long');
          const action = await until(() => document.querySelector('.abele-node-pairing .abele-obsidian-button_wrap'));
          if (!action) throw Error('Pending pairing action did not mount');
          action.scrollIntoView({ block: 'center', behavior: 'instant' });
          await new Promise(resolve => setTimeout(resolve, 300));
          const modal = action.closest('.modal');
          const label = action.querySelector('.abele-obsidian-button__label');
          const box = action.getBoundingClientRect();
          const bounds = modal.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(label);
          const lines = [...range.getClientRects()];
          const fs = require('fs');
          fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true });
          const win = require('@electron/remote').getCurrentWindow();
          fs.writeFileSync(${JSON.stringify(shots + '/' + locale + '-phone.png')}, (await win.webContents.capturePage()).toPNG());
          return JSON.stringify({
            fits: box.left >= bounds.left && box.right <= bounds.right && box.right <= innerWidth,
            textFits: lines.every(line => line.left >= box.left && line.right <= box.right + 1 && line.top >= box.top && line.bottom <= box.bottom + 1),
            wraps: new Set(lines.map(line => Math.round(line.top))).size > 1,
            translated: ${JSON.stringify(locale)} === 'ru' ? label.textContent.startsWith('Возобновить сопряжение:') : label.textContent.includes('⟦'),
            complete: label.textContent.includes('sampleproject'.repeat(4)),
          });
        } finally {
          const root = document.querySelector('.abele-node-pairing');
          const modal = root?.closest('.modal');
          modal?.querySelector('.modal-close-button, .modal-header-button')?.click();
          if (!await until(() => !document.querySelector('.abele-node-pairing'))) throw Error('Pairing dialog did not close');
          await api.setTestLocale('en');
        }
      })()`,
              30_000
            )
          ) as Record<string, boolean>
          expect(result).toEqual({
            fits: true,
            textFits: true,
            wraps: true,
            translated: true,
            complete: true,
          })
        })
      },
      120_000
    )
  }
)
