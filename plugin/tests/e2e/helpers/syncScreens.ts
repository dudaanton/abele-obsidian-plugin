/**
 * The phase-3b sync screens, as bodies for a layout probe: each opens one screen the way a
 * person reaches it, measures it with the probe's `screen()`, and puts things back. Every body
 * runs inside the app after `probePrelude` and `SYNC_PRELUDE`, and returns an object of `Screen`s
 * by label — the shape `syncPhone.e2e.test.ts` collects.
 *
 * What a screen is asked beyond the probe's own questions goes into its `extra`:
 * - `buttons` / `buttonsInView` / `onTop` — a dialog's buttons are all on the screen, and a
 *   confirmation stacked over a sheet is what a finger at its buttons lands on;
 * - `rowReach` — a settings row (the restore-since row) scrolls nothing sideways;
 * - `voids` — no half of a settings row holds more room than its contents, the phone's stacked
 *   rows' old failure (`settingsLayout.e2e.test.ts` asks the same of the other tabs).
 *
 * No backticks anywhere in the bodies: they are spliced into template literals.
 */

/** Whether a dialog's buttons are on the screen, and on top of whatever lies under them. */
const BUTTON_FACTS = `
  const buttonFacts = (modal, selector) => {
    const view = modal.ownerDocument.defaultView
    const inView = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= view.innerWidth + 1 && r.bottom <= view.innerHeight + 1
    }
    const buttons = [...modal.querySelectorAll(selector || 'button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.classList.contains('modal-close-button'))
    const onTop = buttons.every((b) => {
      const r = b.getBoundingClientRect()
      const hit = modal.ownerDocument.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
      return !!hit && b.contains(hit)
    })
    return { buttons: buttons.length, buttonsInView: buttons.filter(inView).length, onTop }
  }
`

/** Halves of settings rows holding more room than their contents: see the file's comment. */
const VOIDS = `
  const voidsIn = (root) => {
    const voids = []
    for (const row of root.querySelectorAll('.abele-obsidian-setting')) {
      for (const half of ['.setting-item-info', '.setting-item-control']) {
        const el = row.querySelector(half)
        if (!el || !el.children.length) continue
        const rects = [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0)
        const height = el.getBoundingClientRect().height
        if (!height || !rects.length) continue
        const held = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
        if (height - held > 4) voids.push(textOf(row.querySelector('.setting-item-name')).slice(0, 28) + ' ' + half + ' +' + Math.round(height - held))
      }
    }
    return voids
  }
`

/** The held-deletes dialog, asked again for what is held; then its confirmation over it. */
export const heldScreens = (suffix: string): string => `
  ${BUTTON_FACTS}
  await closeDialog()
  // A phone reload can surface the staged-settings question at the same moment as this
  // manually opened hold. Leave it for the next screen instead of layering it over the hold.
  svc.settingsPrompt.later()
  svc.codePrompt.later()
  await closeDialog()
  svc.heldPrompt.ask()
  if (!(await until(() => modalOf('.abele-held-deletes'), 10000))) throw new Error('the held-deletes dialog never opened')
  await wait(300)
  const modal = modalOf('.abele-held-deletes')
  const out = {}
  const label = 'held deletes' + ${JSON.stringify(suffix)}
  out[label] = await screen(label, modal, modal.querySelector('.abele-modal__body'))
  const actions = modal.querySelector('.abele-held-deletes__actions').getBoundingClientRect()
  const sheet = modal.getBoundingClientRect()
  const below = actions.bottom + (sheet.bottom - actions.bottom) / 2
  const visibleBelowActions = sheet.bottom - actions.bottom > 12 &&
    !!modal.ownerDocument.elementFromPoint(actions.left + actions.width / 2, below)?.closest('.abele-held-deletes__paths')
  out[label].extra = { ...buttonFacts(modal), more: textOf(modal.querySelector('.abele-held-deletes__more')), visibleBelowActions }
  await press(modal, 'Delete everywhere')
  if (!(await until(() => modalOf('.abele-confirm__message'), 5000))) throw new Error('no confirmation')
  await wait(300)
  const confirm = modalOf('.abele-confirm__message')
  const confirmLabel = 'held deletes confirm' + ${JSON.stringify(suffix)}
  out[confirmLabel] = await screen(confirmLabel, confirm, confirm)
  out[confirmLabel].extra = buttonFacts(confirm, '.abele-modal__footer button')
  await press(confirm, 'Cancel')
  await wait(300)
  out[confirmLabel].extra.sheetStays = !!modalOf('.abele-held-deletes') && !modalOf('.abele-confirm__message')
  await closeDialog()
  return out
`

