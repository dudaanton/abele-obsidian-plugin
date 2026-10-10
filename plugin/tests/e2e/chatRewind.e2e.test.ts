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
import { hasTestApi, isObsidianRunning, evalJson, evalRaw, reloadApp } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
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
const SHOTS = shotDir('rewind')

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
    await end.app.vault.createFolder(dir + '/Moved')
    await end.app.fileManager.renameFile(get(dir + '/Alpha.md'), dir + '/Moved/Alpha two.md')
    await end.app.fileManager.processFrontMatter(get(dir + '/Other.md'), (fm) => { fm.status = 'done' })
    await end.app.vault.createBinary(dir + '/pic.bin', new Uint8Array([1, 2, 3]).buffer)
    await end.app.vault.create(dir + '/New.md', 'made up')
    await end.app.fileManager.trashFile(get(dir + '/Gone.md'))
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
    expect(
      (outcome.ops ?? []).some((op) => op.startsWith('vault.process ') && op.endsWith('/Other.md'))
    ).toBe(true)
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

describe.skipIf(!available)('parallel chat undo in the app', () => {
  it('keeps other chats and human changes, including a stale preview', () => {
    const result = evalAsync<{
      error?: string
      own: boolean
      same: string
      other: string
      refused: boolean
      human: string
    }>(
      `(async () => {
      const dir = ${JSON.stringify(DIR)}
      const get = p => app.vault.getAbstractFileByPath(dir + '/' + p)
      const read = p => app.vault.read(get(p))
      try {
        await app.vault.createFolder(dir)
        await app.vault.create(dir + '/Shared.md', 'original')
        const t = window.__abeleTest.rewind, store = t.memoryStore()
        const a = new t.ChatRewind(app, { key: () => 'parallel-a', turn: () => 'a' }, store)
        const b = new t.ChatRewind(app, { key: () => 'parallel-b', turn: () => 'b' }, store)
        const left = a.track('write', 'run-a'), right = b.track('write', 'run-b')
        await left.app.vault.modify(get('Shared.md'), 'alpha')
        await right.app.vault.modify(get('Shared.md'), 'beta')
        await Promise.all([
          left.app.vault.create(dir + '/A.md', 'alpha only'),
          right.app.vault.create(dir + '/B.md', 'beta only')
        ])
        await Promise.all([left.close(), right.close()])
        const own = a.entries.value.every(e => e.chat === 'parallel-a' && e.run === 'run-a' && e.changes.every(c => !c.path.endsWith('/B.md'))) &&
          b.entries.value.every(e => e.chat === 'parallel-b' && e.run === 'run-b' && e.changes.every(c => !c.path.endsWith('/A.md')))
        await a.apply(await a.planSince(0), { [dir + '/Shared.md']: 'overwrite' })
        const same = await read('Shared.md'), other = await read('B.md')
        const plan = await b.planSince(0)
        await app.vault.modify(get('Shared.md'), 'human words')
        const undone = await b.apply(plan, {})
        return { own, same, other, refused: undone.failed.some(f => f.path.endsWith('/Shared.md')), human: await read('Shared.md') }
      } catch (error) { return { error: String(error.stack || error) } }
      finally { const folder = app.vault.getAbstractFileByPath(dir); if (folder) await app.vault.delete(folder, true) }
    })()`,
      60_000
    )
    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({
      own: true,
      same: 'beta',
      other: 'beta only',
      refused: true,
      human: 'human words',
    })
  }, 90_000)
})

