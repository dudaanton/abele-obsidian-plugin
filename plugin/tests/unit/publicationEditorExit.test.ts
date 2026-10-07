import { expect, it } from 'vitest'
import { publicationEditorIdle } from '@/sync/publicationPrompt'
import { leaveEditorForPublication } from '../e2e/helpers/publicationEditorExit'
it('leaves the editor through native blur/focusout without directly waking or showing a prompt', () => {
  const editor = document.createElement('div')
  editor.className = 'cm-editor'
  const content = document.createElement('textarea')
  editor.append(content)
  document.body.append(editor)
  let left = 0
  editor.addEventListener('focusout', () => left++)
  try {
    content.focus()
    expect(publicationEditorIdle(document)).toBe(false)
    leaveEditorForPublication(document)
    expect(left).toBe(1)
    expect(publicationEditorIdle(document)).toBe(true)
  } finally {
    editor.remove()
  }
})
