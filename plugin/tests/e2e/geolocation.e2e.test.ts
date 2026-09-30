/** Real MapLibre controls, with invented provider answers only. No live position is logged. */
import { afterEach, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()

const mount = `(async () => {
  const root = document.createElement('div')
  root.className = 'abele-map'
  Object.assign(root.style, { position: 'fixed', width: 'auto', left: '12px', right: '12px', top: '90px', height: '320px', zIndex: '1000' })
  document.body.appendChild(root)
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
  const state = window.__locationE2E = { root, original, calls: 0, error: 0 }
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure) {
      state.calls++
      if (state.error) failure({ code: state.error, message: 'sample provider error' })
      else success({ coords: { latitude: 12.345, longitude: 67.89, accuracy: 240 }, timestamp: 1234567890000 })
    }
  } })
  state.handle = await window.__abeleTest.renderMap(root, {
    points: [], lines: [], center: { lat: 12, lon: 67 }, height: 320, interactive: true,
  })
  return true
})()`

const cleanup = `(() => {
  const state = window.__locationE2E
  if (!state) return 'ok'
  state.handle?.destroy()
  state.root.remove()
  if (state.original) Object.defineProperty(navigator, 'geolocation', state.original)
  else delete navigator.geolocation
  delete window.__locationE2E
  for (const notice of document.querySelectorAll('.notice')) {
    if (notice.textContent.startsWith('Location ')) notice.remove()
  }
  return 'ok'
})()`

describe.skipIf(!available)('device location on a real map', () => {
  afterEach(() => {
    evalRaw(cleanup)
  })

  it('requests only on press, centres on the answer and displays the dot and accuracy circle', async () => {
    expect(await evalLong(mount)).toBe('true')
    expect(evalJson<number>('window.__locationE2E.calls')).toBe(0)
    const result = JSON.parse(
      await evalLong(`(async () => {
      const state = window.__locationE2E
      const button = state.root.querySelector('button[aria-label="Show my location"]')
      if (!button) return { missing: true }
      button.click()
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && (button.disabled || !state.root.querySelector('.maplibregl-user-location-dot'))) await wait(100)
      const dot = state.root.querySelector('.maplibregl-user-location-dot')
      const circle = state.root.querySelector('.maplibregl-user-location-accuracy-circle')
      // A flight can take several seconds. Wait for the acquired point to reach the centre,
      // not just for a marker to exist at the old camera position.
      const centred = () => {
        const canvas = state.root.getBoundingClientRect(), d = dot?.getBoundingClientRect()
        return !!d && Math.abs((d.left + d.right - canvas.left - canvas.right) / 2) < 3 && Math.abs((d.top + d.bottom - canvas.top - canvas.bottom) / 2) < 3
      }
      while (Date.now() < deadline && !centred()) await wait(100)
      const canvas = state.root.getBoundingClientRect(), d = dot?.getBoundingClientRect()
      return {
        calls: state.calls, dot: !!dot, circle: !!circle, diameter: parseFloat(circle?.style.width || '0'),
        centred: !!d && Math.abs((d.left + d.right - canvas.left - canvas.right) / 2) < 3 && Math.abs((d.top + d.bottom - canvas.top - canvas.bottom) / 2) < 3,
        retry: !button.disabled,
        delta: d ? [(d.left + d.right - canvas.left - canvas.right) / 2, (d.top + d.bottom - canvas.top - canvas.bottom) / 2] : [],
      }
    })()`)
    )
    expect(result, JSON.stringify(result)).toMatchObject({
      calls: 1,
      dot: true,
      circle: true,
      centred: true,
      retry: true,
    })
    expect(result.diameter).toBeGreaterThan(0)
  }, 30_000)

  it.each([1, 2, 3])(
    'provider error %i becomes a Notice, not a fake location',
    async (code) => {
      expect(await evalLong(mount)).toBe('true')
      const result = JSON.parse(
        await evalLong(`(async () => {
      const state = window.__locationE2E
      state.error = ${code}
      const button = state.root.querySelector('button[aria-label="Show my location"]')
      button.click()
      await new Promise(resolve => setTimeout(resolve, 500))
      return { message: [...document.querySelectorAll('.notice')].map(n => n.textContent).find(t => t.startsWith('Location ')), dot: !!state.root.querySelector('.maplibregl-user-location-dot'), retry: !button.disabled }
    })()`)
      )
      expect(result.message).toMatch(
        [/permission.*settings/i, /unavailable.*Location Services/i, /timed out.*try again/i][
          code - 1
        ]
      )
      expect(result).toMatchObject({ dot: false, retry: true })
    },
    30_000
  )

  it('clicking the location dot or accuracy circle never starts a reverse lookup', async () => {
    expect(await evalLong(mount)).toBe('true')
    const result = JSON.parse(
      await evalLong(`(async () => {
      const state = window.__locationE2E
      // Obsidian's requestUrl export is read-only. Observe the actual MapLibre click entry
      // point instead: no event may reach the canvas where its lookup handler is attached.
      const canvas = state.root.querySelector('.maplibregl-canvas-container')
      let lookups = 0
      canvas.addEventListener('click', () => lookups++)
      state.root.querySelector('button[aria-label="Show my location"]').click()
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && !state.root.querySelector('.maplibregl-user-location-dot')) await wait(100)
      const dot = state.root.querySelector('.maplibregl-user-location-dot')
      const circle = state.root.querySelector('.maplibregl-user-location-accuracy-circle')
      if (!dot || !circle) return { missing: true }
      dot.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      circle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wait(1500)
      const popup = !!state.root.querySelector('.maplibregl-popup')
      const markerLookups = lookups
      // An intentional base-map click must still reach the handler and open place details.
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wait(1500)
      return { markerLookups, popup, baseLookups: lookups - markerLookups, basePopup: !!state.root.querySelector('.maplibregl-popup') }
    })()`)
    )
    expect(result).toEqual({ markerLookups: 0, popup: false, baseLookups: 1, basePopup: true })
  }, 30_000)

  it('the registered agent tool uses the same device provider and reports its platform', async () => {
    expect(await evalLong(mount)).toBe('true')
    const result = JSON.parse(
      await evalLong(`(async () => {
      const tool = window.__abeleTest.createAgentTools().find(t => t.name === 'current_location')
      const answer = JSON.parse((await tool.execute('sample-call', {})).content[0].text)
      return { correct: answer.latitude === 12.345 && answer.longitude === 67.89 && answer.accuracy === 240 && answer.timestamp === 1234567890000, device: answer.device }
    })()`)
    )
    expect(result.correct).toBe(true)
    expect(result.device).toMatch(/Obsidian on .+\(device running this chat\)/)
  }, 30_000)
})
