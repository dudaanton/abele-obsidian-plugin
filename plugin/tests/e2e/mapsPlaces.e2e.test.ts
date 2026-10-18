/** Place cards and list mode use current Bases results without writing on read. */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp, enterPhone } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const folder = 'ScaleTest/MapCardsFixture'
const basePath = `${folder}/Places.base`
const shots = shotDir('maps-places')
let original: { size: number[]; mobile: boolean }
beforeAll(async () => {
  original = evalJson(
    `({ size: require('@electron/remote').getCurrentWindow().getSize(), mobile: document.body.classList.contains('is-mobile') })`
  )
  const result = await evalLong(`(async () => {
    await app.vault.adapter.mkdir(${JSON.stringify(folder)})
    await app.vault.create(${JSON.stringify(`${folder}/sample.svg`)}, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#d5e7ef"/><circle cx="490" cy="85" r="40" fill="#f4d477"/><path d="M0 350 180 100 370 350 490 190 640 350V400H0Z" fill="#668d76"/></svg>')
    await app.vault.create(${JSON.stringify(basePath)}, 'filters:\\n  and:\\n    - file.inFolder("${folder}")\\n    - file.ext == "md"\\nviews:\\n  - type: abele-map\\n    name: Places\\n    coordinates: note.coordinates\\n    order:\\n      - note.kind\\n')
    for (const [name, text, coords] of [
      ['Empty', '', '12, 20'],
      ['One', '::abele-gallery::\\n![[sample.svg|Sample picture]]', '12, 20'],
      ['Many', '::abele-gallery::\\n![[missing.png]]\\n![[sample.svg|First picture]]\\n![[sample.svg|Second picture]]', '12, 20'],
      ['Sample place with a long descriptive name and sampleidentifier012345678901234567890123456789', 'Another sample place.', '14, 22'],
      ['Long', '# Long sample note\\n\\n~~~js\\nconst sample = 1\\n~~~\\n\\n' + 'A long paragraph with sample content. '.repeat(400), '13, 21'],
    ]) await app.vault.create(${JSON.stringify(folder)} + '/' + name + '.md', '---\\ncoordinates: ' + coords + '\\nkind: Sample place\\n---\\n' + text)
    return 'ready'
  })()`)
  expect(result).toBe('ready')
})
afterAll(async () => {
  await evalLong(`(async () => {
    for (const leaf of app.workspace.getLeavesOfType('bases')) if (leaf.view.file?.path === ${JSON.stringify(basePath)}) leaf.detach()
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(folder)})
    if (file) await app.vault.delete(file, true)
    require('@electron/remote').getCurrentWindow().setSize(${original?.size.join(',') ?? '1000,800'})
    return 'clean'
  })()`)
  await reloadApp(`app.emulateMobile(${original?.mobile ?? false})`)
  evalRaw(
    `require('@electron/remote').getCurrentWindow().setSize(${original?.size.join(',') ?? '1000,800'})`
  )
})
it.each([false, true])(
  'cards, gallery return, list selection and camera, mobile=%s',
  async (mobile) => {
    if (mobile) await enterPhone(390, 844)
    else {
      await reloadApp('app.emulateMobile(false)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(1100,850)`)
    }
    const answer = await evalLong(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const until = async (fn, label) => {
      const end = Date.now() + 30000
      while (Date.now() < end) { const value = fn(); if (value) return value; await wait(100) }
      throw Error('Timed out: ' + (typeof label === 'function' ? label() : label))
    }
    const shot = async name => {
      await wait(350)
      if (${mobile} && (innerWidth !== 390 || innerHeight !== 844)) throw Error('Phone viewport changed: ' + innerWidth + 'x' + innerHeight)
      const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true })
      fs.writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(mobile ? 'phone-' : 'desktop-')} + name + '.png', (await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG())
    }
    const locationNavigator = document.defaultView.navigator
    const geo = Object.getOwnPropertyDescriptor(locationNavigator, 'geolocation')
    let requests = 0
    let providerError = ''
    let stopped = false
    Object.defineProperty(locationNavigator, 'geolocation', { configurable: true, value: {
      watchPosition(success) { requests++; setTimeout(() => { try { success({ coords: { latitude: 13, longitude: 21 } }) } catch (error) { providerError = String(error?.stack ?? error) } }, 0); return 7 },
      clearWatch() { stopped = true },
    } })
    const leaf = app.workspace.getLeaf('tab')
    try {
    await leaf.openFile(app.vault.getFileByPath(${JSON.stringify(basePath)}))
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const root = await until(() => leaf.view.containerEl.querySelector('.abele-map-base'), 'map')
    const component = root.__vueParentComponent
    const api = component.exposed
    const map = await until(() => api.map && ('value' in api.map ? api.map.value : api.map), 'map api')
    const place = name => component.props.places.find(p => p.title === name)
    const card = () => document.querySelector('.abele-map-card-modal .abele-map-card')
    const closeCard = async () => { const close = await until(() => card()?.closest('.modal')?.querySelector('.modal-header-button, .modal-close-button'), 'card close action'); close.click(); await until(() => !card(), 'closed card') }
      await until(() => component.props.places.length === 5, 'five places')
      const before = await app.vault.adapter.read(${JSON.stringify(basePath)})
      const camera = [map.getCenter().lng, map.getCenter().lat, map.getZoom()]
      for (const name of ['Empty', 'One', 'Many', 'Long']) {
        api.openCard(place(name))
        await until(() => card() && !card().textContent.includes('Loading'), 'loaded ' + name)
        if (name === 'Long') await until(() => card().querySelector('pre code')?.textContent.includes('const sample'), 'rendered note code block')
        if (name === 'Many') {
          if (card().querySelectorAll('.abele-map-card__photo').length !== 3) throw Error('gallery picture count')
          if (!card().querySelector('.abele-map-card__photo-missing')) throw Error('missing thumbnail')
          card().querySelector('img').click()
          await until(() => document.querySelector('.abele-gallery-viewer'), 'gallery viewer')
          await shot('gallery')
          document.querySelector('.abele-gallery-viewer').closest('.modal').querySelector('.modal-header-button, .modal-close-button').click()
          await until(() => !document.querySelector('.abele-gallery-viewer') && card(), 'returned to same card')
          if (!card().textContent.includes('Many')) throw Error('lost card')
        }
        await shot('card-' + name.toLowerCase())
        const modal = card().closest('.modal')
        if (modal.scrollWidth > modal.clientWidth + 1) throw Error('card overflow')
        const openAction = modal.querySelector('.abele-map-card__foot button')
        const actionBox = openAction?.getBoundingClientRect()
        const modalBox = modal.getBoundingClientRect()
        if (!actionBox || actionBox.top < modalBox.top || actionBox.bottom > modalBox.bottom + 1) throw Error('Open action scrolled out of the card')
        if (${mobile} && !modal.classList.contains('mod-lg')) throw Error('phone card is not native tall sheet')
        await closeCard()
      }
      api.showList()
      await until(() => root.querySelector('.abele-map-list'), 'list')
      if (!${mobile} && root.querySelector('.abele-map-base__stage').getBoundingClientRect().width < 80) throw Error('list hid map in a narrow pane')
      await until(() => root.textContent.includes('Straight-line distance from the map centre'), 'visible straight-line distance origin')
      api.pickFromList(place('One'))
      if (${mobile}) await closeCard()
      const selected = await until(() => root.querySelector('[data-place="' + place('One').id + '"] [aria-selected="true"]'), 'selected list row')
      if (!selected) throw Error('list selection')
      await until(() => root.querySelector('.abele-map-base__pin.is-selected'), 'selected point outside group')
      const order = () => [...root.querySelectorAll('.abele-map-list__row')].map(el => el.dataset.place).join('|')
      const previousOrder = order()
      map.jumpTo({ center: [21, 13], zoom: 8 })
      await until(() => root.querySelector('.abele-map-list__resort'), 'refresh after map movement')
      if (order() !== previousOrder) throw Error('map movement reordered list')
      await shot('list-stale-selected')
      api.resort()
      await until(() => !root.querySelector('.abele-map-list__resort'), 'refreshed order')
      await shot('list-refreshed')
      if (!${mobile}) for (const title of root.querySelectorAll('.abele-map-list__title')) {
        const range = document.createRange(); range.selectNodeContents(title)
        if (title.textContent.length < 8 && range.getClientRects().length > 1) throw Error('A short place name wraps in the narrow list')
        if (title.scrollWidth > title.clientWidth + 1) throw Error('A long place name overflows the narrow list')
      }
      api.sortBy('base')
      await wait(100)
      await shot('list-base-order')
        if (requests) throw Error('Location requested before an explicit action')
        const locateButton = root.querySelector('[aria-label="Show my location"]')
        locateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await until(() => requests, 'location watch request')
        await until(() => providerError || root.querySelector('.abele-map-base__me'), 'sample position')
        if (providerError) throw Error('Sample position callback: ' + providerError)
        api.sortBy('me')
        await until(() => root.querySelector('.abele-map-list__row')?.dataset.place === place('Long').id, 'nearest to sample position')
        if (!root.textContent.includes('Straight-line distance from your location')) throw Error('Location distance origin is not labelled')
        await shot('list-near-me')
        root.querySelector('.abele-map-controls .is-active').click()
        if (!stopped) throw Error('location watch was not released')
        await until(() => !map.isMoving(), 'finished location camera move')
      api.sortBy('base')
      const holder = leaf.view.containerEl.closest('.workspace-leaf') ?? leaf.view.containerEl
      const toolbar = holder.querySelector('.bases-toolbar') ?? holder
      const searchIcon = toolbar.querySelector('svg.lucide-search, [data-icon="search"]')
      const search = [...toolbar.querySelectorAll('[aria-label]')].find(el => String(el.getAttribute('aria-label')).toLowerCase().startsWith('search')) ?? searchIcon?.closest('.clickable-icon, .bases-toolbar-item, [role="button"]') ?? searchIcon?.parentElement
      if (!search) throw Error('native search missing')
      search.click()
      const input = await until(() => document.activeElement?.tagName === 'INPUT' && document.activeElement, 'search input')
      input.value = 'No matching sample'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => !component.props.places.length && !root.querySelector('.abele-map-base__pin.is-selected'), 'filtered selection cleared')
      await shot('list-empty-search')
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => component.props.places.length === 5, 'cleared search')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      api.select(place('One').id)
      const kept = [map.getCenter().lng, map.getCenter().lat, map.getZoom()]
      api.hideList()
      await until(() => !root.querySelector('.abele-map-list'), 'map face')
      if (JSON.stringify(kept) !== JSON.stringify([map.getCenter().lng, map.getCenter().lat, map.getZoom()])) throw Error('toggle moved camera')
      map.jumpTo({ center: [place('One').lon, place('One').lat], zoom: 15 })
      await until(() => map.queryRenderedFeatures({ layers: ['abele-place-clusters'] }).some(feature => feature.properties.point_count === 2), 'remaining coincident group')
      const selectedMarker = root.querySelector('.abele-map-base__pin.is-selected').getBoundingClientRect()
      const mapBox = map.getContainer().getBoundingClientRect()
      const spot = map.project([place('One').lon, place('One').lat])
      if (Math.hypot((selectedMarker.left + selectedMarker.right) / 2 - mapBox.left - spot.x, (selectedMarker.top + selectedMarker.bottom) / 2 - mapBox.top - spot.y) < 40) throw Error('Selected place covers its remaining group')
      await shot('map-selected')
      if (!${mobile}) {
        api.hoverPlace(place('One').id)
        await until(() => root.querySelector('.maplibregl-popup'), 'selected hover popup')
        const hover = root.querySelector('.maplibregl-popup-content').getBoundingClientRect()
        if (hover.left < mapBox.left - 1 || hover.right > mapBox.right + 1 || hover.top < mapBox.top - 1 || hover.bottom > mapBox.bottom + 1) throw Error('Selected hover is clipped')
        await shot('selected-hover')
      }
      const getFile = app.vault.getFileByPath
      const errorPath = 'ScaleTest/MapCardsFixture/Unreadable.md'
      const indexedFile = { path: errorPath }
      try {
        // Simulate a stale index entry whose file cannot be read from disk.
        app.vault.getFileByPath = path => path === errorPath ? indexedFile : getFile.call(app.vault, path)
        api.openCard({ ...place('Empty'), id: 'unreadable', path: errorPath })
        await until(() => card()?.textContent.includes('could not be read'), 'read failure')
        await shot('card-error')
        await closeCard()
      } finally { app.vault.getFileByPath = getFile }
      // Keep a stale marker record: the card must explain a note removed since rendering.
      api.openCard({ ...place('Empty'), id: 'removed', path: 'ScaleTest/MapCardsFixture/Removed.md' })
      await until(() => card()?.textContent.includes('This note is gone'), 'deleted note')
      await shot('card-deleted')
      await closeCard()
      if (before !== await app.vault.adapter.read(${JSON.stringify(basePath)})) throw Error('view wrote configuration')
      return JSON.stringify({ passed: true, initialCamera: camera })
    } finally {
      leaf.detach()
      if (geo) Object.defineProperty(locationNavigator, 'geolocation', geo)
      else delete locationNavigator.geolocation
    }
  })()`)
    expect(answer).not.toMatch(/^Error:/)
    expect(JSON.parse(answer)).toMatchObject({ passed: true })
  },
  180000
)
