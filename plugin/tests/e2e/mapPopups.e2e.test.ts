/** Pin popups must open and keep their text clear of the host's close button. */
import { afterAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const shots = shotDir('map-popups')
const original = evalJson<{ size: number[]; mobile: boolean }>(`({
  size: require('electron').remote.getCurrentWindow().getSize(),
  mobile: document.body.classList.contains('is-mobile')
})`)

afterAll(async () => {
  evalRaw(`require('electron').remote.getCurrentWindow().setSize(${original.size.join(',')})`)
  await reloadApp(`app.emulateMobile(${original.mobile})`)
})

describe('map pin popups with global styles', () => {
  it('wraps a long pin label without clipping it behind the phone close button', async () => {
    evalRaw(`require('electron').remote.getCurrentWindow().setSize(390,844)`)
    await reloadApp('app.emulateMobile(true)')
    const label =
      'Sample station platform with a very long descriptive label and sampleunbrokenidentifier012345678901234567890123456789'
    const answer = await evalLong(`(async () => {
      const root = document.createElement('div')
      root.className = 'abele-map'
      Object.assign(root.style, { position: 'fixed', left: '16px', right: '16px', top: '100px', height: '350px', zIndex: '1000' })
      document.body.appendChild(root)
      let handle
      try {
        handle = await window.__abeleTest.renderMap(root, {
          points: [{ lat: 48.858, lon: 2.294, label: ${JSON.stringify(label)} }], lines: [],
          center: { lat: 48.858, lon: 2.294 }, zoom: 14, height: 350, interactive: true,
        })
        root.querySelector('.abele-map__pin').click()
        const deadline = Date.now() + 15000
        while (!root.querySelector('.maplibregl-popup-content')) {
          if (Date.now() > deadline) throw Error('popup absent')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const popup = root.querySelector('.maplibregl-popup-content')
        const close = popup.querySelector('button').getBoundingClientRect()
        const node = [...popup.childNodes].find(n => n.nodeName !== 'BUTTON')
        const range = document.createRange()
        range.selectNodeContents(node)
        const rects = [...range.getClientRects()]
        const box = popup.getBoundingClientRect()
        const overlap = rects.some(text => close.left < text.right && close.right > text.left && close.top < text.bottom && close.bottom > text.top)
        const clipped = rects.some(text => text.left < box.left || text.right > box.right + 1)
        const image = await require('electron').remote.getCurrentWindow().webContents.capturePage()
        require('fs').writeFileSync(${JSON.stringify(shots + '/phone-long-label.png')}, image.toPNG())
        return { overlap, clipped, lines: rects.length, text: node.textContent, overflow: popup.scrollWidth > popup.clientWidth }
      } finally { handle?.destroy(); root.remove() }
    })()`)
    expect(answer).not.toMatch(/^Error:/)
    const result = JSON.parse(answer)
    expect(result).toMatchObject({ overlap: false, clipped: false, overflow: false, text: label })
    expect(result.lines).toBeGreaterThan(1)
  }, 60000)

  it.each([false, true])(
    'opens a readable popup with mobile emulation %s',
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
      const probe = document.createElement('div')
      probe.className = 'maplibregl-map'
      root.appendChild(probe)
      const beforePosition = getComputedStyle(probe).position
      probe.remove()
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
          beforePosition, before, during: document.querySelectorAll('style[data-abele-map]').length,
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
        beforePosition: 'relative',
        before: 0,
        during: 0,
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
