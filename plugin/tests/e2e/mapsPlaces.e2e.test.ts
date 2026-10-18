/** Place cards and list mode use current Bases results without writing on read. */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, reloadApp, enterPhone } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

const folder = 'ScaleTest/MapCardsFixture'
const basePath = `${folder}/Places.base`
const shots = shotDir('maps-places')
let original: { size: number[]; mobile: boolean }
beforeAll(async () => {
  original = onPhone()
    ? { size: [], mobile: true }
    : evalJson(
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
    ]) await app.vault.create(${JSON.stringify(folder)} + '/' + name + '.md', '---\\ncoordinates: ' + coords + (name === 'Empty' ? '' : '\\nkind: Sample place') + '\\n---\\n' + text)
    return 'ready'
  })()`)
  expect(result).toBe('ready')
})
afterAll(async () => {
  await evalLong(`(async () => {
    for (const leaf of app.workspace.getLeavesOfType('bases')) if (leaf.view.file?.path === ${JSON.stringify(basePath)}) leaf.detach()
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(folder)})
    if (file) await app.vault.delete(file, true)
    if (!${onPhone()}) require('@electron/remote').getCurrentWindow().setSize(${original?.size.join(',') || '1000,800'})
    return 'clean'
  })()`)
  if (onPhone()) return
  await reloadApp(`app.emulateMobile(${original?.mobile ?? false})`)
  evalRaw(
    `require('@electron/remote').getCurrentWindow().setSize(${original?.size.join(',') ?? '1000,800'})`
  )
})
it.each(onPhone() ? [true] : [false, true])(
  'cards, gallery return, list selection and camera, mobile=%s',
  async (mobile) => {
    if (onPhone()) {
      /* The harness owns the real phone's geometry. */
    } else if (mobile) await enterPhone(390, 844)
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
      if (${mobile && !onPhone()} && (innerWidth !== 390 || innerHeight !== 844)) throw Error('Phone viewport changed: ' + innerWidth + 'x' + innerHeight)
      if (window.__e2eHost) {
        const saved = await window.__e2eHost.shot(${JSON.stringify(shots)} + '/phone-' + name + '.png')
        if (String(saved).startsWith('no picture:')) throw Error(saved)
        return
      }
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
      const fullControl = root.querySelector('[aria-label="Full screen"]')
      if (!!fullControl !== (typeof root.requestFullscreen === 'function')) throw Error('Fullscreen control does not match API availability')
      const fitControl = root.querySelector('[aria-label="Fit all places"]')
      if (!fitControl) throw Error('Fit-all control missing')
      if (fullControl && fullControl.querySelector('svg')?.getAttribute('class') === fitControl.querySelector('svg')?.getAttribute('class')) throw Error('Fit-all and fullscreen use the same icon')
      const before = await app.vault.adapter.read(${JSON.stringify(basePath)})
      map.jumpTo({ center: [20, 12], zoom: 1.5 })
      const cluster = await until(() => map.getLayer('abele-place-clusters') && map.queryRenderedFeatures({ layers: ['abele-place-clusters'] }).find(f => f.properties.point_count === 5), 'all places clustered')
      const clusterPoint = map.project(cluster.geometry.coordinates)
      const tap = { x: clusterPoint.x + 5, y: clusterPoint.y + 5 }
      map.fire('click', { point: tap, lngLat: map.unproject(tap), originalEvent: new MouseEvent('click', { clientX: tap.x, clientY: tap.y }) })
      const allFramed = () => component.props.places.every(p => {
        const point = map.project([p.lon, p.lat]); const box = map.getContainer()
        return point.x >= 40 && point.y >= 40 && point.x <= box.clientWidth - 40 && point.y <= box.clientHeight - 40
      })
      await until(() => !map.isMoving() && map.getZoom() > 3 && allFramed(), 'cluster tap framed its places')
      await until(() => map.getLayer('abele-place-symbols') && map.getLayer('abele-place-clusters') && map.queryRenderedFeatures({ layers: ['abele-place-symbols', 'abele-place-clusters'] }).length, 'marks after cluster tap')
      await shot('map-after-cluster')
      map.jumpTo({ center: [30, 20], zoom: 14 })
      root.querySelector('[aria-label="Fit all places"]').click()
      await until(() => !map.isMoving() && allFramed(), 'fit all places')
      root.querySelector('[aria-label="Background"]').click()
      await until(() => [...document.querySelectorAll('.menu-item-title')].some(el => el.textContent === 'Default'), 'built-in background choice')
      await shot('background-picker')
      const defaultChoice = [...document.querySelectorAll('.menu-item')].find(el => el.querySelector('.menu-item-title')?.textContent === 'Default')
      if (component.props.background !== 'default') throw Error('Default background is not current')
      defaultChoice.click()
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
        if (name === 'Empty') {
          if (card().querySelector('.abele-meta-line')) throw Error('Title-only card has a repeated subtitle')
          if (${mobile} && modalBox.height > innerHeight / 2) throw Error('Title-only card fills the phone screen')
        }
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
      const doc = root.ownerDocument
      const visible = el => {
        const box = el.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      }
      const previousInputs = new Set([...doc.querySelectorAll('input')].filter(visible))
      const tapSearchElement = async el => {
        if (!window.__e2eHost) return el.click()
        const box = el.getBoundingClientRect()
        if (!visible(el)) throw Error('Search control is not visible')
        await window.__e2eHost.tap(box.left + box.width / 2, box.top + box.height / 2)
      }
      // WebKit requires a native gesture to bring up its keyboard. A DOM click need not focus
      // the field, and a visible field is not necessarily document.activeElement on a phone.
      await tapSearchElement(search)
      const input = await until(() => [...doc.querySelectorAll('input')].find(el => visible(el) && !previousInputs.has(el)), 'search input')
      if (window.__e2eHost) {
        if (doc.activeElement !== input) await tapSearchElement(input)
        await shot('list-search-open')
        await window.__e2eHost.type('No matching sample')
      } else {
        await shot('list-search-open')
        input.value = 'No matching sample'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await until(() => !component.props.places.length && !root.querySelector('.abele-map-base__pin.is-selected'), 'filtered selection cleared')
      await shot('list-empty-search')
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => component.props.places.length === 5, 'cleared search')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (window.__e2eHost) input.blur()
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
