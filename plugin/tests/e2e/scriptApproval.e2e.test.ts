import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { vaultCli } from './helpers/obsidianCli'
import { reloadAs, setWindowSize, windowSize } from './helpers/phoneWindow'
import { type TestVault } from './helpers/syncVault'
import { probePrelude, type Screen } from './helpers/layoutProbe'

const shots = fileURLToPath(new URL('../../../.scratch/script-approval-shots', import.meta.url))
let vault: TestVault
let size: [number, number]
beforeAll(() => {
  const name = process.env.OBSIDIAN_TEST_VAULT
  if (!name) throw new Error('Script approval UI gate needs an exclusively leased pool vault')
  vault = { ...vaultCli(name), path: '', dispose: async () => {} }
  size = windowSize(vault)
  expect(vault.evalAwait<boolean>('!!window.__abeleTest?.scriptTrust')).toBe(true)
})
afterAll(async () => {
  if (!vault) return
  try {
    vault.evalAwait(
      '(() => { window.__abeleTest.scriptTrust.dialog.value?.answer(false); return true })()'
    )
  } catch {
    /* window may be reloading */
  }
  await setWindowSize(vault, size[0], size[1])
  await reloadAs(vault, false)
})

const measure = (label: string) => String.raw`(async () => {
  ${probePrelude(shots)}
  const api = window.__abeleTest.scriptTrust
  const request = {
    path: 'Scripts/Sample folder/sample-script-with-a-long-descriptive-name.js', sha: 'a'.repeat(64),
    source: '// @name Sample\n' + Array.from({length: 90}, (_, i) => '// A reviewable synthetic line ' + i).join('\n') + '\nreturn "sample"',
    identity: { fileId: 'sample-file-identity', binding: { localVault: 'sample-local', endpoint: 'https://sync.example', vaultId: 'sample-vault', principal: 'sample-device', facet: 'personal', grantId: null } },
  }
  const decision = api.confirm(request)
  try {
    if (!(await until(() => document.querySelector('.abele-script-approval'), 5000))) throw new Error('Approval dialog never opened')
    const root = document.querySelector('.abele-script-approval').closest('.modal')
    const report = await screen(${JSON.stringify(label)}, root, root.querySelector('.abele-modal__body'))
    const buttons = [...root.querySelectorAll('.abele-script-approval button')]
    report.extra = {
      buttons: buttons.length,
      visible: buttons.every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 }),
      codeHeight: root.querySelector('pre').getBoundingClientRect().height,
      reviewHeight: (root.querySelector('.abele-script-approval__review') || root.querySelector('pre')).getBoundingClientRect().height,
      inert: !root.querySelector('pre img'),
    }
    if (innerWidth < 600) {
      const review = root.querySelector('.abele-script-approval__review')
      const code = root.querySelector('pre')
      review.scrollTop += code.getBoundingClientRect().top - review.getBoundingClientRect().top
      report.extra.scrolledShot = await shoot(${JSON.stringify(label)} + '-source')
    }
    return report
  } finally { api.dialog.value?.answer(false); await decision }
})()`

describe('script approval with existing dialog geometry checks', () => {
  it('keeps native desktop buttons and focus rings visible', () => {
    const screen = vault.evalAwait<Screen>(measure('script-approval-desktop'))
    console.info(JSON.stringify(screen))
    expect(screen.error).toBe('')
    expect(screen.over).toEqual([])
    expect(screen.clipped).toEqual([])
    expect(screen.extra.buttons).toBe(2)
    expect(screen.extra.visible).toBe(true)
  })
  it('persists an exact-byte approval through the real native dialog and IndexedDB', () => {
    const result = vault.evalAwait<any>(`(async () => {
      ${probePrelude(shots)}
      const api = window.__abeleTest.scriptTrust
      const key = 'abele-script-provenance', marker = '.abele-script-managed'
      const saved = app.loadLocalStorage(key)
      const savedConnection = app.loadLocalStorage('abele-sync-connection')
      const hadMarker = await app.vault.adapter.exists(marker)
      const markerBytes = hadMarker ? await app.vault.adapter.readBinary(marker) : null
      const folder = 'ScriptApprovalProbe', path = folder + '/sample.js'
      let context = null, identity = null, sha = null
      if (app.vault.getAbstractFileByPath(folder)) throw new Error('Probe folder already exists')
      await app.vault.createFolder(folder)
      try {
        await app.vault.create(path, '// @name Native sample\\nreturn "native-approved"')
        app.saveLocalStorage('abele-sync-connection', { serverUrl: 'https://sync.example', enrolledUrl: 'https://sync.example', vaultId: 'sample-vault', deviceId: 'sample-native-device', facet: 'personal', grantId: null })
        context = await api.activate(app, { endpoint: 'https://sync.example', vaultId: 'sample-vault', principal: 'sample-native-device', facet: 'personal', grantId: null }, window.indexedDB)
        await context.provenance.record(path, 'sample-native-file')
        identity = await context.provenance.lookup(path)
        const loaded = api.load(app, path, request => { sha = request.sha; return api.confirm(request) })
        if (!(await until(() => document.querySelector('.abele-script-approval'), 5000))) throw new Error('Native approval did not open')
        const approve = [...document.querySelectorAll('.abele-script-approval button')].find(b => b.textContent.trim() === 'Approve and run')
        approve.click()
        const parsed = await loaded
        const second = await api.load(app, path)
        return { matches: parsed.code === second.code, code: parsed.code, dialogClosed: !api.dialog.value }
      } finally {
        api.dialog.value?.answer(false)
        if (context) {
          await context.store.setMeta('script-source:' + path.toLowerCase(), null)
          if (identity && sha) await context.store.setMeta('script-approval:' + JSON.stringify([identity.binding, identity.fileId, sha]), null)
          context.store.close()
        }
        const created = app.loadLocalStorage(key)
        app.saveLocalStorage(key, saved)
        app.saveLocalStorage('abele-sync-connection', savedConnection)
        if (markerBytes) await app.vault.adapter.writeBinary(marker, markerBytes)
        else if (await app.vault.adapter.exists(marker)) await app.vault.adapter.remove(marker)
        if (!saved && created?.id) await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('abele-script-provenance-' + created.id)
          request.onsuccess = resolve; request.onerror = () => reject(request.error)
          request.onblocked = () => reject(new Error('Probe database remained open'))
        })
        const file = app.vault.getAbstractFileByPath(folder)
        if (file) await app.vault.delete(file, true)
      }
    })()`)
    expect(result.matches).toBe(true)
    expect(result.code).toContain('return "native-approved"')
    expect(result.dialogClosed).toBe(true)
  })

  it.each([390, 320])('uses one readable scrolling sheet at %s wide', async (width) => {
    await setWindowSize(vault, width, 844)
    await reloadAs(vault, true)
    const screen = vault.evalAwait<Screen>(measure('script-approval-' + width))
    console.info(JSON.stringify(screen))
    expect(screen.error).toBe('')
    expect(screen.width).toBe(width)
    expect(screen.over).toEqual([])
    expect(screen.clipped).toEqual([])
    expect(screen.capped).toEqual([])
    expect(screen.scrollers).toHaveLength(1)
    expect(screen.extra.visible).toBe(true)
    expect(screen.extra.buttons).toBe(2)
    expect(screen.extra.codeHeight).toBeGreaterThan(80)
    expect(screen.extra.reviewHeight).toBeGreaterThan(300)
    expect(screen.fill).toBeGreaterThan(0.8)
  })
})
