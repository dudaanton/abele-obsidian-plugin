/** The lazy map stylesheet must work in both desktop and phone-width windows. */
import { afterAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const shots = shotDir('map-styles')
const original = evalJson<{ size: number[]; mobile: boolean }>(`({
  size: require('electron').remote.getCurrentWindow().getSize(),
  mobile: document.body.classList.contains('is-mobile')
})`)

afterAll(async () => {
  evalRaw(`require('electron').remote.getCurrentWindow().setSize(${original.size.join(',')})`)
  await reloadApp(`app.emulateMobile(${original.mobile})`)
})

describe('map styles on first use', () => {
  it.each([false, true])(
    'draws a styled map with mobile emulation %s',
    async (mobile) => {
      evalRaw(
        `require('electron').remote.getCurrentWindow().setSize(${mobile ? '390,844' : '1000,800'})`
      )
      await reloadApp(`app.emulateMobile(${mobile})`)
      const answer = await evalLong(`(async () => {
      const root = document.createElement('div')
      root.className = 'abele-map'
      Object.assign(root.style, { position: 'fixed', width: 'auto', left: '16px', right: '16px', top: '100px', height: '350px', zIndex: '1000' })
      document.body.appendChild(root)
      let handle
      const before = document.querySelectorAll('style[data-abele-map]').length
      try {
        handle = await window.__abeleTest.renderMap(root, {
          points: [{ lat: 48.858, lon: 2.294, label: 'Sample point' }],
          lines: [{ points: [{ lat: 48.856, lon: 2.29 }, { lat: 48.86, lon: 2.298 }] }],
          center: { lat: 48.858, lon: 2.294 }, zoom: 14, height: 350, interactive: true,
        })
        const canvas = root.querySelector('canvas')
        const until = async (name, predicate) => {
          const end = Date.now() + 15000
          while (!predicate()) {
            if (Date.now() > end) throw new Error(name + ': ' + root.innerHTML.slice(0, 2000))
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
        await until('canvas and scale', () => canvas.width > 0 && root.querySelector('.maplibregl-ctrl-scale')?.textContent)
        root.querySelector('.abele-map__pin').click()
        await until('popup', () => root.querySelector('.maplibregl-popup-content')?.textContent.includes('Sample point'))
        // The geometry assertion waits on layout; the picture additionally shows live tiles.
        await new Promise(resolve => setTimeout(resolve, 1500))
        const box = root.getBoundingClientRect()
        const popup = root.querySelector('.maplibregl-popup-content')
        const close = popup.querySelector('button').getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents([...popup.childNodes].find(node => node.textContent === 'Sample point'))
        const text = range.getBoundingClientRect()
        const closeOverlaps = close.left < text.right && close.right > text.left && close.top < text.bottom && close.bottom > text.top
        const buttons = [...root.querySelectorAll('.maplibregl-ctrl button')]
        const overflow = buttons.filter(button => {
          const b = button.getBoundingClientRect()
          return b.left < box.left || b.right > box.right || b.top < box.top || b.bottom > box.bottom
        }).length
        const image = await require('electron').remote.getCurrentWindow().webContents.capturePage()
        require('fs').writeFileSync(${JSON.stringify(shots + '/')} + ${JSON.stringify(mobile ? 'phone.png' : 'desktop.png')}, image.toPNG())
        return {
          before, during: document.querySelectorAll('style[data-abele-map]').length,
          position: getComputedStyle(canvas).position,
          overflow, closeOverlaps, viewportOverflow: box.right > innerWidth, popup: popup.textContent,
        }
      } finally {
        handle?.destroy()
        root.remove()
      }
    })()`)
      expect(answer).not.toMatch(/^Error:/)
      const result = JSON.parse(answer)
      expect(result).toMatchObject({
        before: 0,
        during: 1,
        position: 'absolute',
        overflow: 0,
        closeOverlaps: false,
        viewportOverflow: false,
      })
      expect(result.popup).toContain('Sample point')
      expect(evalJson('document.querySelectorAll("style[data-abele-map]").length')).toBe(0)
    },
    60_000
  )
})
