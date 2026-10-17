/** Native Bases map integration, unchanged source reads, live formulas and visible screenshots. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const shots = shotDir('maps-base')
const folder = 'ScaleTest/MapPlacesFixture'
const basePath = `${folder}/Places.base`
const base = (extra = '') =>
  `filters:\n  and:\n    - file.inFolder("${folder}/Notes")\nformulas:\n  position: coordinates\nviews:\n  - type: abele-map\n    name: Places\n    coordinates: formula.position\n    markerIcon: note.icon\n    markerColor: note.color\n    order:\n      - file.name\n      - note.description\n    ${extra}\n`
const prelude = `
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, label) => {
    const end = Date.now() + 30000
    while (Date.now() < end) { const result = fn(); if (result) return result; await wait(100) }
    throw Error('Timed out: ' + (typeof label === 'function' ? label() : label))
  }
  const open = async () => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(basePath)}))
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const root = await until(() => leaf.view.containerEl.querySelector('.abele-map-base'), 'map root')
    const api = root.__vueParentComponent.exposed
    const map = await until(() => api.map && ('value' in api.map ? api.map.value : api.map), 'MapLibre')
    await until(() => map.getSource('abele-places'), 'places source')
    return { leaf, root, api, map }
  }
  const picture = async (name, doc = document) => {
    await wait(500)
    const fs = require('fs')
    fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })
    const remote = require('@electron/remote')
    const contents = doc === document ? remote.getCurrentWebContents() : remote.BrowserWindow.getAllWindows().find(win => win.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - ')).webContents
    const image = await contents.capturePage()
    fs.writeFileSync(${JSON.stringify(shots)} + '/' + name + '.png', image.toPNG())
  }
`

describe('Abele maps alongside native Maps', () => {
  let original: { size: number[]; mobile: boolean }
  beforeAll(async () => {
    original = evalJson(
      `({ size: require('@electron/remote').getCurrentWindow().getSize(), mobile: document.body.classList.contains('is-mobile') })`
    )
    const answer = await evalLong(`(async () => {
      await app.vault.adapter.mkdir(${JSON.stringify(`${folder}/Notes`)})
      await app.vault.create(${JSON.stringify(basePath)}, ${JSON.stringify(base())})
      const data = [
        ['Sample grove', '12, 20', 'trees', '#338855'],
        ['Sample lookout', '12, 20', 'mountain', '#885533'],
        ['Sample river with a very long descriptive name', '13, 21', 'waves', '#335588'],
        ['Invalid place', 'not coordinates', '', ''],
      ]
      for (const [name, coordinates, icon, color] of data) await app.vault.create(
        ${JSON.stringify(`${folder}/Notes/`)} + name + '.md',
        '---\\ncoordinates: ' + JSON.stringify(coordinates) + '\\nicon: ' + JSON.stringify(icon) + '\\ncolor: ' + JSON.stringify(color) + '\\ndescription: A long sample description for the hover properties popup.\\n---\\n')
      return 'ready'
    })()`)
    expect(answer).toBe('ready')
  })
  afterAll(async () => {
    await evalLong(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('bases')) if (leaf.view.file?.path === ${JSON.stringify(basePath)}) leaf.detach()
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(folder)})
      if (file) await app.vault.delete(file, true)
      require('@electron/remote').getCurrentWindow().setSize(${original?.size?.join(',') ?? '1000,800'})
      return 'clean'
    })()`)
    await reloadApp(`app.emulateMobile(${original?.mobile ?? false})`)
  })

  it.each([false, true])(
    'draws native rows and states, mobile=%s',
    async (mobile) => {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setSize(${mobile ? '390,844' : '1100,850'})`
      )
      await reloadApp(`app.emulateMobile(${mobile})`)
      const result = await evalLong(`(async () => {
      ${prelude}
      const before = await app.vault.adapter.read(${JSON.stringify(basePath)})
      const { leaf, root, api, map } = await open()
      try {
        await until(() => root.__vueParentComponent.props.places.length === 3, 'evaluated formula rows')
        await until(() => map.queryRenderedFeatures({ layers: ['abele-place-symbols', 'abele-place-clusters'] }).length > 0, 'visible place symbols')
        await until(() => map.queryRenderedFeatures({ layers: ['abele-place-clusters'] }).some(feature => feature.properties.point_count === 2), () => JSON.stringify({ clusterImage: map.hasImage('abele-cluster-2'), clusterPosition: map.project([20, 12]), size: [root.clientWidth, root.clientHeight], source: map.querySourceFeatures('abele-places').map(feature => feature.properties) }))
        const props = root.__vueParentComponent.props
        const points = props.places.map(p => [p.lat, p.lon])
        const skipped = props.skipped.length
        const grouping = props.group
        const layers = map.getStyle().layers.filter(l => l.id.startsWith('abele-place-')).length
        const holder = leaf.view.containerEl.closest('.workspace-leaf') ?? leaf.view.containerEl
        const toolbar = holder.querySelector('.bases-toolbar') ?? holder
        const icon = toolbar.querySelector('svg.lucide-search, [data-icon="search"]')
        const search = [...toolbar.querySelectorAll('[aria-label]')].find(el => String(el.getAttribute('aria-label')).toLowerCase().startsWith('search')) ?? icon?.closest('.clickable-icon, .bases-toolbar-item, [role="button"]') ?? icon?.parentElement
        if (!search) throw Error('Native Bases search button is missing: ' + [...leaf.view.containerEl.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label')).join(' | '))
        search.click()
        const input = await until(() => {
          const el = root.ownerDocument.activeElement
          return el?.tagName === 'INPUT' && el
        }, 'native Bases search input')
        input.value = 'river'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await until(() => props.places.length === 1 && props.places[0].title.includes('river'), 'native search results')
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await until(() => props.places.length === 3 && props.skipped.length === 1, 'cleared native search')
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
        const backgroundSignature = () => JSON.stringify(map.getStyle()?.layers.filter(layer => !layer.id.startsWith('abele-place-')))
        await until(() => map.getLayer('background') && map.isStyleLoaded(), 'loaded initial background')
        const originalTheme = [document.body.classList.contains('theme-dark'), document.body.classList.contains('theme-light')]
        const originalStyle = props.styleUrl
        const originalBackground = backgroundSignature()
        try {
          const targetDark = !originalTheme[0]
          document.body.classList.toggle('theme-dark', targetDark)
          document.body.classList.toggle('theme-light', !targetDark)
          app.workspace.trigger('css-change')
          await until(() => props.styleUrl.endsWith(targetDark ? '/dark' : '/bright') && backgroundSignature() !== originalBackground && map.getLayer('abele-place-clusters') && map.queryRenderedFeatures({ layers: ['abele-place-clusters'] }).some(feature => feature.properties.point_count === 2), 'switched background and restored cluster')
          await picture(${JSON.stringify(mobile ? 'phone-dark' : 'desktop-dark')})
        } finally {
          document.body.classList.toggle('theme-dark', originalTheme[0])
          document.body.classList.toggle('theme-light', originalTheme[1])
          app.workspace.trigger('css-change')
        }
        await until(() => props.styleUrl === originalStyle && backgroundSignature() === originalBackground && map.getLayer('abele-place-clusters') && map.queryRenderedFeatures({ layers: ['abele-place-clusters'] }).some(feature => feature.properties.point_count === 2), 'restored theme')
        await picture(${JSON.stringify(mobile ? 'phone-populated-long' : 'desktop-populated-long')})
        root.querySelector('.abele-map-base__skipped').click()
        await picture(${JSON.stringify(mobile ? 'phone-skipped' : 'desktop-skipped')})
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        let hoverClipped = false
        if (!${mobile}) {
          api.hoverPlace(props.places[2].id)
          await until(() => root.querySelector('.maplibregl-popup'), 'hover popup')
          await picture('desktop-hover-long')
          const popupBox = root.querySelector('.maplibregl-popup-content').getBoundingClientRect()
          const mapBox = root.getBoundingClientRect()
          hoverClipped = popupBox.left < mapBox.left - 1 || popupBox.right > mapBox.right + 1 || popupBox.top < mapBox.top - 1 || popupBox.bottom > mapBox.bottom + 1
        }
        map.jumpTo({ center: [0, 0], zoom: 0 })
        const camera = [Number(map.getCenter().lat.toFixed(9)), Number(map.getCenter().lng.toFixed(9)), map.getZoom()]
        map.resize()
        const afterResize = [Number(map.getCenter().lat.toFixed(9)), Number(map.getCenter().lng.toFixed(9)), map.getZoom()]
        const noDomMarkers = root.querySelectorAll('.abele-map-base__pin').length === 0
        const noteCount = app.vault.getMarkdownFiles().length
        root.__vueParentComponent.emit('create', 12, 20)
        const formula = await until(() => document.querySelector('.abele-map-formula__why'), 'formula creation dialog')
        await picture(${JSON.stringify(mobile ? 'phone-formula-create' : 'desktop-formula-create')})
        formula.closest('.modal').querySelector('.modal-button-container button').click()
        await until(() => !document.querySelector('.abele-map-formula__why'), 'cancelled formula creation')
        const cancelledCreation = app.vault.getMarkdownFiles().length === noteCount
        const file = app.vault.getFileByPath(${JSON.stringify(`${folder}/Notes/Sample grove.md`)})
        const old = await app.vault.read(file)
        await app.vault.modify(file, old.replace('12, 20', '14, 22'))
        await until(() => props.places.some(p => p.lat === 14 && p.lon === 22), 'live formula update')
        await app.vault.modify(file, old)
        const unchanged = before === await app.vault.adapter.read(${JSON.stringify(basePath)})
        const box = root.getBoundingClientRect()
        return JSON.stringify({ points, skipped, grouping, layers, camera, afterResize, noDomMarkers, cancelledCreation, hoverClipped, unchanged, overflow: box.right > innerWidth + 1 })
      } finally { leaf.detach() }
    })()`)
      expect(result).not.toMatch(/^Error:/)
      expect(JSON.parse(result)).toMatchObject({
        points: expect.arrayContaining([
          [12, 20],
          [13, 21],
        ]),
        skipped: 1,
        grouping: true,
        layers: 2,
        camera: [0, 0, 0],
        afterResize: [0, 0, 0],
        noDomMarkers: true,
        cancelledCreation: true,
        hoverClipped: false,
        unchanged: true,
        overflow: false,
      })
    },
    120000
  )

  it('shows missing, empty and failed states on desktop and phone', async () => {
    for (const mobile of [false, true]) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setSize(${mobile ? '390,844' : '1100,850'})`
      )
      await reloadApp(`app.emulateMobile(${mobile})`)
      const result = await evalLong(`(async () => {
        ${prelude}
        const { leaf, root } = await open()
        try {
          const instance = root.__vueParentComponent
          const states = ['no-property', 'no-records', 'filtered', 'no-coordinates', 'offline', 'no-webgl', 'lost-context']
          for (const state of states) {
            instance.emit('failure', state)
            await until(() => root.querySelector('.abele-map-base__notice'), state)
            await picture((${JSON.stringify(mobile ? 'phone-' : 'desktop-')}) + state)
          }
          return JSON.stringify({ states: states.length })
        } finally { leaf.detach() }
      })()`)
      expect(JSON.parse(result)).toEqual({ states: 7 })
    }
  }, 180000)

  it.each([false, true])(
    'shows the real background editor states, mobile=%s',
    async (mobile) => {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setSize(${mobile ? '390,844' : '1100,850'})`
      )
      await reloadApp(`app.emulateMobile(${mobile})`)
      const answer = await evalLong(`(async () => {
      ${prelude}
      const { leaf, root } = await open()
      try {
        root.__vueParentComponent.emit('manageBackgrounds')
        const settingsDoc = await until(() => app.setting.activeTab?.containerEl.ownerDocument, 'settings window')
        const add = await until(() => settingsDoc.querySelector('.abele-map-bg-add button'), 'background settings')
        add.click()
        const editor = await until(() => settingsDoc.querySelector('.abele-map-bg-editor'), 'background editor')
        const modal = editor.closest('.modal')
        await picture(${JSON.stringify(mobile ? 'phone-background-empty' : 'desktop-background-empty')}, settingsDoc)
        const buttons = [...modal.querySelectorAll('.modal-button-container button')]
        buttons.at(-1).click()
        await until(() => editor.querySelector('.abele-map-bg-editor__error'), 'background validation')
        await picture(${JSON.stringify(mobile ? 'phone-background-error' : 'desktop-background-error')}, settingsDoc)
        const name = editor.querySelector('input')
        name.value = 'Sample background with a long descriptive name for narrow layouts'
        name.dispatchEvent(new settingsDoc.defaultView.Event('input', { bubbles: true }))
        const url = editor.querySelector('textarea')
        url.value = 'https://example.test/very-long-sample-layer-name/{z}/{x}/{y}.png'
        url.dispatchEvent(new settingsDoc.defaultView.Event('input', { bubbles: true }))
        await picture(${JSON.stringify(mobile ? 'phone-background-long' : 'desktop-background-long')}, settingsDoc)
        const box = modal.getBoundingClientRect()
        const overflow = box.right > settingsDoc.defaultView.innerWidth + 1 || modal.scrollWidth > modal.clientWidth + 1
        buttons[0].click()
        await until(() => !settingsDoc.querySelector('.abele-map-bg-editor'), 'cancel background editing')
        return JSON.stringify({ overflow })
      } finally { app.setting.close(); leaf.detach() }
    })()`)
      expect(answer).not.toMatch(/^Error:/)
      expect(JSON.parse(answer)).toEqual({ overflow: false })
    },
    120000
  )
})
