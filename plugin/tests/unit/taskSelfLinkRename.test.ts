/**
 * A task note is named after its first line. When that line links to the note itself, each
 * rename makes Obsidian rewrite the link, the rewritten line asks for another rename, and the
 * name grows by one copy of itself per round. The owner hit exactly that editing such a task.
 */
import { describe, it, expect } from 'vitest'
import { syncTaskFileName, stripSelfLinks } from '@/helpers/taskFileName'
import { buildFakeTaskVault, editNote } from '../helpers/fakeTaskVault'

const FM = '---\ntype: task\n---\n'

function taskVault(notes: Record<string, string>) {
  const vault = buildFakeTaskVault(notes)
  vault.onModify = (file) => syncTaskFileName(vault.app, file)
  return vault
}

describe('task rename with a link to the task itself', () => {
  it('renames once and stops, with the link following the new name', async () => {
    const vault = taskVault({ 'Tasks/Buy milk.md': `${FM}Buy [[Buy milk]]\n` })

    await editNote(vault, 'Tasks/Buy milk.md', `${FM}Buy bread [[Buy milk]]\n`)
    // Obsidian fires modify again once the rewrite settles; nothing is left to do then.
    await syncTaskFileName(vault.app, vault.file('Tasks/Buy bread.md')!)

    expect(vault.renames).toEqual([['Tasks/Buy milk.md', 'Tasks/Buy bread.md']])
    expect(vault.paths()).toEqual(['Tasks/Buy bread.md'])
    expect(vault.content('Tasks/Buy bread.md')).toBe(`${FM}Buy bread [[Buy bread]]\n`)
  })

  it('does not rename when the note is read between the rename and the link rewrite', async () => {
    const vault = taskVault({ 'Tasks/Call Ann.md': `${FM}Call Ann [[Call Ann]]\n` })
    vault.onModify = null

    await editNote(vault, 'Tasks/Call Ann.md', `${FM}Call Bob [[Call Ann]]\n`)
    await syncTaskFileName(vault.app, vault.file('Tasks/Call Ann.md')!)
    // The file is now Call Bob, its text still links to Call Ann, which no longer exists.
    vault.write('Tasks/Call Bob.md', `${FM}Call Bob [[Call Ann]]\n`)
    await syncTaskFileName(vault.app, vault.file('Tasks/Call Bob.md')!)

    expect(vault.renames).toEqual([['Tasks/Call Ann.md', 'Tasks/Call Bob.md']])
  })

  it('keeps the name when the first line is only a link to the note', async () => {
    const vault = taskVault({ 'Tasks/Water plants.md': `${FM}[[Water plants]]\n` })

    await editNote(vault, 'Tasks/Water plants.md', `${FM}[[Water plants]]\nnew description\n`)

    expect(vault.renames).toEqual([])
  })

  it('still names the task after links to other notes', async () => {
    const vault = taskVault({
      'Tasks/Read.md': `${FM}Read\n`,
      'Books/Dune.md': 'Dune\n',
    })

    await editNote(vault, 'Tasks/Read.md', `${FM}Read [[Dune]]\n`)

    expect(vault.renames).toEqual([['Tasks/Read.md', 'Tasks/Read Dune.md']])
  })

  it('keeps the alias of a self-link, which Obsidian leaves alone on rename', () => {
    const self = (target: string) => target === 'Plan trip'
    expect(stripSelfLinks('Plan [[Plan trip|the trip]] now', self)).toBe(
      'Plan [[Plan trip|the trip]] now'
    )
    expect(stripSelfLinks('Plan [[Plan trip]] now', self)).toBe('Plan now')
    expect(stripSelfLinks('Plan ![[Plan trip#Notes]]', (t) => t.startsWith('Plan trip'))).toBe(
      'Plan'
    )
  })
})
