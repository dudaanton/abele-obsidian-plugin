import { afterAll, describe, expect, it } from 'vitest'
import {
  enterPhone,
  evalLong,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-date-markdown')

describe.skipIf(!available)('markdown in scheduled titles in the date picker', () => {
  afterAll(async () => {
    if (available) await reloadApp('app.emulateMobile(false)')
  }, 120_000)

  for (const phone of [false, true]) {
    it(`renders linked titles inline on ${phone ? 'phone' : 'desktop'}`, async () => {
      if (phone) await enterPhone()
      const result = JSON.parse(
        await evalLong(
          `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const tasks = window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks
        const id = 'date-markdown-fixture'
        const day = new Date()
        const date = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-')
        tasks.set(id, {
          id, title: 'Review [[Sample note]] and [[Other note|short label]] **bold** ' + 'long title '.repeat(20),
          taskName: 'sample-task', taskPath: 'sample-task.md', dates: [date],
          taskNotFound: false, completedAt: null, getTaskDate: () => null,
        })
        try {
          window.__abeleTest.openDialog('date')
          let root
          for (let n = 0; n < 80; n++) {
            root = [...document.querySelectorAll('.abele-datetime-picker__task-title')].find((el) => el.querySelector('a[data-href="Other note"]'))
            if (root) break
            await wait(100)
          }
          if (!root) throw new Error('linked scheduled title did not render')
          const paragraph = root.querySelector('p')
          const box = root.getBoundingClientRect()
          const fs = require('fs')
          fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })
          const win = require('@electron/remote').getCurrentWindow()
          await wait(500)
          const image = await win.webContents.capturePage()
          fs.writeFileSync(${JSON.stringify(shots + (phone ? '/phone.png' : '/desktop.png'))}, image.toPNG())
          return JSON.stringify({
            alias: root.querySelector('a[data-href="Other note"]').textContent,
            wiki: root.querySelector('a[data-href="Sample note"]')?.textContent,
            bold: root.querySelector('strong')?.textContent,
            inline: paragraph && getComputedStyle(paragraph).display,
            fits: box.left >= 0 && box.right <= innerWidth,
            clipped: root.scrollWidth > root.clientWidth,
          })
        } finally {
          tasks.delete(id)
          const cancel = [...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim() === 'Cancel')
          cancel?.click()
        }
      })()`,
          30_000
        )
      )
      expect(result).toEqual({
        alias: 'short label',
        wiki: 'Sample note',
        bold: 'bold',
        inline: 'inline',
        fits: true,
        clipped: true,
      })
    }, 180_000)
  }
})
