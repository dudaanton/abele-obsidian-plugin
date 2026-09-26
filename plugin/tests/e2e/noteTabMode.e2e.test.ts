/**
 * Every e2e file starts and ends with its note tabs in the editor, where the lists under a note
 * live. A tab keeps the mode it was left in, so a file that switched one to reading view used to
 * hand it on, and the next file searched the lists of whatever note the hidden editor showed last.
 */
import { describe, it, expect } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, notesInEditor } from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()

const modes = (): string[] =>
  JSON.parse(
    evalRaw(
      `JSON.stringify(app.workspace.getLeavesOfType('markdown').map((l) => l.getViewState().state?.mode ?? 'source'))`
    ).replace(/^'(.*)'$/s, '$1')
  ) as string[]

describe.skipIf(!available)('note tabs between e2e files', () => {
  it('starts the file with every note tab in the editor', () => {
    expect(modes().filter((m) => m !== 'source')).toEqual([])
  })

  it('puts a tab left in reading view back in the editor, at the note it showed', () => {
    const shown = evalRaw(
      `(async () => {
        const file = app.vault.getMarkdownFiles()[0]
        const leaf = app.workspace.getLeaf(false)
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' }, active: true })
        return file.path
      })()`
    ).replace(/^'(.*)'$/s, '$1')
    expect(modes()).toContain('preview')
    notesInEditor()
    expect(modes().filter((m) => m !== 'source')).toEqual([])
    const path = evalRaw(`app.workspace.getLeaf(false).view.file?.path`).replace(/^'(.*)'$/s, '$1')
    expect(path).toBe(shown)
  })
})
