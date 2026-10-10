import { describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { Map as MapLibre } from 'maplibre-gl'
const map = vi.hoisted(() => ({ remove: vi.fn(), on: vi.fn() }))
vi.mock('@/helpers/loadMaplibre', () => ({
  loadMaplibre: async () => ({
    Map: class {
      constructor() {
        return map
      }
    },
  }),
}))
import { renderMap } from '@/helpers/mapRender'

describe('maps in resizable render containers', () => {
  it('the pinned renderer owns a container resize observer, not only a window listener', () => {
    let callback!: ResizeObserverCallback
    const observe = vi.fn()
    const resize = vi.fn(),
      redraw = vi.fn()
    const el = document.createElement('div')
    const host = {
      _container: el,
      _trackResize: true,
      _removed: false,
      _shouldHandleInitialResize: () => true,
      _ownerWindow: {
        ResizeObserver: class {
          constructor(cb: ResizeObserverCallback) {
            callback = cb
          }
          observe = observe
        },
      },
      resize,
      redraw,
    }
    // Exercise the dependency's actual implementation, without starting a WebGL context.
    ;(
      MapLibre.prototype as unknown as { _setupResizeObserver(this: typeof host): void }
    )._setupResizeObserver.call(host)
    expect(observe).toHaveBeenCalledWith(el)
    callback([], {} as ResizeObserver)
    expect(resize).toHaveBeenCalledOnce()
    expect(redraw).toHaveBeenCalledOnce()
  })
  it('returns destruction of that same library-owned map to the render lifetime', async () => {
    useVault([])
    const handle = await renderMap(document.createElement('div'), {
      points: [],
      lines: [],
      height: 220,
      interactive: false,
    })
    handle.destroy()
    expect(map.remove).toHaveBeenCalledOnce()
  })
})
