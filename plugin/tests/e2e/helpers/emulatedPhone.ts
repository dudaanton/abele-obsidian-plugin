import { enterPhone, evalJson, evalRaw, reloadApp } from './obsidianCli'

/** Run one probe in the phone layout, restoring only this vault's window afterwards. */
export async function withEmulatedPhone<T>(probe: () => Promise<T>): Promise<T> {
  const size = evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`
  )
  try {
    await enterPhone(390, 844)
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
