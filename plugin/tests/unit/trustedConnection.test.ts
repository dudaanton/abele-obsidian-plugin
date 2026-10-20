import { expect, it, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { TokenUi, tokenUi } from '@/sync/tokenUi'
import { tokenView, tokenValue, writeToken } from '@/ai/tools/settingsTokenConnection'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { reviewSourceOf } from '@/sync/reviewState'
import { migrateSyncSettings } from '@/sync/settings'
import { collectEntries } from '@/transfer/entries'
import { DEFAULT_SETTINGS, type AbeleSettings } from '@/services/AbeleConfig'

function setup() {
  const fixture = tokenUiFixture()
  const state = new MemoryStateStore()
  const reviews = {
    executables: new ExecutableReview(state),
    attachments: new AttachmentConsent(state),
    close() {},
  }
  const ui = new TokenUi(
    fixture.registry,
    { get: () => null, set() {}, remove() {} },
    async () => {
      throw new Error('No request expected')
    },
    reviews
  )
  const source = reviewSourceOf(ui.rows.value[2])
  const apply = vi.fn(async () => {})
  const publishAttachment = vi.fn(async () => {})
  const target = { id: 'sample-image', path: 'Private/sample.png', kind: 'attachment' as const }
  const runtime = {
    apply,
    publishAttachment,
    resolve: async () => target,
    opened: async () => [{ source, noteId: 'sample-note' }],
    sync: async () => {},
    pause: async () => {},
    disconnect: async () => {},
    decideDeletes: vi.fn(),
    heldDeletes: async () => [{ fileId: 'sample-held-delete', path: 'Notes/retained.md' }],
  }
  ui.bind(source.id, runtime)
  const stage = async (versionId: string, from = source) => {
    const bytes = new TextEncoder().encode('sample()')
    return reviews.executables.stage({
      source: from,
      fileId: 'sample-script',
      versionId,
      path: 'Scripts/sample.js',
      previousPath: null,
      operation: 'modify',
      directory: false,
      receivedAt: 1,
      mtime: 1,
      sha: await sha256(bytes),
      bytes,
    })
  }
  return { ui, reviews, source, runtime, target, stage }
}

it('defaults off, isolates trust, installs and logs code, and keeps delete holds manual', async () => {
  const { ui, reviews, source, runtime, stage } = setup()
  expect(ui.rows.value.every((one) => !one.trusted)).toBe(true)
  await stage('v1')
  await ui.refreshReviews()
  expect(runtime.apply).not.toHaveBeenCalled()
  ui.setTrusted(ui.rows.value[0].id, true)
  await ui.refreshReviews()
  expect(runtime.apply).not.toHaveBeenCalled()
  ui.setTrusted(source.id, true)
  await ui.refreshReviews()
  expect(runtime.apply).toHaveBeenCalledOnce()
  expect(await reviews.executables.pending()).toEqual([])
  expect(ui.activity.value[source.id].events?.[0].text).toContain('Installed code from ')
  expect(runtime.decideDeletes).not.toHaveBeenCalled()
  expect(await runtime.heldDeletes()).toHaveLength(1)
  ui.setTrusted(source.id, false)
  await stage('v2')
  await ui.refreshReviews()
  expect(await reviews.executables.pending()).toHaveLength(1)
  expect(runtime.apply).toHaveBeenCalledOnce()
})

it('shares linked private attachments and logs them only for a trusted connection', async () => {
  const { ui, reviews, source, runtime, target } = setup()
  await reviews.attachments.observeNote(source, 'sample-note', [target.id])
  await ui.opened('Groups/sample.md')
  expect(ui.questions.value).toHaveLength(1)
  expect(runtime.publishAttachment).not.toHaveBeenCalled()
  ui.setTrusted(source.id, true)
  await ui.refreshReviews()
  expect(ui.questions.value).toEqual([])
  expect(runtime.publishAttachment).toHaveBeenCalledWith(target.id)
  expect(await reviews.attachments.mayUpload(source, target)).toBe(true)
  expect(ui.activity.value[source.id].events?.[0].text).toContain('Shared Private/sample.png')
})

it('rechecks trust after asynchronous preparation before installing code', async () => {
  const { ui, source, runtime, stage } = setup()
  await stage('v1')
  ui.setTrusted(source.id, true)
  const refresh = ui.refreshReviews()
  ui.setTrusted(source.id, false)
  await refresh
  expect(runtime.apply).not.toHaveBeenCalled()
  expect(ui.candidates.value).toHaveLength(1)
})

it('keeps trust local and inaccessible through settings tools', async () => {
  const { ui, source } = setup()
  ui.setTrusted(source.id, true)
  tokenUi.value = ui
  try {
    expect(tokenView()[source.id]).not.toHaveProperty('trusted')
    const path = `sync.connections.${source.id}.trusted`
    expect(tokenValue(path)).toBeUndefined()
    expect(await writeToken(path, false)).not.toBeNull()
    expect(ui.registry.records().find((one) => one.id === source.id)?.trusted).toBe(true)
    expect(
      ui.registry.storage(source.id).loadLocalStorage('abele-sync-token-state:trusted')
    ).toBeNull()
    const incoming = { trusted: true, connections: { [source.id]: { trusted: true } } }
    expect(migrateSyncSettings(incoming)).toEqual({ keySignature: null })
    const settings = { ...DEFAULT_SETTINGS, sync: incoming } as unknown as AbeleSettings
    expect(JSON.stringify(collectEntries(settings))).not.toContain('trusted')
  } finally {
    tokenUi.value = null
  }
})

it('stops attachment auto-approval when trust is revoked during identity resolution', async () => {
  const { ui, reviews, source, runtime, target } = setup()
  await reviews.attachments.observeNote(source, 'sample-note', [target.id])
  await ui.opened('Groups/sample.md')
  runtime.resolve = async () => {
    ui.setTrusted(source.id, false)
    return target
  }
  ui.setTrusted(source.id, true)
  await ui.refreshReviews()
  expect(ui.questions.value).toHaveLength(1)
  expect(runtime.publishAttachment).not.toHaveBeenCalled()
  expect(await reviews.attachments.mayUpload(source, target)).toBe(false)
})

it('keeps a conflicting approval pending without starving other code or attachments', async () => {
  const { ui, reviews, source, runtime, target, stage } = setup()
  const other = reviewSourceOf(ui.rows.value[0])
  const apply = vi.fn(async () => {})
  ui.bind(other.id, { ...runtime, apply })
  runtime.apply.mockRejectedValue(new Error('The local file changed; this version remains pending'))
  await stage('conflicting')
  await stage('valid', other)
  await reviews.attachments.observeNote(source, 'sample-note', [target.id])
  await ui.opened('Groups/sample.md')
  ui.setTrusted(source.id, true)
  ui.setTrusted(other.id, true)
  await ui.refreshReviews()
  expect(apply).toHaveBeenCalledOnce()
  expect(runtime.publishAttachment).toHaveBeenCalledWith(target.id)
  expect((await reviews.executables.pending()).map((one) => one.versionId)).toEqual(['conflicting'])
  expect(ui.activity.value[source.id].error).toContain('local file changed')
  await ui.refreshReviews()
  expect(apply).toHaveBeenCalledOnce()
})
