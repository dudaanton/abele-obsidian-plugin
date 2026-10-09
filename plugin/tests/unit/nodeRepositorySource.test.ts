import { describe, expect, it, vi } from 'vitest'
import { NodeRepositorySource, WORKING_TREE } from '@/repository/node'
import { parseNodeRepositoryLink } from '@/repository/nodeLinks'
import { nodeRepositoryFixture, identity, BASE, HEAD } from '../helpers/nodeRepositoryFixture'

const fixture = () => {
  const f = nodeRepositoryFixture()
  return {
    ...f,
    source: new NodeRepositorySource(f.client, identity, {
      node: 'Sample node',
      project: 'Sample project',
    }),
  }
}
describe('node repository source through the validated client contract', () => {
  it('discovers original and external workspaces with branch, HEAD and dirty state', async () => {
    const { source } = fixture()
    const rows = await source.workspaces()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: identity.workspace,
      dirty: true,
      branch: 'refs/heads/main',
      head: HEAD,
    })
    expect(rows[1]).toMatchObject({ kind: 'external', readOnly: true })
  })
  it('loads a larger file only after an explicit larger request', async () => {
    const f = nodeRepositoryFixture()
    const original = f.client.repository.blob.bind(f.client.repository)
    f.client.repository.blob = async params => params.larger ? original(params) : { content_id: null, size: 2 * 1024 * 1024, binary: false, requires_larger_load: true, too_large: false }
    const source = new NodeRepositorySource(f.client, identity, { node: 'Sample', project: 'Sample' })
    const ordinary = await source.blob(WORKING_TREE, 'app.ts')
    expect(ordinary.canLoadLarge).toBe(true)
    expect(ordinary.text).toBe('')
    const larger = await source.largeBlob(ordinary.ref, ordinary.path)
    expect(larger.text).toContain('42')
    expect(f.calls.find(c => c.method.endsWith('.blob'))?.params.larger).toBe(true)
    source.dispose()
  })
  it('captures Working tree once, transports retained bytes and freezes branch reads', async () => {
    const { source, calls } = fixture()
    const a = await source.blob(WORKING_TREE, 'app.ts')
    const b = await source.blob(WORKING_TREE, 'app.ts')
    expect(a.text).toContain('42')
    expect(a.ref).toBe(b.ref)
    expect(a.contentId).toBeTruthy()
    expect(source.revision(a.ref)).toMatchObject({ kind: 'working-tree', head: HEAD })
    expect(calls.filter((c) => c.method.endsWith('.observe'))).toHaveLength(1)
    const frozen = await source.blob('main', 'app.ts')
    expect(frozen.ref).toBe(HEAD)
    expect(frozen.text).toContain('1')
    expect(
      calls.find((c) => c.method.endsWith('.blob') && c.params.revision.kind === 'commit')?.params
        .revision
    ).toEqual({ kind: 'commit', commit: HEAD })
  })
  it('links to retained working bytes and seeds a comparison in a new source lifetime', async () => {
    const { source, client, change } = fixture()
    const blob = await source.blob(WORKING_TREE, 'app.ts')
    const link = parseNodeRepositoryLink(source.navigation.file(blob.ref, blob.path))!
    expect(link.location).toMatchObject({ contentId: blob.contentId })
    change()
    const fresh = new NodeRepositorySource(
      client,
      identity,
      { node: 'Sample', project: 'Sample' },
      link.revision
    )
    expect((await fresh.blob(blob.ref, blob.path, blob.contentId!)).text).toContain('42')
    const comparisonLink = parseNodeRepositoryLink(source.navigation.comparison(BASE, blob.ref))!
    expect(comparisonLink.revision).toMatchObject({ kind: 'working-tree' })
    fresh.dispose()
  })
  it('keeps staged and unstaged states independent, including deletion and untracked', async () => {
    const { source } = fixture()
    expect((await source.status()).files).toEqual([
      expect.objectContaining({ path: 'app.ts', staged: true, unstaged: true, untracked: false }),
      expect.objectContaining({ path: 'new.txt', staged: false, unstaged: true, untracked: true }),
      expect.objectContaining({
        path: 'gone.txt',
        staged: false,
        unstaged: true,
        status: 'deleted',
      }),
    ])
  })
  it('uses node endpoint comparison and loads per-file patches only on demand', async () => {
    const { source, calls } = fixture()
    const compare = await source.compare(BASE, WORKING_TREE, true)
    expect(compare.files[0].patch).toBeUndefined()
    expect(compare.note).toContain('not atomic')
    await compare.files[0].loadPatch!()
    expect(compare.files[0].patch).toContain('+export const answer = 42')
    expect(calls.filter((c) => c.method.endsWith('.patch'))).toHaveLength(1)
    expect(calls.find((c) => c.method.endsWith('.compare'))?.params.mode).toBe('endpoint')
    const index = await source.comparison(BASE, WORKING_TREE)
    const pinned = await source.comparisonFile(index, 'app.ts')
    expect(pinned.after?.text).toContain('42')
    expect(pinned.text?.additions).toBe(1)
  })
  it('shows additions in a root commit without inventing a parent', async () => {
    const { source } = fixture()
    const commit = await source.commit(BASE)
    expect(commit.parentSha).toBeUndefined()
    expect(commit.files.map((file) => file.path)).toContain('app.ts')
    await commit.files.find((file) => file.path === 'app.ts')!.loadPatch!()
    expect(commit.files.find((file) => file.path === 'app.ts')!.patch).toContain(
      '+export const answer = 1'
    )
  })
  it('separates staged and unstaged comparisons and returns comparison commits', async () => {
    const { source, calls } = fixture()
    const staged = await source.compare(BASE, WORKING_TREE, true, 'staged')
    expect(calls.find((c) => c.method.endsWith('.compare'))?.params.mode).toBe('staged')
    expect(staged.files[0]).toMatchObject({ staged: true, unstaged: true })
    expect(staged.mergeBaseSha).toBe(BASE)
    const commits = await source.compare(BASE, HEAD, true)
    expect(commits.commits.map((c) => c.sha)).toEqual([HEAD])
  })
  it('runs regex/changed search on the node and reports incomplete coverage', async () => {
    const { source, calls } = fixture()
    const results = await source.search({
      ref: WORKING_TREE,
      scope: 'changes',
      query: { text: 'ans.*', regex: true, caseSensitive: true },
      glob: '*.ts',
      limitBytes: 1024,
    })
    expect(results.total).toBe(1)
    expect(results.capped).toBe(true)
    expect(results.note).toContain('binary files skipped')
    expect(calls.find((c) => c.method.endsWith('.search'))?.params).toMatchObject({
      mode: 'regex',
      scope: 'changed',
      path_glob: '*.ts',
    })
    expect(calls.some((c) => c.method.endsWith('.blob'))).toBe(false)
  })
  it('refreshes mutable observations, leaves frozen objects fixed and releases its watch', async () => {
    const { source, change, calls } = fixture()
    const first = await source.blob(WORKING_TREE, 'app.ts')
    const listener = vi.fn()
    const stop = source.subscribe(listener)
    await source.startWatching()
    change()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: 'workspace' }))
    expect((await source.blob(WORKING_TREE, 'app.ts')).text).toContain('84')
    expect(source.revision(first.ref)).toMatchObject({ kind: 'working-tree' })
    stop()
    source.dispose()
    await Promise.resolve()
    expect(calls.some((c) => c.method.endsWith('.unwatch'))).toBe(true)
  })
  it('retires an external source and clears retained caches when browsing is revoked', async () => {
    const f = nodeRepositoryFixture()
    const source = new NodeRepositorySource(
      f.client,
      { ...identity, workspace: 'external-fixture' },
      { node: 'Sample', project: 'Sample' }
    )
    await source.workspaces()
    const blob = await source.blob(WORKING_TREE, 'app.ts')
    const listener = vi.fn()
    source.subscribe(listener)
    await source.startWatching()
    f.event('project.repository_settings.changed', {
      project_id: identity.project,
      external_read: false,
    })
    expect(listener).toHaveBeenCalledWith({ kind: 'authority' })
    await expect(source.blob(blob.ref, blob.path, blob.contentId!)).rejects.toThrow(
      'no longer available'
    )
    source.dispose()
  })
  it('copies its identity so later input mutation cannot retarget reads or links', async () => {
    const f = nodeRepositoryFixture(), input = { ...identity }
    const source = new NodeRepositorySource(f.client, input, { node: 'Sample', project: 'Sample' })
    input.workspace = 'other-worktree'
    await source.blob(WORKING_TREE, 'app.ts')
    expect(f.calls.find(c => c.method.endsWith('.blob'))?.params.worktree_id).toBe(identity.workspace)
    expect(parseNodeRepositoryLink(source.navigation.home())?.source).toEqual(identity)
    source.dispose()
  })
  it('bounds mutable ref aliases within one tab lifetime', async () => {
    const { source } = fixture()
    for (let i = 0; i < 80; i++) await source.resolve(`refs/heads/sample-${i}`)
    expect((source as unknown as { aliases: Map<string, unknown> }).aliases.size).toBeLessThanOrEqual(64)
    source.dispose()
  })
  it('checks authority both before requests and before publishing late results', async () => {
    const f = nodeRepositoryFixture()
    let current = true
    const source = new NodeRepositorySource(f.client, identity, {
      node: 'Sample',
      project: 'Sample',
      isCurrent: () => current,
    })
    const pending = source.blob(WORKING_TREE, 'app.ts')
    current = false
    await expect(pending).rejects.toThrow('no longer available')
    await expect(source.workspaces()).rejects.toThrow('no longer available')
  })
})
