/**
 * Whether a GitHub tab's file tree panel starts open.
 *
 * Each tab keeps its own in its state. A new tab on a desktop opens it the way the last one was
 * left — the choice is this device's, kept in its local storage rather than in the settings,
 * because a panel that suits a wide screen suits no phone. On a phone the panel covers the code,
 * so it always starts closed there.
 */
export const PANEL_KEY = 'abele-github-tree-panel'

export function initialPanel(phone: boolean, stored: unknown): boolean {
  return !phone && stored === true
}

export function rememberPanel(
  app: { saveLocalStorage(key: string, value: unknown): void },
  open: boolean,
  phone: boolean
): void {
  if (!phone) app.saveLocalStorage(PANEL_KEY, open)
}