/** "Settings changed on another device", asked again about what is staged. */
export const stagedScreen = (suffix: string): string => `
  ${BUTTON_FACTS}
  await closeDialog()
  const prompt = svc.settingsPrompt
  if (!prompt.staged.value.length) await prompt.refresh()
  if (!prompt.staged.value.length) throw new Error('nothing is staged to ask about')
  prompt.asking.value = { key: Date.now(), changes: [...prompt.staged.value], names: { ...prompt.names.value } }
  if (!(await until(() => modalOf('.abele-staged-settings'), 10000))) throw new Error('the settings dialog never opened')
  await wait(300)
  const modal = modalOf('.abele-staged-settings')
  const label = 'settings arrived' + ${JSON.stringify(suffix)}
  const out = { [label]: await screen(label, modal, modal.querySelector('.abele-modal__body')) }
  out[label].extra = { ...buttonFacts(modal), lead: textOf(modal.querySelector('.abele-staged-settings__lead')) }
  await closeDialog()
  return out
`

/** The independent code review uses the same phone and focus-ring measurements. */
export const pluginCodeScreen = (suffix: string): string => `
  ${BUTTON_FACTS}
  svc.settingsPrompt.later()
  svc.heldPrompt.close()
  await closeDialog()
  await svc.codePrompt.refresh()
  svc.codePrompt.ask()
  if (!(await until(() => modalOf('.abele-plugin-code'), 10000))) throw new Error('the code dialog never opened')
  await wait(300)
  const modal = modalOf('.abele-plugin-code')
  const label = 'plugin code' + ${JSON.stringify(suffix)}
  const out = { [label]: await screen(label, modal, modal.querySelector('.abele-modal__body')) }
  out[label].extra = { ...buttonFacts(modal), plugins: [...modal.querySelectorAll('li')].map(textOf) }
  await press(modal, 'Later')
  return out
`

/** Deleted files with the restore-since row in each preset, and the restore's confirmation. */
export const restoreSinceScreens = (suffix: string, trashed: number): string => `
  ${BUTTON_FACTS}
  await closeDialog()
  app.commands.executeCommandById('abele:sync-deleted-files')
  if (!(await until(() => document.querySelectorAll('.abele-deleted-files .abele-card').length >= ${trashed}, 20000)))
    throw new Error('the trash never listed ${trashed} files')
  await wait(300)
  const modal = modalOf('.abele-deleted-files')
  const row = modal.querySelector('.abele-restore-since')
  const select = row.querySelector('select')
  const out = {}
  for (const preset of ['hour', 'today', 'custom']) {
    select.value = preset
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(400)
    const label = 'restore since ' + preset + ${JSON.stringify(suffix)}
    out[label] = await screen(label, modal, modal.querySelector('.abele-modal__body'))
    const button = [...row.querySelectorAll('button')].pop()
    const r = button.getBoundingClientRect()
    out[label].extra = {
      rowReach: row.scrollWidth - row.clientWidth,
      // What reaches past the row's right edge, for a rowReach that is not 0.
      reachers: [...row.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5)
        .map((el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' +' + Math.round(el.getBoundingClientRect().right - row.getBoundingClientRect().right)),
      restoreInView: r.width > 0 && r.left >= 0 && r.right <= window.innerWidth + 1,
      dateField: !!row.querySelector('input[type="datetime-local"]'),
    }
  }
  select.value = 'today'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(300)
  const restore = [...row.querySelectorAll('button')].pop()
  restore.click()
  if (!(await until(() => modalOf('.abele-confirm__message'), 5000))) throw new Error('no confirmation: ' + textOf(restore))
  await wait(300)
  const confirm = modalOf('.abele-confirm__message')
  const confirmLabel = 'restore since confirm' + ${JSON.stringify(suffix)}
  out[confirmLabel] = await screen(confirmLabel, confirm, confirm)
  out[confirmLabel].extra = buttonFacts(confirm, '.abele-modal__footer button')
  await press(confirm, 'Cancel')
  await closeDialog()
  return out
`

