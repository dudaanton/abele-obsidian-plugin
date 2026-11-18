import { withNativeInput } from './nativeInput'

type Probe = <T>(body: string) => Promise<T>

/** Keep one debugger connection and the shared input lane until paint has been measured.
 * Await renderer CDP replies instead of starting a blocking CLI CDP request per event.
 */
export async function withScriptButtonInput<T>(probe: Probe, run: () => Promise<T>): Promise<T> {
  return withNativeInput(async () => {
    await probe(`
      const api = require('@electron/remote').getCurrentWebContents().debugger
      const owned = !api.isAttached()
      if (owned) api.attach('1.3')
      window.__abeleTest.scriptButtonInput = { owned, touching: false }
      return true
    `)
    try {
      return await run()
    } finally {
      await probe(`
        const api = require('@electron/remote').getCurrentWebContents().debugger
        const state = window.__abeleTest.scriptButtonInput
        try {
          try {
            if (state.touching)
              await api.sendCommand('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
          } finally {
            await api.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })
          }
        } finally {
          window.__abeleTest.scriptButtonInput = null
          if (state.owned && api.isAttached()) api.detach()
        }
        return true
      `)
    }
  })
}

export async function scriptButtonCommand(probe: Probe, method: string, params: object) {
  await probe(`
    const api = require('@electron/remote').getCurrentWebContents().debugger
    const state = window.__abeleTest.scriptButtonInput
    const method = ${JSON.stringify(method)}, params = ${JSON.stringify(params)}
    if (params.type === 'touchStart') state.touching = true
    await api.sendCommand(method, params)
    if (params.type === 'touchEnd' || params.type === 'touchCancel') state.touching = false
    return true
  `)
}
