/**
 * What the reader's page code takes from `obsidian`, for the iOS lab page, which runs outside
 * the app: a phone's platform flags, and notices shown as a line at the top of the page.
 */
export const Platform = { isMobile: true, isPhone: true, isIosApp: true, isSafari: true }

export class Notice {
  constructor(message: string) {
    const el = document.createElement('div')
    el.className = 'notice'
    el.textContent = message
    document.body.append(el)
    setTimeout(() => el.remove(), 4000)
    ;(window as unknown as { lab: { log(e: unknown): void } }).lab?.log({ notice: message })
  }
}
