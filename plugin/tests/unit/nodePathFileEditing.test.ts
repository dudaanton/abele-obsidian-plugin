import { describe, expect, it, vi } from 'vitest'
import { ref, computed, shallowRef } from 'vue'
import { NodePathFileEditing } from '@/node/NodePathFileEditing'

function editorFake(editable = true) {
  const editing = ref(false)
  const draftText = ref('')
  const document = shallowRef<{ text: string } | null>(null)
  const editor = {
    editing,
    draftText,
    document,
    fileEditable: computed(() => editable),
    draftDirty: computed(() => editing.value && draftText.value !== document.value?.text),
    openFile: vi.fn(async () => {
      document.value = { text: 'saved text' }
      draftText.value = 'saved text'
    }),
    beginEditing: vi.fn(async () => {
      editing.value = true
    }),
    saveFile: vi.fn(async () => {
      document.value = { text: draftText.value }
    }),
    discardDraft: vi.fn(async () => {
      draftText.value = document.value?.text ?? ''
      editing.value = false
    }),
  }
  return editor
}
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-worktree',
}

describe('editing a node file in its own tab', () => {
  it('rereads a clean editor when it is opened again after external changes', async () => {
    const editor = editorFake()
    const editing = new NodePathFileEditing(
      target,
      () => editor as never,
      async () => true
    )
    await editing.start('sample.ts')
    editing.stop()
    await editing.start('sample.ts')
    expect(editor.openFile).toHaveBeenCalledTimes(2)
  })
  it('refreshes the active editor after an external change and retains its unsent draft', async () => {
    const editor = editorFake()
    const editing = new NodePathFileEditing(
      target,
      () => editor as never,
      async () => true
    )
    await editing.start('sample.ts')
    editor.draftText.value = 'unsent sample'
    editor.openFile.mockImplementation(async () => {})
    await editing.refresh()
    expect(editor.openFile).toHaveBeenCalledTimes(2)
    expect(editor.draftText.value).toBe('unsent sample')
    editing.stop()
    await editing.refresh()
    expect(editor.openFile).toHaveBeenCalledTimes(2)
  })
  it('starts editing the file shown, saves, discards and stops without losing the draft', async () => {
    const editor = editorFake()
    const allowed = vi.fn(async () => true)
    const editing = new NodePathFileEditing(target, () => editor as never, allowed)
    await editing.start('src/sample.ts')
    expect(editor.openFile).toHaveBeenCalledWith('src/sample.ts')
    expect(editing.active.value).toBe(true)
    expect(editor.beginEditing).toHaveBeenCalled()
    editor.draftText.value = 'typed text'
    expect(editing.dirty.value).toBe(true)
    await editing.save()
    expect(editor.saveFile).toHaveBeenCalled()
    expect(editing.dirty.value).toBe(false)
    editor.draftText.value = 'more typing'
    editing.stop()
    expect(editing.active.value).toBe(false)
    // Stopping keeps the draft; it is there again on the next start.
    expect(editor.discardDraft).not.toHaveBeenCalled()
    await editing.start('src/sample.ts')
    expect(editor.openFile).toHaveBeenCalledTimes(1)
    await editing.discard()
    expect(editor.discardDraft).toHaveBeenCalled()
    // Discarding the edits leaves the person editing the file as it is now.
    expect(editor.beginEditing).toHaveBeenCalledTimes(2)
  })

  it('does not begin editing a worktree the owner has not opened to saves', async () => {
    const editor = editorFake()
    const editing = new NodePathFileEditing(
      target,
      () => editor as never,
      async () => false
    )
    await editing.start('src/sample.ts')
    expect(editing.active.value).toBe(true)
    expect(editing.locked.value).toBe(true)
    expect(editor.beginEditing).not.toHaveBeenCalled()
    await editing.save()
    expect(editor.saveFile).not.toHaveBeenCalled()
  })

  it('reads another file afresh when the tab moved to it', async () => {
    const editor = editorFake()
    const make = vi.fn(() => editor as never)
    const editing = new NodePathFileEditing(target, make, async () => true)
    await editing.start('src/a.ts')
    editing.stop()
    await editing.start('src/b.ts')
    expect(editor.openFile).toHaveBeenLastCalledWith('src/b.ts')
  })
})