/**
 * The Sync tab, opened the way a person gets there, pictured a screen at a time; with `revoke`,
 * also the Revoke confirmation of the device named so, and with `forget`, the "Forget without
 * telling the server?" one. Both are cancelled.
 */
export const syncTabScreens = (
  label: string,
  pages: number,
  confirm: { revoke?: string; forget?: boolean } = {}
): string => `
  ${BUTTON_FACTS}
  ${VOIDS}
  await closeDialog()
  const root = await openSyncTab()
  const doc = root.ownerDocument
  const view = doc.defaultView
  const modal = root.closest('.modal') || root
  const page = [root, ...root.querySelectorAll('*')].find((el) => {
    const s = view.getComputedStyle(el)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
  }) || root
  const out = {}
  const headerFacts = () => {
    const header = doc.querySelector('.modal-setting-back-button')?.parentElement
    if (!header || !doc.body.classList.contains('is-phone')) return { headerOverlap: 0 }
    const bottom = Math.max(...[header, ...header.querySelectorAll('*'), ...modal.querySelectorAll('.modal-close-button')].map((el) => el.getBoundingClientRect().bottom))
    const p = page.getBoundingClientRect()
    return {
      headerOverlap: Math.max(0, Math.round(bottom - p.top)),
      page: page.className,
      header: header.className,
      chain: [page, page.parentElement, page.parentElement?.parentElement].filter(Boolean).map((el) => ({
        name: el.className, box: [el.getBoundingClientRect().top, el.getBoundingClientRect().height],
        overflow: view.getComputedStyle(el).overflowY,
      })),
    }
  }
  const sections = [...root.querySelectorAll('.abele-section__heading')].map(textOf)
  out[${JSON.stringify(label)}] = await screen(${JSON.stringify(label)}, modal, root)
  out[${JSON.stringify(label)}].extra = { sections, voids: voidsIn(root), connectCard: sections.includes('Connect to a server'), ...headerFacts() }
  for (let i = 2; i <= ${pages} && page.scrollTop + page.clientHeight < page.scrollHeight - 1; i++) {
    page.scrollTop += page.clientHeight - 40
    await wait(300)
    out[${JSON.stringify(label)} + ' ' + i] = await screen(${JSON.stringify(label)} + ' ' + i, modal, root)
    out[${JSON.stringify(label)} + ' ' + i].extra = headerFacts()
  }
  const confirmed = async (name) => {
    if (!(await until(() => modalOf('.abele-confirm__message', doc), 5000))) throw new Error('no confirmation for ' + name)
    await wait(300)
    const box = modalOf('.abele-confirm__message', doc)
    out[name] = await screen(name, box, box)
    out[name].extra = buttonFacts(box, '.abele-modal__footer button')
    await press(box, 'Cancel')
    await wait(300)
  }
  if (${JSON.stringify(confirm.revoke ?? '')}) {
    const row = [...root.querySelectorAll('[data-device]')].find((r) => textOf(r.querySelector('.setting-item-name')) === ${JSON.stringify(confirm.revoke ?? '')})
    if (!row) throw new Error('no device row for the revoke')
    row.scrollIntoView({ block: 'center' })
    await press(row, 'Revoke')
    await confirmed(${JSON.stringify(`${label} revoke confirm`)})
  }
  if (${confirm.forget === true}) {
    const row = [...root.querySelectorAll('.setting-item')].find((r) => textOf(r.querySelector('.setting-item-name')) === 'Waiting to tell the server')
    if (!row) throw new Error('no "Waiting to tell the server" row')
    row.scrollIntoView({ block: 'center' })
    await press(row, 'Forget without telling the server')
    await confirmed(${JSON.stringify(`${label} forget confirm`)})
  }
  await closeSettings()
  return out
`

