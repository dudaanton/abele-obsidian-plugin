/** Transfer replacement preview and its real switch guard: desktop and phone widths. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodePayload } from '../../src/transfer/payload'
import { newTransferId, toText } from '../../src/transfer/frames'
import type { TransferPayload } from '../../src/transfer/types'
import { spawnSyncServer, siblingMissing, type SyncServer } from './helpers/syncServer'
import { obsidianMissing, type TestVault } from './helpers/syncVault'
import { openVaultUnderLock, reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { SyncDriver } from './helpers/syncDriver'
import { probePrelude, type Screen } from './helpers/layoutProbe'

const why = siblingMissing() ?? obsidianMissing()
const SHOTS = '/tmp/abele-phone'
const DESTINATION = 'Sample destination with a descriptive name'
const EMAIL = 'transfer-layout@example.com'
const PASSWORD = 'sample-password-for-local-tests'
const CODE = 'ABCDEFGH'
let workspace = ''
let server: SyncServer | undefined
let vault: TestVault | undefined
let size: [number, number] = [0, 0]
let text = ''
const screens: Record<string, Screen> = {}
const sync = new SyncDriver(() => {
  if (!vault) throw new Error('no test vault')
  return vault
})

async function capture(suffix: string): Promise<void> {
  const result = await sync.long<Record<string, Screen>>(
    'transfer preview and switch guard',
    `
    ${probePrelude(SHOTS)}
    app.setting.open()
    app.setting.openTabById('abele')
    await wait(800)
    const root = app.setting.activeTab.containerEl
    const doc = root.ownerDocument
    const ownedScreen = async (label, modal, body) => {
      const entry = await screen(label, modal, body)
      if (doc !== document) {
        const owner = require('@electron/remote').BrowserWindow.getAllWindows().find((w) => w.getTitle() === doc.title)
        if (!owner) throw new Error('no window for the settings owner document')
        fs.writeFileSync(entry.shot, (await owner.webContents.capturePage()).toPNG())
      }
      return entry
    }
    const tab = [...root.querySelectorAll('.abele-tabs__tab')].find((el) => textOf(el) === 'Transfer')
    if (!tab) throw new Error('no Transfer tab')
    tab.click()
    await press(root, 'Scan')
    await press(() => doc.querySelector('.abele-transfer-scan'), 'Paste the text')
    const paste = doc.querySelector('textarea[placeholder="ABL1:…"]')
    if (!paste) throw new Error('no transfer text field')
    typeInto(paste, ${JSON.stringify(text)})
    if (!(await poll(() => doc.querySelector('input[placeholder="8 characters"]'), 20000))) throw new Error('no unlock field')
    const code = doc.querySelector('input[placeholder="8 characters"]')
    typeInto(code, ${JSON.stringify(CODE)})
    await press(() => doc.querySelector('.abele-transfer-scan'), 'Unlock')
    if (!(await poll(() => doc.querySelector('.abele-transfer-scan__entry'), 20000))) throw new Error('no preview')
    const row = doc.querySelector('.abele-transfer-scan__entry')
    const preview = row.closest('.modal')
    const toggle = row.querySelector('.checkbox-container')
    const selected = () => toggle.classList.contains('is-enabled')
    if (selected()) throw new Error('a replacement was selected without asking')
    toggle.click()
    await wait(100)
    const afterCheckbox = selected()
    if (!afterCheckbox) throw new Error('checkbox click did not select the replacement')
    await wait(100)
    const out = {}
    const label = 'transfer replacement' + ${JSON.stringify(suffix)}
    out[label] = await ownedScreen(label, preview, preview.querySelector('.abele-modal__body'))
    const title = row.querySelector('.abele-transfer-scan__entry-name')
    const r = title.getBoundingClientRect()
    const box = row.getBoundingClientRect()
    const nameRange = doc.createRange()
    nameRange.selectNodeContents(title)
    const nameLines = [...nameRange.getClientRects()].filter((r) => r.width && r.height).length
    out[label].extra = { afterCheckbox, nameWidth: r.width, rowWidth: box.width, nameLines, destination: textOf(title), nameFont: doc.defaultView.getComputedStyle(title).fontSize, rowFont: doc.defaultView.getComputedStyle(row).fontSize }
    await press(preview, 'Apply')
    if (!(await poll(() => doc.querySelector('.abele-confirm'), 10000))) throw new Error('no switch guard')
    const confirm = doc.querySelector('.abele-confirm').closest('.modal')
    const confirmLabel = 'transfer switch confirm' + ${JSON.stringify(suffix)}
    out[confirmLabel] = await ownedScreen(confirmLabel, confirm, confirm)
    const heading = confirm.querySelector('.modal-title')
    const closeEl = confirm.querySelector('.modal-close-button, .modal-header-button')
    if (!heading || !closeEl) throw new Error('switch confirmation has no native title or close control')
    const close = closeEl.getBoundingClientRect()
    const range = doc.createRange()
    range.selectNodeContents(heading)
    const overlaps = [...range.getClientRects()].filter((r) => r.width && r.height && r.left < close.right && r.right > close.left && r.top < close.bottom && r.bottom > close.top)
    out[confirmLabel].extra = { title: textOf(heading), titleOverlapsClose: overlaps.length, titleReach: heading.scrollWidth - heading.clientWidth }
    await press(confirm, 'Cancel')
    await escapeIn(doc)
    await closeSettings()
    return out
  `
  )
  Object.assign(screens, result)
}

describe.skipIf(why !== null)('transfer selection and readable replacement dialogs', () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'abele-transfer-layout-'))
    server = await spawnSyncServer(workspace)
    server.createAccount(EMAIL, PASSWORD)
    vault = await openVaultUnderLock()
    size = windowSize(vault)
    const sibling = sync.run<{
      serverUrl: string
      vaultId: string
      vaultName: string
      deviceId: string
      deviceName: string
      token: string
    }>(`
      await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault({ create: ${JSON.stringify(DESTINATION)} }, 'Sample sender')
      return await svc.enrolSibling('Sample receiver')
    `)
    await sync.waitIdle()
    sync.run(`await svc.disconnect(); return 'ok'`)
    sync.run(`
      await svc.connect(${JSON.stringify(server.url)}, ${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})
      await svc.chooseVault({ create: 'Sample active vault' }, 'Sample active device')
      return 'ok'
    `)
    await sync.waitIdle()
    const { token, ...connection } = sibling
    const selective = sync.run<unknown>(
      `const { maxFileBytes, ...shared } = svc.connection.value.selective; return shared`
    )
    const payload: TransferPayload = {
      v: 1,
      at: '2026-01-01T00:00:00Z',
      entries: [
        {
          section: 'connection',
          id: 'connection',
          label: 'Sync connection',
          data: { ...connection, selective },
          secretIds: ['sync-connection-token'],
        },
      ],
      secrets: { 'sync-connection-token': token },
    }
    text = toText(await encodePayload(payload, CODE), newTransferId())
    await setWindowSize(vault, 1200, 900)
    await capture(' desktop')
    await setWindowSize(vault, 390, 844)
    await reloadAs(vault, true)
    await sync.waitIdle()
    await capture(' 390')
    await setWindowSize(vault, 320, 844)
    await capture(' 320')
  }, 180_000)

  afterAll(async () => {
    try {
      if (vault) {
        try {
          await reloadAs(vault, false)
          if (size[0]) await setWindowSize(vault, ...size)
          sync.run(`await svc.forget(); return 'ok'`)
        } finally {
          await vault.dispose()
        }
      }
    } finally {
      await server?.kill()
      if (workspace) rmSync(workspace, { recursive: true, force: true })
    }
  }, 180_000)

  it('reaches both dialogs at every requested width', () => {
    for (const suffix of [' desktop', ' 390', ' 320']) {
      expect(screens[`transfer replacement${suffix}`]?.error).toBe('')
      expect(screens[`transfer switch confirm${suffix}`]?.error).toBe('')
    }
  })

  it.each([' desktop', ' 390', ' 320'])('%s: clicking the switch selects once', (suffix) => {
    expect(screens[`transfer replacement${suffix}`]?.extra.afterCheckbox).toBe(true)
  })

  it.each([' 390', ' 320'])(
    '%s: the destination gets a readable column rather than fragments',
    (suffix) => {
      const facts = screens[`transfer replacement${suffix}`]?.extra ?? {}
      expect(String(facts.destination)).toContain(DESTINATION)
      expect(Number(facts.nameWidth)).toBeGreaterThanOrEqual(Number(facts.rowWidth) * 0.6)
      expect(Number(facts.nameLines)).toBeGreaterThan(0)
      expect(Number(facts.nameLines)).toBeLessThanOrEqual(5)
      expect(facts.nameFont).toBe(facts.rowFont)
    }
  )

  it.each([' desktop', ' 390', ' 320'])(
    '%s: no title text runs under the close control',
    (suffix) => {
      const facts = screens[`transfer switch confirm${suffix}`]?.extra ?? {}
      expect(facts.title).toBe('Switch this device to another vault?')
      expect(facts.titleOverlapsClose).toBe(0)
      expect(facts.titleReach).toBe(0)
    }
  )

  it('clips no focus rings and reaches past no dialog edge', () => {
    for (const [label, screen] of Object.entries(screens)) {
      expect(screen.over, label).toEqual([])
      expect(screen.clipped, label).toEqual([])
    }
  })
})
