import { evalJson, evalRaw, reloadApp } from './obsidianCli'

/** Run one probe in the phone layout, restoring only this vault's window afterwards. */
export async function withEmulatedPhone<T>(probe: () => Promise<T>): Promise<T> {
  const size = evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )
  try {
    await reloadApp('app.emulateMobile(true)')
    evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
    await reloadApp('window.location.reload()')
    return await probe()
  } finally {
    try {
      await reloadApp('app.emulateMobile(false)')
    } finally {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
    }
  }
}
