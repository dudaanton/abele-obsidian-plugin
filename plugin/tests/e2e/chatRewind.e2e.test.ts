/**
 * Rewind in the running app, against Obsidian's own vault, adapter and file manager.
 *
 * The unit tier drives a vault written to behave like Obsidian's; what only the real one can
 * say is how its layers call one another — that a rename through the file manager is recorded
 * once, that the links it rewrites in other notes are recorded too, that frontmatter and
 * binaries come back — and that the dialog's button puts the files back. Everything happens
 * in a folder made for the run and removed after it; the log is kept in memory, never in the
 * plugin's folder. Requires Obsidian with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()

interface Outcome {
  error?: string
  ops?: string[]
  linkRewritten?: boolean
  planned?: [string, string][]
  after?: Record<string, string | null>
  left?: number
}

const DIR = 'Rewind e2e'

const script = `(async () => {
  const t = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await fn()) return true; await wait(100) }
    return false
  }
  const dir = ${JSON.stringify(DIR)}
  const out = {}
  const get = (p) => app.vault.getAbstractFileByPath(p)
  const text = async (p) => (get(p) ? await app.vault.read(get(p)) : null)
  try {
    if (get(dir)) await app.fileManager.trashFile(get(dir))
    await app.vault.createFolder(dir)
    await app.vault.create(dir + '/Alpha.md', 'alpha')
    await app.vault.create(dir + '/Other.md', '---\\nstatus: open\\n---\\nsee [[Alpha]]\\n')
    await app.vault.create(dir + '/Gone.md', 'to be deleted')
    await until(() => (app.metadataCache.resolvedLinks[dir + '/Other.md'] || {})[dir + '/Alpha.md'], 5000)

    const log = new t.rewind.ChatRewind(app, { key: () => 'e2e', turn: () => 'e2e-turn' }, t.rewind.memoryStore())
    const end = log.begin('mv')
    // Obsidian moves only into a folder that is there, so the agent makes it first.
    await app.vault.createFolder(dir + '/Moved')
    await app.fileManager.renameFile(get(dir + '/Alpha.md'), dir + '/Moved/Alpha two.md')
    await app.fileManager.processFrontMatter(get(dir + '/Other.md'), (fm) => { fm.status = 'done' })
    await app.vault.createBinary(dir + '/pic.bin', new Uint8Array([1, 2, 3]).buffer)
    await app.vault.create(dir + '/New.md', 'made up')
    await app.fileManager.trashFile(get(dir + '/Gone.md'))
    await end()

    out.ops = log.entries.value.map((e) => e.op + ' ' + e.changes.map((c) => c.path).join(','))
    out.linkRewritten = (await text(dir + '/Other.md')).includes('Alpha two')

    const plan = await log.planSince(0)
    out.planned = plan.items.map((i) => [i.path, i.action])
    await log.apply(plan, {})
    await wait(300)
    out.after = {}
    for (const p of ['Alpha.md', 'Moved/Alpha two.md', 'Other.md', 'pic.bin', 'New.md', 'Gone.md', 'Moved']) {
      const f = get(dir + '/' + p)
      out.after[p] = !f ? null : f.children ? 'folder' : await text(dir + '/' + p)
    }
    out.left = log.entries.value.length
  } catch (e) {
    out.error = String((e && e.stack) || e)
  } finally {
    if (get(dir)) await app.vault.delete(get(dir), true)
  }
  return out
})()`

/** The dialog opened over two changes, and its "Files only" pressed. */
const dialogScript = `(async () => {
  const t = window.__abeleTest
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const dir = ${JSON.stringify(DIR)}
  const get = (p) => app.vault.getAbstractFileByPath(p)
  const out = {}
  try {
    if (get(dir)) await app.vault.delete(get(dir), true)
    await app.vault.createFolder(dir)
    await app.vault.create(dir + '/Kept.md', 'as it was')
    await t.openRewind(dir + '/Kept.md', dir + '/Made.md')
    await wait(500)
    const rows = [...document.querySelectorAll('.modal .abele-rewind .tree-item-self')]
    out.planned = rows.map((r) => [r.dataset.path, r.querySelector('.tree-item-flair')?.textContent || ''])
    const button = [...document.querySelectorAll('.modal .abele-modal__footer button')].find((b) => b.textContent.trim() === 'Files only')
    button.click()
    await wait(800)
    out.after = { 'Kept.md': get(dir + '/Kept.md') ? await app.vault.read(get(dir + '/Kept.md')) : null, 'Made.md': get(dir + '/Made.md') ? 'there' : null }
    out.left = document.querySelectorAll('.modal .abele-rewind').length
  } catch (e) {
    out.error = String((e && e.stack) || e)
  } finally {
    if (get(dir)) await app.vault.delete(get(dir), true)
  }
  return out
})()`

describe.skipIf(!available)('rewind in the app', () => {
  let outcome: Outcome

  beforeAll(() => {
    outcome = evalAsync<Outcome>(script, 60_000)
  }, 90_000)

  it('records each operation once, and the link Obsidian rewrote on the way', () => {
    expect(outcome.error).toBeUndefined()
    expect(outcome.linkRewritten).toBe(true)
    const renames = (outcome.ops ?? []).filter((op) => op.includes('renameFile'))
    expect(renames).toHaveLength(1)
    // The link Obsidian rewrote in the other note after the rename is a change of its own.
    expect((outcome.ops ?? []).some((op) => !op.includes('renameFile') && op.endsWith('/Other.md'))).toBe(true)
  })

  it('puts every file back as it was', () => {
    expect(outcome.after).toEqual({
      'Alpha.md': 'alpha',
      'Moved/Alpha two.md': null,
      'Other.md': '---\nstatus: open\n---\nsee [[Alpha]]\n',
      'pic.bin': null,
      'New.md': null,
      'Gone.md': 'to be deleted',
      Moved: null,
    })
    expect(outcome.left).toBe(0)
  })
})

describe.skipIf(!available)('the rewind dialog in the app', () => {
  let outcome: Outcome

  beforeAll(() => {
    outcome = evalAsync<Outcome>(dialogScript, 60_000)
  }, 90_000)

  it('lists the files and puts them back when asked', () => {
    expect(outcome.error).toBeUndefined()
    expect(outcome.planned).toEqual([
      [`${DIR}/Kept.md`, 'put back'],
      [`${DIR}/Made.md`, 'to the trash'],
    ])
    expect(outcome.after).toEqual({ 'Kept.md': 'as it was', 'Made.md': null })
    expect(outcome.left).toBe(0)
  })
})
