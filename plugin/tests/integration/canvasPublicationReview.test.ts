import { describe, expect, it, vi } from 'vitest'
import { type App, TFile } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { parseCanvas, serializeCanvas } from '@/canvas/core/model'

const initial = parseCanvas({
  nodes: [{ id: 'sample', type: 'text', text: 'Original', x: 0, y: 0, width: 120, height: 80 }],
  edges: [],
})
async function scenario() {
  const app = buildFakeVault([{ path: 'sample-review.canvas', raw: serializeCanvas(initial) }])
  const native: unknown[] = []
  Object.assign(app, { workspace: { getLeavesOfType: () => native } })
  const host = app as unknown as App,
    file = app.vault.getAbstractFileByPath('sample-review.canvas') as TFile,
    store = new ObsidianCanvasStore(host),
    owner = {},
    lease = await store.open(file, owner),
    session = lease.document.session,
    token = session.prepare((g) => ({
      ...g,
      nodes: g.nodes.map((n) => ({ ...n, text: 'Retained' })),
    }))
  session.apply(token, session.committed)
  session.quarantine(token, 'unknown')
  let active = true
  return {
    app,
    host,
    file,
    store,
    owner,
    lease,
    session,
    token,
    native,
    isCurrent: () => active,
    close: () => {
      active = false
      lease.release()
    },
  }
}

describe('local Canvas publication review decisions', () => {
  it('reads persisted bytes, not native unsaved data, and permits a nonwriting local discard with native present', async () => {
    const s = await scenario(),
      evidence = s.session.publicationEvidence,
      history = s.session.history
    const cancel = vi.fn()
    s.native.push({
      view: {
        file: s.file,
        canvas: {
          getData: () => ({ ...initial, nodes: [{ ...initial.nodes[0], text: 'Native unsaved' }] }),
          requestSave: cancel,
        },
      },
    })
    const review = await s.store.reviewPublication(s.file, s.owner, s.isCurrent)
    expect(review.source.bytes).toBe(serializeCanvas(initial))
    expect(review.source.graph).toEqual(initial)
    expect(review.native).toBe(true)
    review.source.graph!.nodes[0].text = 'Outside mutation'
    review.evidence.proposed.nodes.reverse()
    expect(review.source.graph).toEqual(initial)
    expect(s.session.publicationEvidence).toEqual(evidence)
    const process = vi.spyOn(s.app.vault, 'process'),
      ack = vi.spyOn(s.session, 'acknowledge')
    await s.store.discardPublicationReview(review)
    expect(await s.app.vault.read(s.file)).toBe(serializeCanvas(initial))
    expect(s.session.history).toEqual(history)
    expect(s.session.dirty).toBe(false)
    expect(process).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    await expect(s.store.discardPublicationReview(review)).rejects.toThrow(/stale/i)
    expect(() =>
      s.session.acknowledge(s.token, { graph: s.token.graph, revision: 'sample-guessed' })
    ).toThrow(/stale/i)
  })

  it.each([
    'keep',
    'view-close',
    'rename',
    'recreate',
    'source-change',
    'new-draft',
    'new-attempt',
    'foreign-store',
    'replacement-session',
  ] as const)(
    'refuses an obsolete %s decision without changing retained or newer work',
    async (reason) => {
      const s = await scenario(),
        review = await s.store.reviewPublication(s.file, s.owner, s.isCurrent)
      if (reason === 'keep') s.store.keepPublicationReview(review)
      if (reason === 'view-close') s.close()
      if (reason === 'rename') await s.app.vault.rename(s.file, 'sample-renamed.canvas')
      if (reason === 'recreate') {
        await s.app.vault.delete(s.file)
        await s.app.vault.create('sample-review.canvas', serializeCanvas(initial))
      }
      if (reason === 'source-change')
        await s.app.vault.modify(s.file, serializeCanvas({ ...initial, future: 'New source' }))
      if (reason === 'new-draft' || reason === 'new-attempt') {
        s.session.discardDraft()
        s.session.beginDraft()
        s.session.updateDraft((g) => ({ ...g, future: 'New draft' }))
        if (reason === 'new-attempt') {
          s.session.finishDraft()
          const token = s.session.prepareDraft()
          s.session.apply(token, s.session.committed)
          s.session.quarantine(token, 'unknown')
        }
      }
      if (reason === 'replacement-session') {
        s.session.discardDraft()
        s.lease.release()
        await s.store.open(s.file, s.owner)
      }
      const state = {
          draft: s.session.draft,
          evidence: s.session.publicationEvidence,
          history: s.session.history,
          generation: s.session.generation,
        },
        before = await s.app.vault.read(s.file)
      const store = reason === 'foreign-store' ? new ObsidianCanvasStore(s.host) : s.store
      await expect(store.discardPublicationReview(review)).rejects.toThrow(/stale|canonical/i)
      expect({
        draft: s.session.draft,
        evidence: s.session.publicationEvidence,
        history: s.session.history,
        generation: s.session.generation,
      }).toEqual(state)
      expect(await s.app.vault.read(s.file)).toBe(before)
    }
  )

  it('revokes an in-flight discard when the dialog is closed during its read', async () => {
    const s = await scenario(),
      review = await s.store.reviewPublication(s.file, s.owner, s.isCurrent),
      entered = deferred(),
      finish = deferred<string>(),
      before = s.session.publicationEvidence
    vi.spyOn(s.app.vault, 'read').mockImplementationOnce(async () => {
      entered.resolve()
      return finish.promise
    })
    const discarding = s.store.discardPublicationReview(review)
    await entered.promise
    s.store.keepPublicationReview(review)
    finish.resolve(serializeCanvas(initial))
    await expect(discarding).rejects.toThrow(/stale/i)
    expect(s.session.publicationEvidence).toEqual(before)
    expect(s.session.dirty).toBe(true)
  })

  it('refuses source or owner changes while the review observation is awaited', async () => {
    const s = await scenario(),
      entered = deferred(),
      finish = deferred<string>(),
      generation = s.session.generation
    vi.spyOn(s.app.vault, 'read').mockImplementationOnce(async () => {
      entered.resolve()
      return finish.promise
    })
    const reviewing = s.store.reviewPublication(s.file, s.owner, s.isCurrent)
    await entered.promise
    s.close()
    finish.resolve(serializeCanvas(initial))
    await expect(reviewing).rejects.toThrow(/stale/i)
    expect(s.session.generation).toBe(generation)
    expect(s.session.dirty).toBe(true)
  })

  it('shows malformed persisted source without guessing a graph and discards only memory', async () => {
    const s = await scenario()
    await s.app.vault.modify(s.file, '{partial')
    const review = await s.store.reviewPublication(s.file, s.owner, s.isCurrent)
    expect(review.source.bytes).toBe('{partial')
    expect(review.source.graph).toBeNull()
    expect(review.source.error).toBeTruthy()
    await s.store.discardPublicationReview(review)
    expect(await s.app.vault.read(s.file)).toBe('{partial')
    expect(s.session.dirty).toBe(false)
    await expect(s.store.snapshotFile(s.file)).rejects.toThrow()
  })
})
