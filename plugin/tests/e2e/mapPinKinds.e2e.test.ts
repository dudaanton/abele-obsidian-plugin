import { afterAll, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const shots = shotDir('map-pin-kinds')
const original = evalJson<{ size: number[]; mobile: boolean; dark: boolean }>(`({
  size: require('electron').remote.getCurrentWindow().getSize(),
  mobile: document.body.classList.contains('is-mobile'),
  dark: document.body.classList.contains('theme-dark')
})`)

afterAll(async () => {
  evalRaw(`require('electron').remote.getCurrentWindow().setSize(${original.size.join(',')})`)
  await reloadApp(`app.emulateMobile(${original.mobile})`)
  evalRaw(
    `document.body.toggleClass('theme-dark', ${original.dark}); document.body.toggleClass('theme-light', ${!original.dark})`
  )
})

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'renders distinct pins, mobile=%s dark=%s',
  async (mobile, dark) => {
    evalRaw(
      `require('electron').remote.getCurrentWindow().setSize(${mobile ? '390,844' : '1000,800'})`
    )
    await reloadApp(`app.emulateMobile(${mobile})`)
    const result = await evalLong(`(async () => {
    document.body.toggleClass('theme-dark', ${dark})
    document.body.toggleClass('theme-light', ${!dark})
    const root = document.createElement('div')
    Object.assign(root.style, { position: 'fixed', left: '16px', right: '16px', top: '100px', height: '420px', zIndex: '1000' })
    document.body.appendChild(root)
    let handle
    try {
      const kinds = [{ icon: 'coffee' }, { icon: 'bed' }, { mark: 'A' }, { mark: 'B' }, { mark: '2' }, {}, { icon: 'trees', color: '#238b57' }, { icon: 'no-such-glyph' }]
      handle = await window.__abeleTest.renderMap(root, {
        points: kinds.map((kind, i) => ({ lat: 48.858 + Math.floor(i / 4) * .004, lon: 2.288 + (i % 4) * .004, ...kind })),
        lines: [], center: { lat: 48.86, lon: 2.294 }, zoom: 14, height: 420, interactive: true,
      })
      await new Promise(resolve => setTimeout(resolve, 3000))
      const pins = [...root.querySelectorAll('.abele-map__pin')]
      const badges = pins.filter(pin => pin.classList.contains('mod-badge'))
      const image = await require('electron').remote.getCurrentWindow().webContents.capturePage()
      require('fs').writeFileSync(${JSON.stringify(shots)} + '/${mobile ? 'phone' : 'desktop'}-${dark ? 'dark' : 'light'}.png', image.toPNG())
      return JSON.stringify({ pins: pins.length, badges: badges.length, glyphs: badges.filter(pin => pin.querySelector('svg')).length, widths: badges.map(pin => pin.getBoundingClientRect().width) })
    } finally { handle?.destroy(); root.remove() }
  })()`)
    expect(JSON.parse(result)).toEqual({
      pins: 8,
      badges: 6,
      glyphs: 3,
      widths: [24, 24, 24, 24, 24, 24],
    })
  },
  60000
)
