// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { probePrelude } from '../e2e/helpers/layoutProbe'

describe('layout probe screenshots', () => {
  it.each([false, true])('captures the measured document (settings popout: %s)', async (popout) => {
    const image = (source: string) => ({ toPNG: () => source })
    const main = { webContents: { capturePage: vi.fn(async () => image('main')) } }
    const settings = { webContents: { capturePage: vi.fn(async () => image('settings')) } }
    const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
    const req = (id: string) => (id === 'fs' ? fs : { getCurrentWindow: () => main })
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1200, innerHeight: 900, require: req },
    }
    const settingsDoc = {
      querySelectorAll: () => [],
      defaultView: {
        innerWidth: 900,
        innerHeight: 800,
        require: () => ({ getCurrentWindow: () => settings }),
      },
    }
    const root = {
      ownerDocument: popout ? settingsDoc : doc,
      children: [],
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ right: 800, bottom: 700, height: 600 }),
    }
    const run = new Function(
      'require',
      'document',
      'window',
      'setTimeout',
      'root',
      probePrelude('/sample-shots') + '\nreturn screen("sample", root, root)'
    )
    const result = await run(req, doc, doc.defaultView, (fn: () => void) => fn(), root)
    expect(result.error).toBe('')
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/sample-shots/sample.png',
      popout ? 'settings' : 'main'
    )
    expect(main.webContents.capturePage).toHaveBeenCalledTimes(popout ? 0 : 1)
    expect(settings.webContents.capturePage).toHaveBeenCalledTimes(popout ? 1 : 0)
  })
})
