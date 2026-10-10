import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import GithubItem from '@/components/github/GithubItem.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import GithubBlameRange from '@/components/github/GithubBlameRange.vue'
import GithubText from '@/components/github/GithubText.vue'
import GithubCodeSearch from '@/components/github/GithubCodeSearch.vue'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeDocumentSource, NodeFilesModel } from '@/node/NodeFilesModel'
import GithubBlob from '@/components/github/GithubBlob.vue'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { nodeRepositoryFixture, identity, HEAD, BASE } from '../helpers/nodeRepositoryFixture'
import { useVault } from '../helpers/testEnv'
import { emptyScreen } from '@/github/screen'
import type { RepositoryLocation } from '@/repository/source'
import type { GithubViewModel } from '@/github/model'

const repo = { host: 'node.invalid', owner: 'Sample node', repo: 'Sample project' }
beforeEach(() => useVault([]))
function fixture(location: RepositoryLocation = { kind: 'home', ref: WORKING_TREE }) {
  const f = nodeRepositoryFixture(),
    source = new NodeRepositorySource(f.client, identity, { node: repo.owner, project: repo.repo })
  const target =
    location.kind === 'home'
      ? { ...repo, kind: 'repo' as const, ref: location.ref }
      : location.kind === 'file'
        ? { ...repo, kind: 'blob' as const, rest: [location.ref, location.path] }
        : location.kind === 'comparison'
          ? {
              ...repo,
              kind: 'compare' as const,
              base: location.base,
              head: location.head,
              direct: true,
            }
          : { ...repo, kind: 'commit' as const, sha: HEAD }
  const model: GithubViewModel = reactive({
    target,
    url: '',
    nonce: 0,
    tree: false,
    screen: emptyScreen(),
  })
  const onOpen = vi.fn()
  const wrapper = mount(GithubItem, {
    props: { model, enabled: true, source, sourceLocation: location, onOpen },
  })
  return { ...f, source, wrapper, model, onOpen }
}
describe('node-backed shared repository tab', () => {
  it('keeps ordinary live folder navigation editable, without retargeting retained citations or frozen navigation', async () => {
    const live = fixture()
    await flushPromises()
    const entry = live.wrapper
      .findAll('.abele-github-folder__list .tree-item-self')
      .find((row) => row.text().includes('app.ts'))!
    await entry.trigger('click')
    const opened = parseNodeRepositoryLink(live.onOpen.mock.calls[0][0])!
    expect(opened.location).toMatchObject({ kind: 'file', path: 'app.ts', ref: WORKING_TREE })
    expect(parseNodeRepositoryLink(live.model.screen.link!.url)?.revision?.kind).toBe(
      'working-tree'
    )
    live.wrapper.unmount()
    live.source.dispose()
    const frozen = fixture({ kind: 'home', ref: HEAD })
    await flushPromises()
    await frozen.wrapper
      .findAll('.abele-github-folder__list .tree-item-self')
      .find((row) => row.text().includes('app.ts'))!
      .trigger('click')
    expect(parseNodeRepositoryLink(frozen.onOpen.mock.calls[0][0])?.location).toMatchObject({
      ref: HEAD,
    })
    frozen.wrapper.unmount()
    frozen.source.dispose()
  })
  it('keeps editable drafts and selections across disk refresh, with explicit Reload and Keep mine', async () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
      new MemoryClientStore()
    )
    const editor = new NodeFilesModel(
      client,
      identity.node,
      identity.workspace,
      undefined,
      new NodeDocumentSource(client, identity.workspace, true)
    )
    const f = nodeRepositoryFixture(),
      source = new NodeRepositorySource(f.client, identity, {
        node: repo.owner,
        project: repo.repo,
      })
    const wrapper = mount(GithubBlob, {
      props: {
        text: 'before',
        file: { ...repo, ref: WORKING_TREE, path: 'sample.ts' },
        editor,
        writable: true,
        contentId: 'a'.repeat(64),
      },
      global: { provide: { [REPOSITORY_SOURCE as symbol]: { value: source } } },
    })
    await flushPromises()
    const code = wrapper.findComponent(GithubCode)
    expect(code.props('editable')).toBe(true)
    code.vm.$emit('select', { from: 1, to: 1 })
    code.vm.$emit('change', 'my unsent draft')
    await flushPromises()
    await wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    expect(code.props('text')).toBe('my unsent draft')
    expect(code.props('selected')).toEqual({ from: 1, to: 1 })
    expect(wrapper.text()).toContain('Changed on disk')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Keep mine')!
      .trigger('click')
    expect(wrapper.text()).not.toContain('Changed on disk')
    expect(editor.draft.value?.baseContentId).toBe('a'.repeat(64))
    await wrapper.setProps({ text: 'another external edit', contentId: 'c'.repeat(64) })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Reload')!
      .trigger('click')
    await flushPromises()
    expect(code.props('text')).toBe('another external edit')
    expect(editor.draft.value).toBeUndefined()
    wrapper.unmount()
    source.dispose()
  })
  it('turns external editing off without dropping local text and never enables historical files', async () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
      new MemoryClientStore()
    )
    const editor = new NodeFilesModel(
      client,
      identity.node,
      identity.workspace,
      undefined,
      new NodeDocumentSource(client, identity.workspace, true)
    )
    const live = fixture({ kind: 'file', ref: WORKING_TREE, path: 'app.ts' })
    await live.wrapper.setProps({ documentModel: editor, editingAllowed: true })
    await flushPromises()
    expect(live.wrapper.findComponent(GithubCode).props('editable'), live.wrapper.html()).toBe(true)
    live.wrapper.findComponent(GithubCode).vm.$emit('change', 'unsent')
    await flushPromises()
    await live.wrapper.setProps({ editingAllowed: false })
    await flushPromises()
    expect(live.wrapper.findAllComponents(GithubCode).at(-1)!.props('editable')).toBe(false)
    expect(editor.draftText.value).toBe('unsent')
    const frozen = fixture({ kind: 'file', ref: HEAD, path: 'app.ts' })
    await frozen.wrapper.setProps({ documentModel: editor, editingAllowed: true })
    await flushPromises()
    expect(frozen.wrapper.findComponent(GithubCode).props('editable')).toBe(false)
    live.wrapper.unmount()
    live.source.dispose()
    frozen.wrapper.unmount()
    frozen.source.dispose()
  })
  it('offers Save after typing when editing permission arrives after the file was loaded', async () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
      new MemoryClientStore()
    )
    const editor = new NodeFilesModel(
      client,
      identity.node,
      identity.workspace,
      undefined,
      new NodeDocumentSource(client, identity.workspace, true)
    )
    const wrapper = mount(GithubBlob, {
      props: {
        text: 'before',
        file: { ...repo, ref: WORKING_TREE, path: 'sample.ts' },
        contentId: 'a'.repeat(64),
        editor,
        writable: false,
      },
    })
    await flushPromises()
    await wrapper.setProps({ writable: true })
    const code = wrapper.findAllComponents(GithubCode).at(-1)!
    expect(code.props('editable')).toBe(true)
    code.vm.$emit('change', 'unsent')
    await flushPromises()
    expect(
      wrapper
        .findAll('button')
        .some(
          (button) => button.text() === 'Save file' && button.attributes('disabled') === undefined
        )
    ).toBe(true)
    expect(wrapper.text()).toContain('Unsent edit')
    wrapper.unmount()
  })
  it('does not treat a confirmed save as an editable unsent draft when the current file becomes binary', async () => {
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
      new MemoryClientStore()
    )
    const documents = new NodeDocumentSource(client, identity.workspace, true)
    const doc = {
      text: 'before',
      contentId: 'a'.repeat(64),
      size: 6,
      binary: false,
      large: false,
      tooLarge: false,
    }
    await documents.edit('sample.ts', doc, 'saved')
    client.repository.write = vi.fn(async (_, operation_id) => ({ operation_id: operation_id! }))
    client.repository.mutationResult = vi.fn(async (operation_id) => ({
      operation_id,
      worktree_id: identity.workspace,
      path: 'sample.ts',
      state: 'saved',
      expected_content_id: doc.contentId,
      content_id: 'b'.repeat(64),
      predecessor_content_id: doc.contentId,
      recovery_path: null,
    }))
    await documents.save('sample.ts')
    const editor = new NodeFilesModel(
      client,
      identity.node,
      identity.workspace,
      undefined,
      documents
    )
    const wrapper = mount(GithubBlob, {
      props: {
        text: 'saved',
        file: { ...repo, ref: WORKING_TREE, path: 'sample.ts' },
        contentId: 'b'.repeat(64),
        editor,
        writable: true,
      },
    })
    await flushPromises()
    await wrapper.setProps({
      text: '',
      contentId: 'c'.repeat(64),
      documentNote: 'Binary file · no text preview.',
    })
    await flushPromises()
    expect(wrapper.findAllComponents(GithubCode).at(-1)!.props('editable')).toBe(false)
    expect(editor.draft.value?.status).toBe('saved')
    wrapper.unmount()
  })
  it('shows workspace identities, dirty state, recent commits, changes and a safe README', async () => {
    const { wrapper, source } = fixture()
    await flushPromises()
    expect(wrapper.text()).toContain('sample-project')
    expect(wrapper.text()).toContain('worktrees-feature')
    expect(wrapper.text()).toContain('External')
    expect(wrapper.text()).toContain('Partly ready')
    expect(wrapper.find('.abele-github-home__bar').exists()).toBe(false)
    const row = wrapper.find('.abele-repository-row')
    expect(row.find('.abele-repository-row__title').element.parentElement).toBe(
      row.find('.abele-repository-row__meta').element.parentElement
    )
    expect(row.find('.tree-item-flair-outer').text()).toBe('Changes')
    expect(wrapper.text()).toContain('Recent commits')
    expect(wrapper.text()).not.toContain('0 stars')
    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Open pull requests')
    wrapper.unmount()
    source.dispose()
  })
  it('loads the selected node comparison patch lazily in the shared diff viewer', async () => {
    const { wrapper, source, calls } = fixture({
      kind: 'comparison',
      base: BASE,
      head: WORKING_TREE,
      direct: true,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('export const answer = 42')
    expect(wrapper.text()).toContain('Files can change while you look. Refresh to update.')
    expect(calls.some((c) => c.method.endsWith('.patch'))).toBe(true)
    expect(wrapper.find('.abele-github-files__summary').text()).toContain('+1')
    expect(wrapper.find('.abele-github-files__summary').text()).toContain('−1')
    wrapper.unmount()
    source.dispose()
  })
  it('does not pass node commit bodies to the GitHub markdown or credential renderer', async () => {
    const f = nodeRepositoryFixture()
    const source = new NodeRepositorySource(f.client, identity, {
      node: repo.owner,
      project: repo.repo,
    })
    const commit = await source.commit(HEAD)
    vi.spyOn(source, 'commit').mockResolvedValue({
      ...commit,
      message: 'Update sample\n\n![remote](https://images.invalid/sample.png)',
    })
    const model: GithubViewModel = reactive({
      url: '',
      target: { ...repo, kind: 'commit', sha: HEAD },
      nonce: 0,
      tree: false,
      screen: emptyScreen(),
    })
    const wrapper = mount(GithubItem, {
      props: { model, enabled: true, source, sourceLocation: { kind: 'commit', commit: HEAD } },
    })
    await flushPromises()
    expect(wrapper.findComponent(GithubText).exists()).toBe(false)
    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.text()).toContain('![remote]')
    wrapper.unmount()
    source.dispose()
  })
  it('uses named keyboard actions and does not open a fake commit for uncommitted blame', async () => {
    const { wrapper, source, onOpen } = fixture({ kind: 'file', ref: WORKING_TREE, path: 'app.ts' })
    await flushPromises()
    expect(
      wrapper.findAll('.abele-github-header [role="button"][tabindex="0"]').length
    ).toBeGreaterThan(3)
    await wrapper.find('[aria-label="Toggle line blame"]').trigger('click')
    await flushPromises()
    await wrapper.findComponent(GithubBlameRange).find('button').trigger('click')
    expect(onOpen).not.toHaveBeenCalled()
    wrapper.unmount()
    source.dispose()
  })
  it('refreshes an executed live search without replacing or executing a changed query draft', async () => {
    const search = vi.fn(async () => ({ files: [], total: 0, capped: false }))
    const wrapper = mount(GithubCodeSearch, {
      props: { code: { refLabel: () => WORKING_TREE, search }, revisionKey: 'observation-first' },
    })
    await wrapper.find('input').setValue('sample')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.setProps({ revisionKey: 'observation-second' })
    await flushPromises()
    expect(search).toHaveBeenCalledTimes(2)
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('sample')
    await wrapper.find('input').setValue('unsent query draft')
    await wrapper.setProps({ revisionKey: 'observation-third' })
    await flushPromises()
    expect(search).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('refreshes Working tree files on invalidations but leaves commit views frozen', async () => {
    const live = fixture({ kind: 'file', ref: WORKING_TREE, path: 'app.ts' })
    await flushPromises()
    await live.source.startWatching()
    expect(live.wrapper.text()).toContain('answer = 42')
    live.wrapper.findComponent(GithubCode).vm.$emit('select', { from: 1, to: 1 })
    await flushPromises()
    expect(live.model.screen.selection?.code).toContain('42')
    live.change()
    await flushPromises()
    expect(live.wrapper.text()).toContain('answer = 84')
    expect(live.wrapper.findComponent(GithubCode).props('selected')).toEqual({ from: 1, to: 1 })
    expect(live.model.screen.selection?.code).toContain('84')
    live.wrapper.unmount()
    live.source.dispose()
    const frozen = fixture({ kind: 'file', ref: HEAD, path: 'app.ts' })
    await flushPromises()
    await frozen.source.startWatching()
    const count = frozen.calls.filter((c) => c.method.endsWith('.blob')).length
    frozen.change()
    await flushPromises()
    expect(frozen.calls.filter((c) => c.method.endsWith('.blob'))).toHaveLength(count)
    frozen.wrapper.unmount()
    frozen.source.dispose()
  })
})