describe.skipIf(!available)('reviewed undo boundaries in the app', () => {
  it('refuses entire rename units and legacy records, and persists late writes under their owner', () => {
    const result = evalAsync<Record<string, unknown>>(
      `(async () => {
      const dir = ${JSON.stringify(DIR)}, t = window.__abeleTest.rewind
      const get = name => app.vault.getAbstractFileByPath(dir + '/' + name)
      const read = name => get(name) ? app.vault.read(get(name)) : null
      try {
        await app.vault.createFolder(dir)
        await app.vault.create(dir + '/Old.md', 'original')
        const store = t.memoryStore()
        const a = new t.ChatRewind(app, { key: () => 'review-a', turn: () => 'a' }, store)
        const owned = a.track('edit', 'run-a')
        await owned.app.vault.modify(get('Old.md'), 'alpha')
        await app.vault.modify(get('Old.md'), 'human')
        await owned.app.fileManager.renameFile(get('Old.md'), dir + '/New.md')
        await owned.close()
        const refused = await a.apply(await a.planSince(0))
        const rename = { old: await read('Old.md'), destination: await read('New.md'), skipped: refused.skipped.length }
        await app.vault.create(dir + '/Source.md', 'source')
        const moving = new t.ChatRewind(app, { key: () => 'moving', turn: () => 'move' }, store)
        const mover = moving.track('mv', 'moving-run')
        await mover.app.fileManager.renameFile(get('Source.md'), dir + '/Destination.md')
        await mover.app.vault.modify(get('Destination.md'), 'edited destination')
        await mover.close()
        const movePlan = await moving.planSince(0)
        await app.vault.create(dir + '/Source.md', 'new human source')
        await moving.apply(movePlan)
        const occupied = { source: await read('Source.md'), destination: await read('Destination.md') }
        const b = new t.ChatRewind(app, { key: () => 'review-b', turn: () => 'b' }, store)
        const creator = b.track('create', 'run-b')
        await creator.app.vault.create(dir + '/Foreign.md', 'other chat')
        await creator.close()
        await store.writeLog('legacy-a', { version: 1, entries: b.entries.value.map(({chat, run, ...entry}) => entry) })
        const legacy = new t.ChatRewind(app, { key: () => 'legacy-a', turn: () => null }, store)
        const plan = await legacy.planSince(0)
        await legacy.apply(plan, { [dir + '/Foreign.md']: 'overwrite' })
        let key = 'owner-a'
        const host = new t.ChatRewind(app, { key: () => key, turn: () => 'script' }, store)
        const late = host.track('script_sample', 'original-run')
        await late.close()
        key = 'owner-b'
        await late.app.vault.create(dir + '/Late.md', 'late owner edit')
        await host.flush()
        const saved = await store.readLog('owner-a')
        return { rename, occupied, legacy: await read('Foreign.md'), reason: plan.items[0].reason,
          owner: saved.entries[0].chat, run: saved.entries[0].run, otherJournal: await store.readLog('owner-b') }
      } catch (error) { return { error: String(error.stack || error) } }
      finally { const folder = app.vault.getAbstractFileByPath(dir); if (folder) await app.vault.delete(folder, true) }
    })()`,
      60_000
    )
    expect(result.error).toBeUndefined()
    expect(result).toMatchObject({
      rename: { old: null, destination: 'human', skipped: 2 },
      occupied: { source: 'new human source', destination: 'edited destination' },
      legacy: 'other chat',
      reason: expect.stringContaining('no chat owner'),
      owner: 'owner-a',
      run: 'original-run',
      otherJournal: null,
    })
  }, 90_000)
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

  it('shows refused conflicts, unowned legacy records and an empty state at desktop and phone widths', async () => {
    const size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    try {
      for (const mobile of [false, true]) {
        await reloadApp(`app.emulateMobile(${mobile})`)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${mobile ? '390,844' : '1100,850'})`
        )
        for (const state of ['conflict', 'legacy', 'empty']) {
          const result = evalAsync<{
            error?: string
            text: string
            width: number
            right: number
            selects: number
          }>(
            `(async () => {
            const dir = ${JSON.stringify(DIR)}, state = ${JSON.stringify(state)}
            const wait = ms => new Promise(r => setTimeout(r, ms))
            const get = p => app.vault.getAbstractFileByPath(p)
            try {
              if (get(dir)) await app.vault.delete(get(dir), true)
              if (state !== 'empty') {
                await app.vault.createFolder(dir)
                const path = dir + '/A sample note with a deliberately long descriptive filename.md'
                await app.vault.create(path, 'Original sample text.')
                await window.__abeleTest.openRewind(path, dir + '/Created.md', state === 'legacy' ? 'legacy' : true)
                await wait(500)
                document.querySelector('.abele-rewind .tree-item-self')?.click()
              } else await window.__abeleTest.openRewind('', '')
              await wait(500)
              const dialog = document.querySelector('.abele-rewind')?.closest('.modal')
              if (!dialog) throw new Error('Undo dialog did not open')
              const image = await require('@electron/remote').getCurrentWebContents().capturePage()
              require('fs').writeFileSync(${JSON.stringify(SHOTS + '/' + (mobile ? 'phone' : 'desktop') + '-')} + state + '.png', image.toPNG())
              return { text: dialog.textContent, width: innerWidth, right: dialog.getBoundingClientRect().right, selects: dialog.querySelectorAll('select').length }
            } catch (error) { return { error: String(error.stack || error) } }
            finally {
              document.querySelector('.abele-rewind')?.closest('.modal')?.querySelector('.modal-header-button, .modal-close-button')?.click()
              await wait(300)
              if (get(dir)) await app.vault.delete(get(dir), true)
            }
          })()`,
            60_000
          )
          expect(result.error).toBeUndefined()
          expect(result.right).toBeLessThanOrEqual(result.width + 1)
          expect(result.selects).toBe(0)
          expect(result.text).toContain(
            state === 'legacy'
              ? 'no chat owner'
              : state === 'conflict'
                ? 'left untouched'
                : 'changed no files'
          )
        }
      }
    } finally {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]},${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 180_000)
})
