import { beforeAll, describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')

// Use the real metadata parser and vault writer; never operate on pre-existing attachments.
const script = `(async () => {
  const root = 'sample-media-bulk-safety'
  if (app.vault.getAbstractFileByPath(root)) throw new Error('Sample folder already exists')
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, timeout = 15000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) { const value = fn(); if (value) return value; await wait(50) }
    throw new Error('Sample UI did not settle: ' + fn.toString())
  }
  const input = (selector, value) => {
    const el = document.querySelector(selector)
    if (!el) throw new Error('Missing field ' + selector)
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const button = (text, root = document) => [...root.querySelectorAll('button')].find((el) => el.textContent.trim() === text)
  const apply = () => [...document.querySelectorAll('.abele-sar-fm-modal__result .abele-obsidian-icon')].find((el) => el.textContent.includes('Apply changes'))
  const close = async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    await until(() => !document.querySelector('.modal'))
  }
  const report = {}
  try {
    await app.vault.createFolder(root)
    const keepPath = root + '/sample-keep.png', copyPath = root + '/sample-copy.png'
    const bytes = new Uint8Array([13, 71, 22, 99, 54, 3, 87]).buffer
    await app.vault.createBinary(keepPath, bytes)
    await app.vault.createBinary(copyPath, bytes)
    const before = '![[sample-copy.png|120]]\\n[caption](sample-copy.png \\"title\\")\\n![[sample-copy]]\\nProse ' + copyPath + '.backup'
    const note = await app.vault.create(root + '/sample-links.md', before)
    await app.vault.create(root + '/sample-ref-one.md', '![[sample-keep.png]]')
    await app.vault.create(root + '/sample-ref-two.md', '![[sample-keep.png]]')
    await until(() => app.metadataCache.resolvedLinks[root + '/sample-ref-two.md']?.[keepPath])
    await until(() => app.metadataCache.getFileCache(note)?.embeds?.length >= 2)
    window.__abeleTest.openDialog('dedup-media')
    await until(() => document.querySelector('.abele-dedup') && !document.querySelector('.abele-dedup__status')?.textContent.includes('Hashing'))
    const group = await until(() => [...document.querySelectorAll('.abele-dedup__group')].find((el) => el.textContent.includes(copyPath)))
    button('Merge', group).click()
    // Merge reads all reference sources twice before deleting, even for a tiny duplicate.
    // Thousands of native filesystem reads can exceed a UI-render wait on a real phone.
    await until(() => group.querySelector('.abele-dedup__done, .abele-dedup__error'), 60000)
    report.merge = group.querySelector('.abele-dedup__done') ? 'done' : 'error'
    report.mergeError = group.querySelector('.abele-dedup__error')?.textContent
    report.links = await app.vault.read(note)
    report.removed = !app.vault.getAbstractFileByPath(copyPath)
    await close()

    const chatMedia = await app.vault.createBinary(root + '/sample-chat.png', new Uint8Array([41, 59]).buffer)
    await app.vault.create(root + '/sample-chat.abchat', JSON.stringify({ v: 2, k: 'meta', title: 'Sample chat' }) + '\\n' + JSON.stringify({ k: 'msg', attachments: [chatMedia.path] }) + '\\n')
    window.__abeleTest.openDialog('unused-media')
    await until(() => document.querySelector('.abele-unused-media') && !document.querySelector('.abele-unused-media__status')?.textContent.includes('Scanning'))
    report.scanError = document.querySelector('.abele-unused-media__status')?.textContent.includes('Scan failed') ? document.querySelector('.abele-unused-media__status').textContent : ''
    report.chatProtected = ![...document.querySelectorAll('.abele-unused-media__path')].some((el) => el.textContent === chatMedia.path)
    await close()

    const replaceFile = await app.vault.create(root + '/sample-replace.md', '---\\nlabel: old\\n---\\n\\nSample body\\n')
    window.__abeleTest.openDialog('find-replace')
    await until(() => document.querySelector('.abele-sar-fm-modal input'))
    input('.abele-criterion input[placeholder="Value"]', replaceFile.path)
    input('.abele-replacement-action input[placeholder="Property name"]', 'label')
    input('.abele-replacement-action input[placeholder="Value"]', 'new')
    button('Search').click()
    await until(apply)
    apply().click()
    await until(() => !apply())
    report.replaced = await app.vault.read(replaceFile)
    input('.abele-replacement-action input[placeholder="Value"]', 'later')
    button('Search').click()
    await until(apply)
    const changed = '---\\nlabel: edited\\n---\\nNew sample body\\n'
    await app.vault.modify(replaceFile, changed)
    apply().click()
    await until(() => document.querySelector('.abele-sar-fm-modal [role="alert"]'))
    report.stalePreserved = await app.vault.read(replaceFile) === changed
    report.errorVisible = document.querySelector('.abele-sar-fm-modal [role="alert"]').textContent
    await close()
    return JSON.stringify(report)
  } finally {
    if (document.querySelector('.modal')) await close()
    const folder = app.vault.getAbstractFileByPath(root)
    if (folder) await app.vault.delete(folder, true)
  }
})()`

async function verify() {
  const answer = await evalLong(script, 120_000)
  if (answer.startsWith('Error:')) throw new Error(answer)
  const report = JSON.parse(answer)
  expect(report.merge, report.mergeError).toBe('done')
  expect(report.removed).toBe(true)
  expect(report.links).toContain('![[sample-media-bulk-safety/sample-keep.png|120]]')
  expect(report.links).toContain('[caption](sample-media-bulk-safety/sample-keep.png "title")')
  expect(report.links).toContain('![[sample-media-bulk-safety/sample-keep.png]]')
  expect(report.links).toContain('Prose sample-media-bulk-safety/sample-copy.png.backup')
  expect(report.scanError).toBe('')
  expect(report.chatProtected).toBe(true)
  expect(report.replaced).toContain('label: new')
  expect(report.replaced).toContain('\n\nSample body\n')
  expect(report.stalePreserved).toBe(true)
  expect(report.errorVisible).toMatch(/changed after preview/)
}

describe('media cleanup and bulk replacement safety', () => {
  beforeAll(() => {
    expect(isObsidianRunning()).toBe(true)
    expect(hasTestApi()).toBe(true)
  })
  it('uses real parsed links, protects chat media and rejects stale replacements', verify, 150_000)
  it.skipIf(onPhone())(
    'preserves the same guarantees under phone emulation',
    async () => {
      try {
        await reloadApp('app.emulateMobile(true)')
        await verify()
      } finally {
        await reloadApp('app.emulateMobile(false)')
      }
    },
    240_000
  )
})