/**
 * Signs in on the Sync tab's card, as a person types it. Leaves the tab open on the vault list;
 * `joinScreens` picks from it.
 */
export const signInOnTab = (serverUrl: string, email: string, password: string): string => `
  await closeDialog()
  const root = await openSyncTab()
  const card = root.querySelector('.abele-sync-settings')
  const url = card.querySelector('input[placeholder="https://sync.example.com"]')
  if (!url) throw new Error('the sign-in card is not showing')
  typeInto(url, ${JSON.stringify(serverUrl)})
  typeInto(card.querySelector('input[placeholder="you@example.com"]'), ${JSON.stringify(email)})
  typeInto(card.querySelector('input[type="password"]'), ${JSON.stringify(password)})
  await press(card, 'Sign in')
  if (!(await until(() => card.querySelector('.abele-card_clickable'), 20000))) throw new Error('the sign-in listed no vault')
  return {}
`

/**
 * The join dialog a click on a listed vault opens, pictured at each width in `widths` (the window
 * is resized between them and put back), then cancelled. The Sync tab stays open on the list.
 */
export const joinScreens = (
  vaultName: string,
  label: string,
  widths: [number, number][]
): string => `
  ${BUTTON_FACTS}
  const root = app.setting.activeTab.containerEl
  const doc = root.ownerDocument
  const card = [...root.querySelectorAll('.abele-card_clickable')].find((c) => textOf(c.querySelector('.abele-card__name')) === ${JSON.stringify(vaultName)})
  if (!card) throw new Error('the list has no ${vaultName.replace(/'/g, '')}')
  card.click()
  if (!(await until(() => doc.querySelector('.abele-join-vault'), 20000))) throw new Error('the join dialog never opened')
  await wait(400)
  const modal = doc.querySelector('.abele-join-vault').closest('.modal')
  const out = {}
  const [w0, h0] = win.getContentSize()
  for (const [w, h] of ${JSON.stringify(widths)}) {
    if (w !== win.getContentSize()[0]) {
      win.setContentSize(w + 2, h + 2)
      await wait(300)
      win.setContentSize(w, h)
      await wait(1200)
    }
    const name = ${JSON.stringify(label)} + (w === ${widths[0]?.[0] ?? 0} ? '' : ' ' + w)
    out[name] = await screen(name, modal, modal.querySelector('.abele-modal__body'))
    const actions = modal.querySelector('.abele-join-vault__actions').getBoundingClientRect()
    const sheet = modal.getBoundingClientRect()
    const below = actions.bottom + (sheet.bottom - actions.bottom) / 2
    const visibleBelowActions = sheet.bottom - actions.bottom > 12 &&
      !!doc.elementFromPoint(actions.left + actions.width / 2, below)?.closest('.abele-obsidian-setting, .abele-card, .abele-join-vault__lead')
    out[name].extra = { ...buttonFacts(modal, '.abele-join-vault__actions button'), cards: modal.querySelectorAll('.abele-card').length, lead: textOf(modal.querySelector('.abele-join-vault__lead')), visibleBelowActions }
  }
  if (win.getContentSize()[0] !== w0) {
    win.setContentSize(w0, h0)
    await wait(800)
  }
  await press(modal, 'Cancel')
  await until(() => !doc.querySelector('.abele-join-vault'), 5000)
  return out
`
