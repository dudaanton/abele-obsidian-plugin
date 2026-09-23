/**
 * On macOS and Windows the file system ignores letter case, so a note asking to be renamed to
 * the same name in other capitals finds "a file already there" — itself — and used to be
 * renamed to "Name (1)" instead.
 */
import { describe, it, expect } from 'vitest'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { syncTaskFileName } from '@/helpers/taskFileName'
import { buildFakeTaskVault, editNote } from '../helpers/fakeTaskVault'

const FM = '---\ntype: task\n---\n'

describe('renaming a note to the same name in other letter case', () => {
  it('gives the note its own name back, recapitalised', async () => {
    buildFakeTaskVault({ 'Tasks/buy milk.md': `${FM}buy milk\n` })

    expect(await getAvailablePath('Tasks/Buy Milk.md', 'Tasks/buy milk.md')).toBe(
      'Tasks/Buy Milk.md'
    )
  })

  it('still steps aside for a different note with that name', async () => {
    buildFakeTaskVault({
      'Tasks/buy milk.md': `${FM}buy milk\n`,
      'Tasks/Other.md': `${FM}Other\n`,
    })

    expect(await getAvailablePath('Tasks/BUY MILK.md', 'Tasks/Other.md')).toBe(
      'Tasks/BUY MILK (1).md'
    )
  })

  it('renames a task whose text changed only in case, without an index', async () => {
    const vault = buildFakeTaskVault({ 'Tasks/call mom.md': `${FM}call mom\n` })
    vault.onModify = (file) => syncTaskFileName(vault.app, file)

    await editNote(vault, 'Tasks/call mom.md', `${FM}Call Mom\n`)

    expect(vault.renames).toEqual([['Tasks/call mom.md', 'Tasks/Call Mom.md']])
  })
})
