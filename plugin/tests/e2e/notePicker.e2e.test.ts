/**
 * A script's form with a filtered note picker, in the running app.
 *
 * What a component test cannot show: that Obsidian's own suggester comes up under the field, over
 * the dialog, offering only the notes the filter lets through as the metadata cache knows them;
 * that taking one puts it above the field; and that the script's `form()` gets the note back in
 * the shape the field asked for.
 *
 * The notes are written for the run, under a folder of their own, and removed after it: the
 * fixture vault holds ScaleTest/ and nothing else.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalJson, evalRaw } from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()

const FOLDER = 'E2E Picker'
const SCRIPT_NAME = 'E2E Picker'
const SCRIPT = `// @name ${SCRIPT_NAME}
// @description Asks for a wallet and returns what the form answered
const r = await form([
  { name: 'wallet', label: 'Wallet', type: 'note-picker', filter: { property: 'type', value: 'e2e-wallet' } },
  { name: 'more', label: 'More', type: 'note-picker', filter: { folder: '${FOLDER}' }, multiple: true, returns: 'link' },
])
return JSON.stringify(r)
`

type Probe<T> = { ok: true; value: T } | { ok: false; error: string }

/** Starts `body` in the app and polls for its result, bounded so a hang fails the test. */
async function probe<T>(body: string, seconds = 20): Promise<T> {
  const started = evalRaw(`(() => {
    const t = window.__abeleTest
    t.pickerProbe = null
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (fn, ms) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (fn()) return true
        await wait(100)
      }
      return false
    }
    ;(async () => {
      try {
        t.pickerProbe = { ok: true, value: await (async () => { ${body} })() }
      } catch (e) {
        t.pickerProbe = { ok: false, error: String((e && e.stack) || e) }
      }
    })()
    return 'started'
  })()`)
  if (!started.includes('started')) throw new Error(`Probe did not start: ${started}`)

  let result: Probe<T> | null = null
  for (let attempt = 0; attempt < seconds * 4 && !result; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    result = evalJson<Probe<T> | null>('window.__abeleTest.pickerProbe ?? null')
  }
  if (!result) throw new Error('Probe did not finish in time')
  if (!result.ok) throw new Error(`Probe failed in the app: ${result.error}`)
  return result.value
}

const setup = `
  const t = window.__abeleTest
  if (!app.vault.getAbstractFileByPath('${FOLDER}')) await app.vault.createFolder('${FOLDER}')
  const notes = {
    'Picker cash.md': 'type: e2e-wallet\\ntitle: Pocket wallet',
    'Picker card.md': 'type: e2e-wallet',
    'Picker coffee.md': 'type: e2e-spending',
  }
  for (const [name, fm] of Object.entries(notes)) {
    const path = '${FOLDER}/' + name
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, '---\\n' + fm + '\\n---\\n')
  }
  // The filter reads the metadata cache, which catches up with a new file a moment later.
  await until(() => Object.keys(notes).every((n) => {
    const f = app.vault.getAbstractFileByPath('${FOLDER}/' + n)
    return f && app.metadataCache.getFileCache(f)?.frontmatter?.type
  }), 5000)
  const folder = t.AbeleConfig.getInstance().ai.scriptsFolder
  if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
  const path = folder + '/${SCRIPT_NAME}.js'
  const existing = app.vault.getAbstractFileByPath(path)
  if (existing) await app.vault.delete(existing)
  await app.vault.create(path, ${JSON.stringify(SCRIPT)})
  await t.ScriptService.getInstance().discover()
  return true
`

const cleanup = `
  const t = window.__abeleTest
  for (let i = 0; i < 3 && document.querySelector('.modal'); i++) {
    const cancel = [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel')
    if (cancel) cancel.click()
    await wait(200)
  }
  const dir = app.vault.getAbstractFileByPath('${FOLDER}')
  if (dir) await app.vault.delete(dir, true)
  const folder = t.AbeleConfig.getInstance().ai.scriptsFolder
  const f = app.vault.getAbstractFileByPath(folder + '/${SCRIPT_NAME}.js')
  if (f) await app.vault.delete(f)
  const scripts = app.vault.getAbstractFileByPath(folder)
  if (scripts && scripts.children && scripts.children.length === 0) await app.vault.delete(scripts, true)
  t.pickerProbe = null
  return true
`

interface Walked {
  offered: string[]
  above: boolean
  pills: string[]
  answer: Record<string, unknown> | null
}

/**
 * Runs the script as a command would, types into the first picker, reads what the suggester
 * offers, takes the wallet by its title, adds one note to the second picker, and presses Run.
 */
const walk = `
  const t = window.__abeleTest
  const s = t.ScriptService.getInstance().getAll().find((x) => x.meta.name === '${SCRIPT_NAME}')
  if (!s) throw new Error('the script was not discovered')
  let output
  t.ScriptService.getInstance()
    .execute(s.path, {}, { formHandler: t.showFormModal, source: 'command' })
    .then((o) => { output = o }, (e) => { output = 'ERROR ' + e })
  if (!(await until(() => document.querySelectorAll('.modal .abele-note-picker input').length === 2, 5000))) {
    throw new Error('the form did not show two pickers')
  }
  const modal = document.querySelector('.modal')
  const [first, second] = modal.querySelectorAll('.abele-note-picker input')

  const type = async (input, text) => {
    input.focus()
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await until(() => document.querySelector('.suggestion-container .suggestion-item'), 3000)
    await wait(200)
  }
  const items = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')]
  const choose = (item) => {
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }

  await type(first, '')
  const offered = items().map((i) => i.querySelector('.suggestion-title')?.textContent ?? '')
  const box = document.querySelector('.suggestion-container')
  const above = !!box && Number(getComputedStyle(box).zIndex || 0) >= Number(getComputedStyle(modal.closest('.modal-container')).zIndex || 0)

  await type(first, 'pocket')
  const pocket = items().find((i) => i.textContent.includes('Pocket wallet'))
  if (!pocket) throw new Error('typing the title did not offer the wallet: ' + items().map((i) => i.textContent))
  choose(pocket)
  await until(() => modal.querySelector('.abele-note-picker__pill'), 2000)

  await type(second, 'coffee')
  const coffee = items()[0]
  if (!coffee) throw new Error('the second picker offered nothing for coffee')
  choose(coffee)
  await until(() => modal.querySelectorAll('.abele-note-picker__pill').length === 2, 2000)
  const pills = [...modal.querySelectorAll('.abele-note-picker__pill')].map((p) => p.dataset.path)

  ;[...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run').click()
  await until(() => output !== undefined, 5000)
  let answer = null
  try { answer = JSON.parse(output) } catch { answer = { raw: String(output) } }
  return { offered, above, pills, answer }
`

describe.skipIf(!available)('a filtered note picker in a script form', () => {
  beforeAll(async () => {
    await probe(setup)
  }, 60_000)

  afterAll(async () => {
    await probe(cleanup)
  }, 60_000)

  it('offers only the notes the filter lets through, and hands back what was taken', async () => {
    const r = await probe<Walked>(walk, 40)
    expect(r.offered.sort()).toEqual(['Picker card', 'Pocket wallet'])
    expect(r.above).toBe(true)
    expect(r.pills).toEqual([`${FOLDER}/Picker cash.md`, `${FOLDER}/Picker coffee.md`])
    expect(r.answer).toEqual({ wallet: `${FOLDER}/Picker cash.md`, more: ['[[Picker coffee]]'] })
  }, 60_000)
})
