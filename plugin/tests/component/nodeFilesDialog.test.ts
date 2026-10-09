import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeFilesDialog from '@/components/NodeFilesDialog.vue'
import { nodeFilesFixture } from '@/testing/nodeFilesFixture'
import { NodeFilesModel } from '@/node/NodeFilesModel'
import { useVault } from '../helpers/testEnv'
const stubs = {
  Modal: { template: '<div><slot/><slot name="footer"/></div>' },
  GithubCode: {
    name: 'GithubCode',
    props: ['range', 'focus', 'text', 'editable'],
    emits: ['change'],
    template: '<div class="sample-code" />',
  },
  GithubDiffFile: { template: '<div class="sample-diff" />' },
}
it('uses the shared code/diff views and never enables following a listed symbolic link', async () => {
  useVault([])
  const props = await nodeFilesFixture()
  props.model.client.readFile = vi.fn(props.model.client.readFile)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(wrapper.find('.sample-code').exists()).toBe(true)
    const link = wrapper.findAll('button').find((b) => b.text().includes('outside-link'))!
    expect(link.attributes('disabled')).toBeDefined()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Diffs')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Open new snapshot')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.sample-diff')).toHaveLength(2)
  } finally {
    wrapper.unmount()
  }
})
it('keeps an active local draft and reports external changes instead of replacing its text', async () => {
  useVault([])
  const props = await nodeFilesFixture('edit')
  let changed: (() => void) | undefined
  const wrapper = mount(NodeFilesDialog, {
    props: { ...props, subscribeChanges: (listener: () => void) => { changed = listener; return () => { changed = undefined } } },
    global: { stubs },
  })
  await flushPromises()
  const text = props.model.draftText.value
  changed!()
  await flushPromises()
  expect(wrapper.text()).toContain('Changed on disk')
  expect(props.model.draftText.value).toBe(text)
  wrapper.unmount()
  expect(changed).toBeUndefined()
})
it('retains the snapshot of an existing selection when another snapshot is published', async () => {
  useVault([])
  const props = await nodeFilesFixture('review')
  const selectedId = props.model.snapshot.value!.diff_id
  const capture = props.model.client.captureDiff
  props.model.client.captureDiff = async (...args) => ({
    ...(await capture(...args)),
    diff_id: 'newer-snapshot',
  })
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    await props.model.loadDiff('staged')
    await flushPromises()
    await wrapper.find('textarea').setValue('Keep the original selection')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Add to review')!
      .trigger('click')
    await vi.waitFor(() => expect(props.model.comments.value).toHaveLength(2))
    expect(props.model.comments.value.at(-1)?.diff_id).toBe(selectedId)
  } finally {
    wrapper.unmount()
  }
})
it('discards a pending snapshot request when the dialog closes', async () => {
  useVault([])
  const props = await nodeFilesFixture('diffs')
  const snapshot = { ...props.model.snapshot.value!, diff_id: 'closed-view' }
  let resolve!: (value: typeof snapshot) => void
  props.model.client.captureDiff = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Open new snapshot')!
      .trigger('click')
    wrapper.unmount()
    resolve(snapshot)
    await flushPromises()
    expect(props.model.snapshot.value?.diff_id).toBe('sample-immutable-snapshot')
  } finally {
    if (wrapper.exists()) wrapper.unmount()
  }
})
it('splits node line fragments before file reads and supplies the shared code-view range', async () => {
  useVault([])
  const props = await nodeFilesFixture('files')
  const path = props.initialPath!
  props.initialPath = path + '#L12-L20'
  props.model.client.readFile = vi.fn(props.model.client.readFile)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(props.model.client.readFile).toHaveBeenCalledWith(props.model.workspaceId, path)
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('range')).toEqual({
      start: 12,
      end: 20,
    })
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('focus')).toMatchObject({ line: 12 })
  } finally {
    wrapper.unmount()
  }
})
it('restores the stored comparison and commit when reopening the browser', async () => {
  useVault([])
  const props = await nodeFilesFixture('diffs'),
    commit = 'c'.repeat(40)
  const capture = props.model.client.captureDiff
  props.model.client.captureDiff = vi.fn(async (...args) => ({
    ...(await capture(...args)),
    commit: args[1] === 'commit' ? (args[2] ?? null) : null,
  }))
  await props.model.loadDiff('commit', commit)
  let wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  await flushPromises()
  wrapper.unmount()
  wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(
      (wrapper.find('select[aria-label="Diff mode"]').element as HTMLSelectElement).value
    ).toBe('commit')
    expect(
      (wrapper.find('input[aria-label="Commit identity"]').element as HTMLInputElement).value
    ).toBe(commit)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Open new snapshot')!
      .trigger('click')
    await flushPromises()
    expect(props.model.client.captureDiff).toHaveBeenLastCalledWith(
      props.model.workspaceId,
      'commit',
      commit
    )
  } finally {
    wrapper.unmount()
  }
})
it('opens a linked resource even if the previously browsed folder no longer exists', async () => {
  useVault([])
  const props = await nodeFilesFixture('files')
  props.model.directory.value = 'removed-folder'
  props.model.client.listFiles = vi.fn(async () => {
    throw new Error('not_found')
  })
  props.model.client.readFile = vi.fn(props.model.client.readFile)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(props.model.client.readFile).toHaveBeenCalledWith(
      props.model.workspaceId,
      props.initialPath
    )
    expect(wrapper.find('.sample-code').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('not_found')
  } finally {
    wrapper.unmount()
  }
})
it('keeps the editor text when the protocol rejects comment admission', async () => {
  useVault([])
  const props = await nodeFilesFixture('review')
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    const text = 'x'.repeat(2001)
    await wrapper.find('textarea').setValue(text)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Add to review')!
      .trigger('click')
    // One flushPromises turn does not await the native WebCrypto digest in addComment.
    // The alert proves admission finished before checking that the draft survived.
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    expect(props.model.comments.value).toHaveLength(1)
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(text)
    expect(wrapper.find('[role="alert"]').text()).toContain('node limits')
  } finally {
    wrapper.unmount()
  }
})
it('edits in the shared code view and retains a save with unknown outcome across dialog remount', async () => {
  useVault([])
  const props = await nodeFilesFixture('files')
  let wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Edit file')!
      .trigger('click')
    await flushPromises()
    const editor = wrapper.findComponent({ name: 'GithubCode' })
    expect(editor.props('editable')).toBe(true)
    editor.vm.$emit('change', 'local draft')
    await flushPromises()
    expect(wrapper.text()).toContain('Unsent edit')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Save file')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('outcome unknown')
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('editable')).toBe(false)
    const operation = props.model.draft.value!.pending!.operationId
    wrapper.unmount()
    wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('text')).toBe('local draft')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Check save')!
      .trigger('click')
    await flushPromises()
    expect((await props.model.client.pending()).map((e) => e.operation_id)).toEqual([operation])
  } finally {
    wrapper.unmount()
  }
})
it('locks edits during save admission and never publishes a late save into another opened file', async () => {
  const props = await nodeFilesFixture('files'),
    model = props.model
  await model.openFile(props.initialPath!)
  await model.beginEditing()
  await model.editText('submitted draft')
  const write = model.client.writeFile.bind(model.client)
  let release!: () => void
  model.client.writeFile = vi.fn(async (...args) => {
    await new Promise<void>((r) => {
      release = r
    })
    return write(...args)
  })
  const saving = model.saveFile()
  await expect(model.editText('late keystroke')).rejects.toThrow('unresolved')
  await flushPromises()
  await model.openFile('other.txt')
  release()
  await saving
  expect(model.filePath.value).toBe('other.txt')
  expect(model.draft.value).toBeUndefined()
  expect(model.draftText.value).not.toBe('submitted draft')
})
it('starts a new edit from the newly loaded file rather than resurrecting a previously saved draft', async () => {
  const props = await nodeFilesFixture('files'),
    model = props.model
  await model.openFile(props.initialPath!)
  const doc = model.document.value!
  await model.client.store.transaction((state) => {
    ;(state as typeof state & { fileDrafts: Record<string, unknown> }).fileDrafts = {
      [JSON.stringify([model.workspaceId, props.initialPath])]: {
        baseContentId: 'b'.repeat(64),
        baseText: 'previously saved',
        text: 'previously saved',
        status: 'saved',
      },
    }
  })
  await model.beginEditing()
  expect(model.draftText.value).toBe(doc.text)
  expect(model.draft.value?.baseContentId).toBe(doc.contentId)
})
it('reopening Browse refreshes a shared draft changed by another model', async () => {
  useVault([])
  const props = await nodeFilesFixture('edit'),
    a = props.model,
    path = props.initialPath!
  await a.editText('draft A')
  const b = new NodeFilesModel(a.client, a.nodeId, a.workspaceId, 'other-session')
  await b.openFile(path)
  await b.beginEditing()
  await b.editText('draft B')
  const wrapper = mount(NodeFilesDialog, {
    props: { model: a, connection: props.connection },
    global: { stubs },
  })
  try {
    await flushPromises()
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('text')).toBe('draft B')
  } finally {
    wrapper.unmount()
  }
})
it('passive reopen never discards a visible copy rejected by shared-draft CAS', async () => {
  useVault([])
  const props = await nodeFilesFixture('edit'),
    a = props.model,
    path = props.initialPath!
  const b = new NodeFilesModel(a.client, a.nodeId, a.workspaceId, 'other-session')
  await b.openFile(path)
  await b.beginEditing()
  await b.editText('shared B')
  await expect(a.editText('visible private A')).rejects.toThrow('another view')
  const wrapper = mount(NodeFilesDialog, {
    props: { model: a, connection: props.connection },
    global: { stubs },
  })
  try {
    await flushPromises()
    expect(wrapper.findComponent({ name: 'GithubCode' }).props('text')).toBe('visible private A')
    expect(wrapper.text()).not.toContain('Unsent edit · stored only')
  } finally {
    wrapper.unmount()
  }
})
it('does not label an unstored private edit as the previously saved version', async () => {
  useVault([])
  const props = await nodeFilesFixture('edit'),
    model = props.model
  model.draft.value = { ...model.draft.value!, status: 'saved', baseText: model.draftText.value }
  model.documents.edit = () => {
    throw new Error('validation failure')
  }
  await expect(model.editText('visible unsent paste')).rejects.toThrow('validation failure')
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(wrapper.text()).not.toContain('Saved ·')
    expect(wrapper.text()).toContain('copy your text')
  } finally {
    wrapper.unmount()
  }
})
it('allows explicit conflict rebase when the loaded content has returned to the original base', async () => {
  useVault([])
  const props = await nodeFilesFixture('conflict')
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    const rebase = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Use loaded version as base for this draft')
    expect(rebase).toBeDefined()
    await rebase!.trigger('click')
    await flushPromises()
    expect(props.model.draft.value?.status).toBe('draft')
    expect(props.model.draftText.value).toContain('local draft')
  } finally {
    wrapper.unmount()
  }
})
it.each(['binary', 'tooLarge'] as const)(
  'keeps draft text reachable when current contents become %s',
  async (kind) => {
    useVault([])
    const props = await nodeFilesFixture('edit'),
      read = props.model.client.readFile
    props.model.client.readFile = async (...args) => ({
      ...(await read(...args)),
      binary: kind === 'binary',
      too_large: kind === 'tooLarge',
      content_id: kind === 'tooLarge' ? null : 'b'.repeat(64),
    })
    const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
    try {
      await flushPromises()
      expect(wrapper.findComponent({ name: 'GithubCode' }).props('text')).toContain('local draft')
    } finally {
      wrapper.unmount()
    }
  }
)
it('holds comments on terminal rejection and sends a queued batch only once', async () => {
  useVault([])
  const props = await nodeFilesFixture('review')
  props.model.client.submitReview = vi.fn(async () => ({ operation_id: 'sample-review' }))
  props.model.client.reviewResult = vi.fn(async () => undefined)
  const wrapper = mount(NodeFilesDialog, { props, global: { stubs } })
  try {
    await flushPromises()
    expect(wrapper.find('textarea[aria-label="Review comment"]').exists()).toBe(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Send review (1)')!
      .trigger('click')
    await flushPromises()
    expect(props.model.client.submitReview).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('waiting for confirmation')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Check queued review')!
      .trigger('click')
    await flushPromises()
    expect(props.model.client.submitReview).toHaveBeenCalledTimes(1)
    expect(props.model.comments.value).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
