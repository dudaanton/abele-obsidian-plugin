import { expect, it } from 'vitest'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { evalLong } from './helpers/obsidianCli'
import { WAIT_PRELUDE } from './helpers/wait'
import { buildRichEpub } from '../fixtures/books/richBook'

const english = buildRichEpub()
const files = unzipSync(english)
files['OEBPS/content.opf'] = strToU8(
  strFromU8(files['OEBPS/content.opf'])
    .replace('>en<', '>lv<')
    .replace('abele-rich-test-book', 'sample-lifecycle-lv')
)
const otherLanguage = zipSync(files)

it('keeps simultaneous reader vocabularies scoped and tears down the final subscription', async () => {
  const result = JSON.parse(
    await evalLong(
      `(async () => {
    ${WAIT_PRELUDE}
    const dir = 'Sample vocabulary lifecycle'
    const layout = JSON.parse(JSON.stringify(app.workspace.getLayout()))
    const leaves = []
    const rules = leaf => leaf.view.reading.marks.vocab.rules().filter(rule => rule.target.kind === 'note').map(rule => ({ path: rule.target.path, forms: rule.forms }))
    const open = async path => {
      const leaf = app.workspace.getLeaf('tab')
      leaves.push(leaf)
      await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
      if (!await until(() => leaf.view.model?.status === 'ready' && leaf.view.reading?.marks.vocab, 15000)) throw Error('reader not ready')
      return leaf
    }
    try {
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      await app.vault.createFolder(dir)
      for (const [name, data] of [['en', ${JSON.stringify(Buffer.from(english).toString('base64'))}], ['lv', ${JSON.stringify(Buffer.from(otherLanguage).toString('base64'))}]]) {
        await app.vault.createBinary(dir + '/' + name + '.epub', Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer)
        await app.vault.create(dir + '/' + name + '.md', '---\\nword-forms: [Plain]\\nword-scope: language\\nword-language: ' + name + '\\n---\\n')
      }
      if (!await until(() => ['en','lv'].every(name => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(dir + '/' + name + '.md'))?.frontmatter?.['word-forms']), 10000)) throw Error('metadata not ready')
      const en = await open(dir + '/en.epub')
      const lv = await open(dir + '/lv.epub')
      if (!await until(() => rules(en).some(r => r.path === dir + '/en.md') && rules(lv).some(r => r.path === dir + '/lv.md'), 10000)) throw Error('scoped rules absent')
      const initial = { en: rules(en), lv: rules(lv) }
      en.detach()
      const card = app.vault.getAbstractFileByPath(dir + '/lv.md')
      await app.fileManager.processFrontMatter(card, fm => { fm['word-forms'] = ['chapter'] })
      if (!await until(() => rules(lv).some(r => r.forms.includes('chapter')), 10000)) throw Error('remaining reader missed edit')
      await app.fileManager.renameFile(card, dir + '/moved.md')
      if (!await until(() => rules(lv).some(r => r.path === dir + '/moved.md'), 10000)) throw Error('remaining reader missed rename')
      await app.vault.delete(card)
      if (!await until(() => !rules(lv).some(r => r.path === dir + '/moved.md'), 10000)) throw Error('remaining reader missed delete')
      lv.detach()
      await app.vault.create(dir + '/fresh.md', '---\\nword-forms: [fresh]\\nword-scope: language\\nword-language: lv\\n---\\n')
      if (!await until(() => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(dir + '/fresh.md'))?.frontmatter, 10000)) throw Error('fresh metadata absent')
      const reopened = await open(dir + '/lv.epub')
      if (!await until(() => rules(reopened).some(r => r.forms.includes('fresh')), 10000)) throw Error('reopened reader missed new rule')
      return { initial, reopened: rules(reopened) }
    } catch (error) { return { error: String(error.stack || error) } }
    finally {
      for (const leaf of leaves) leaf.detach()
      const folder = app.vault.getAbstractFileByPath(dir)
      if (folder) await app.vault.delete(folder, true)
      await app.workspace.changeLayout(layout)
    }
  })()`,
      120000
    )
  )
  console.log(JSON.stringify(result))
  expect(result.error).toBeUndefined()
  expect(
    result.initial.en
      .map((r: { path: string }) => r.path)
      .filter((path: string) => path.startsWith('Sample vocabulary lifecycle/'))
  ).toEqual(['Sample vocabulary lifecycle/en.md'])
  expect(
    result.initial.lv
      .map((r: { path: string }) => r.path)
      .filter((path: string) => path.startsWith('Sample vocabulary lifecycle/'))
  ).toEqual(['Sample vocabulary lifecycle/lv.md'])
  expect(result.reopened.some((r: { forms: string[] }) => r.forms.includes('fresh'))).toBe(true)
}, 150000)
