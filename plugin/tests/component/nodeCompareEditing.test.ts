import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import { nodeFilesFixture } from '@/testing/nodeFilesFixture'
import { NodeFileTabActions } from '@/views/nodeFileTabActions'
import { shallowRef } from 'vue'
import type { PathDocument } from '@/node/NodePathModel'
import { mountCode } from '@/github/codeViewer'

vi.mock('@/github/codeViewer', () => ({
  mountCode: vi.fn(() => ({ destroy: vi.fn(), setText: vi.fn(), blame: vi.fn() })),
}))

it('keeps the comparison baseline while the shared file editor saves a working draft', async () => {
  const { model, initialPath } = await nodeFilesFixture('files')
  await model.openFile(initialPath!)
  await model.beginEditing()
  const view = mount(NodePathEditorPane, {
    props: { model, comparison: { original: 'old sample', split: false } },
  })
  try {
    await flushPromises()
    const code = view.getComponent(GithubCode)
    expect(code.props('comparison')).toEqual({ original: 'old sample', split: false })
    const mounts = vi.mocked(mountCode).mock.calls.length
    code.vm.$emit('change', 'edited sample')
    await flushPromises()
    expect(model.draftText.value).toBe('edited sample')
    expect(code.props('text')).toBe('edited sample')
    expect(vi.mocked(mountCode).mock.calls.length).toBe(mounts)
    const save = vi.spyOn(model.documents, 'save').mockImplementation(async () => ({
      ...model.draft.value!,
      status: 'saved',
      pending: undefined,
      baseText: model.draftText.value,
      baseContentId: 'b'.repeat(64),
    }))
    const draft = vi.spyOn(model.documents, 'draft').mockImplementation(async () => ({
      ...model.draft.value!,
      baseText: model.draftText.value,
      baseContentId: 'b'.repeat(64),
      status: 'saved',
      pending: undefined,
    }))
    await model.saveFile()
    await flushPromises()
    expect(model.document.value?.text).toBe('edited sample')
    expect(code.props('comparison')?.original).toBe('old sample')
    expect(save).toHaveBeenCalledWith(
      initialPath,
      expect.objectContaining({ text: 'edited sample' })
    )
    save.mockRestore()
    draft.mockRestore()
  } finally {
    view.unmount()
  }
})

it('offers no pencil for historical, staged or deleted comparisons and refuses a direct edit action', () => {
  const document = shallowRef<PathDocument>()
  const start = vi.fn()
  const icons: string[] = []
  const actions = new NodeFileTabActions({
    addAction: (icon: string) => {
      icons.push(icon)
      return { remove() {}, toggleClass() {} } as unknown as HTMLElement
    },
    file: () => ({ document }) as never,
    editing: () => ({ active: shallowRef(false), start }) as never,
    saved: () => undefined,
    act: (run) => {
      void run()
    },
    app: () => undefined as never,
  })
  const base = {
    path: 'sample.ts',
    text: 'sample',
    contentId: 'a'.repeat(64),
    target: {} as never,
    change: {
      path: 'sample.ts',
      kind: 'modified' as const,
      before: 'old',
      after: 'sample',
      added: 1,
      removed: 1,
    },
  }
  for (const doc of [
    { ...base, revision: { kind: 'commit' as const, commit: 'sample' } },
    { ...base, change: { ...base.change, kind: 'deleted' as const } },
    { ...base, change: { ...base.change, stage: 'staged' as const } },
  ]) {
    document.value = doc
    icons.length = 0
    actions.render()
    actions.start()
    expect(icons).not.toContain('pencil')
    expect(start).not.toHaveBeenCalled()
  }
})
