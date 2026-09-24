/**
 * A transaction is renamed after its first line, the way a task is, and it read that line the
 * way tasks once did: from the note's open editor rather than from the file the change was
 * written to. An editor that has not loaded its text — a tab in the background, a note shown in
 * reading view on a phone — answers with nothing, and nothing was called "New Transaction".
 *
 * The rename now reads the file, keeps the name when the text names nothing, and treats a name
 * that is the first line as the file system stores it — without the dots at its end — as that
 * line's own.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { transactionFileTarget } from '@/helpers/transactionFileName'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeTaskVault, type FakeTaskVault } from '../helpers/fakeTaskVault'

const FM = [
  '---',
  'type: transaction',
  "date: '2026-09-20'",
  'amount: 12',
  'currency: EUR',
  '---',
  '',
].join('\n')

const FOLDER = 'Finance/Transactions/2026/09'
const RENT = `${FOLDER}/Pay the rent for Sept..md`
const RENT_TEXT = '\nPay the rent for Sept.\n\nthe landlord asked for cash\n'

/** The note open in a tab whose editor has not loaded its text. */
function openWithEmptyEditor(vault: FakeTaskVault, path: string) {
  vault.app.workspace.getLeavesOfType = () => [
    { view: { file: vault.file(path), editor: { getValue: () => '' } } },
  ]
}

beforeEach(() => {
  AbeleConfig.getInstance().transactionPathTemplate =
    'Finance/Transactions/{{date:YYYY/MM}}/{{title}}'
})

describe('a transaction named after its first line keeps its name', () => {
  it('when it already has it', async () => {
    const vault = buildFakeTaskVault({ [RENT]: FM + RENT_TEXT })
    expect(await transactionFileTarget(vault.app, vault.file(RENT)!)).toBeNull()
  })

  it('when the file system dropped the dot at the end of the name', async () => {
    const path = `${FOLDER}/Pay the rent for Sept.md`
    const vault = buildFakeTaskVault({ [path]: FM + RENT_TEXT })
    expect(await transactionFileTarget(vault.app, vault.file(path)!)).toBeNull()
  })

  it('when its open editor has not loaded the text', async () => {
    const vault = buildFakeTaskVault({ [RENT]: FM + RENT_TEXT })
    openWithEmptyEditor(vault, RENT)
    expect(await transactionFileTarget(vault.app, vault.file(RENT)!)).toBeNull()
  })

  it('when its text is empty: nothing names it anything else', async () => {
    const vault = buildFakeTaskVault({ [RENT]: FM })
    expect(await transactionFileTarget(vault.app, vault.file(RENT)!)).toBeNull()
  })

  it('when its first line cleans down to nothing', async () => {
    const vault = buildFakeTaskVault({ [RENT]: FM + '\n[]#^|\n' })
    expect(await transactionFileTarget(vault.app, vault.file(RENT)!)).toBeNull()
  })

  it('and still follows a first line that really changed', async () => {
    const vault = buildFakeTaskVault({ [RENT]: FM + '\nGroceries\n' })
    expect(await transactionFileTarget(vault.app, vault.file(RENT)!)).toBe(`${FOLDER}/Groceries.md`)
  })

  it('and still moves with its date', async () => {
    const vault = buildFakeTaskVault({
      [RENT]: FM.replace("'2026-09-20'", "'2026-10-01'") + RENT_TEXT,
    })
    expect(await transactionFileTarget(vault.app, vault.file(RENT)!)).toBe(
      'Finance/Transactions/2026/10/Pay the rent for Sept..md'
    )
  })
})

describe('editing a transaction whose open editor has not loaded the text', () => {
  it('renames nothing', async () => {
    const vault = buildFakeTaskVault({ [RENT]: FM + RENT_TEXT })
    openWithEmptyEditor(vault, RENT)
    const handlers: Array<(file: unknown) => void> = []
    vault.app.vault.on = (name: string, handler: (file: unknown) => void) => {
      if (name === 'modify') handlers.push(handler)
      return {}
    }
    vault.app.vault.offref = () => {}
    vault.app.fileManager.processFrontMatter = async () => {}
    const store = GlobalStore.getInstance()
    store.initialized.value = false
    store.init(vault.app)

    for (const handler of handlers) handler(vault.file(RENT))
    await new Promise((r) => setTimeout(r, 0))

    expect(vault.renames).toEqual([])
  })
})
