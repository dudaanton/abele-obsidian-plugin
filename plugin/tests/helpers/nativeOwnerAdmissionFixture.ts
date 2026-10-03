import { vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  sha256,
  type VaultClient,
} from '@abele/sync-core'
import { AbeleError, type CommitOp } from '@abele/sync-protocol'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import { publicationFixture } from './publicationFixture'
import { buildFakeVault } from './fakeVault'
/** Synthetic native observation inputs; the uploader, journal splitting, settlement and replay
 * below are the exact installed core. No app, clipboard, live transport or real credentials. */
export async function nativeOwnerAdmissionFixture(
  code: 'too_large' | 'quota_exceeded' | 'quota_waiting' | 'allow',
  loseReply = false
) {
  const input = await publicationFixture(),
    meta = new MemoryStateStore(),
    state = new MemoryStateStore(),
    fs = new MemoryFileSystem(),
    app = buildFakeVault([]),
    a = new Uint8Array([1, 2, 3]),
    b = new Uint8Array([4, 5, 6]),
    c = new Uint8Array([7, 8, 9]),
    shaA = await sha256(a),
    shaB = await sha256(b),
    shaC = await sha256(c)
  input.target.sha = shaA
  ;(app.metadataCache as any).on = () => ({})
  ;(app.metadataCache as any).offref = () => {}
  ;(app.vault.adapter as any).read = async () => input.current.facts[0].original
  await fs.writeAtomic(input.target.path, a, 1)
  await fs.writeAtomic('Assets/waiting.png', b, 1)
  await fs.writeAtomic('Other/ordinary.bin', c, 1)
  const preparedBytes: { intent: number; native: number }[] = []
  const uploads = new Map<string, Uint8Array>(),
    receipts = new Map<string, { ops: CommitOp[]; body: any }>(),
    wireChecks: { ops: CommitOp[]; stored: any; intentUnit: any }[] = []
  let responseLost = loseReply,
    versionCount = 0,
    publicationCount = 0,
    runtime: NativeOwnerPublication
  const transport = {
    ownerPublicationIdentity: async () => ({
      issuer: input.binding.issuer,
      vaultId: input.binding.vaultId,
      credentialFingerprint: 'd'.repeat(64),
    }),
    hasBlob: async (sha: string) => uploads.has(sha),
    putBlob: vi.fn(async (sha: string, bytes: Uint8Array) => {
      if (sha === shaC && code !== 'allow')
        throw new AbeleError(code, 'Synthetic blob admission refusal')
      uploads.set(sha, bytes.slice())
    }),
    getBlob: async (sha: string) => uploads.get(sha)!.slice(),
    commitRaw: vi.fn(async (ops: CommitOp[], key: string) => {
      wireChecks.push({
        ops: structuredClone(ops),
        stored: await (runtime as any).read('unit:' + key),
        intentUnit: (await (runtime as any).intents.read()).units.find(
          (u: any) => u.unit.requestId === key
        ),
      })
      let receipt = receipts.get(key),
        replayed = !!receipt
      if (receipt && JSON.stringify(receipt.ops) !== JSON.stringify(ops))
        throw new Error('Synthetic idempotency mismatch')
      if (!receipt) {
        versionCount++
        receipt = {
          ops: structuredClone(ops),
          body: {
            head_seq: versionCount,
            results: ops.map((op: any, index: number) => ({
              status: 'applied',
              seq: versionCount,
              file_id: 'sample-asset-' + index,
              version_id: 'asset-v' + versionCount,
              path: op.path,
              sha: op.sha,
              size: op.size,
              mtime: op.mtime,
            })),
            creation_outcomes: ops.map((_op, index) => ({ index, kind: 'novel' })),
          },
        }
        receipts.set(key, receipt)
      }
      if (responseLost) {
        responseLost = false
        throw new Error('Synthetic successful commit reply lost')
      }
      return { body: structuredClone(receipt.body), replayed }
    }),
  } as unknown as VaultClient
  const make = async (fresh: boolean) => {
    runtime = new NativeOwnerPublication({
      app: app as any,
      meta,
      state,
      client: transport,
      binding: input.binding,
      grants: ['sample-grant'],
      token: () => 'absd_' + 'a'.repeat(43),
      fetch: vi.fn() as any,
      configurationRoots: () => ['.obsidian', 'Scripts'],
      enabled: () => true,
      held: () => true,
      eventTarget: { addEventListener: () => {}, removeEventListener: () => {} } as any,
    })
    await runtime.start(fresh)
    const internal = runtime as any
    internal.assets.read = vi.fn(async () => ({
      grantId: 'sample-grant',
      active: true,
      revision: publicationCount,
      withdrawalGeneration: 0,
      entries: [],
    }))
    internal.assets.sponsorProof = vi.fn(async () => ({
      fileId: 'sample-note',
      versionId: 'pending-note',
      admissionGeneration: 7,
      inScope: true,
      intrinsic: true,
    }))
    internal.assets.add = vi.fn(async () => {
      publicationCount++
      return {}
    })
    if (fresh)
      internal.pastes = [
        {
          id: 'sample-introduction',
          notePath: 'NoteA.md',
          before: '',
          start: 0,
          end: 0,
          epoch: 0,
          clipSha: shaA,
          assetSha: shaA,
          assetPath: input.target.path,
          baseline: input.baseline,
          current: {
            path: 'NoteA.md',
            source: input.current.facts[0].original,
            sha: input.current.sha,
            cacheSha: input.current.evidence.cacheSha,
            cacheJson: input.current.evidence.cacheJson,
            generation: input.current.evidence.generation,
            facts: input.current.facts,
          },
          sponsor: { fileId: 'sample-note', versionId: 'pending-note', sha: input.current.sha },
        },
        {
          id: 'sample-waiting',
          notePath: 'NoteB.md',
          before: '',
          start: 0,
          end: 0,
          epoch: 0,
          assetSha: shaB,
          assetPath: 'Assets/waiting.png',
          baseline: input.baseline,
        },
      ]
    return runtime
  }
  await make(true)
  const ops: CommitOp[] = [
      { op: 'create', path: input.target.path, sha: shaA, size: a.length, mtime: 1 },
      { op: 'create', path: 'Assets/waiting.png', sha: shaB, size: b.length, mtime: 1 },
      { op: 'create', path: 'Other/ordinary.bin', sha: shaC, size: c.length, mtime: 1 },
    ],
    infos = new Map(
      ops.map((op: any) => [op.path, { path: op.path, size: op.size, mtime: op.mtime }])
    )
  const scan = {
    ops,
    hashes: new Map(ops.map((op: any) => [op.path, op.sha])),
    diskPaths: new Map(ops.map((op: any) => [op.path, op.path])),
    infos,
    dirty: new Set(ops.map((op: any) => op.path)),
    skipped: [],
    collisions: [],
  }
  return {
    meta,
    state,
    fs,
    transport,
    scan,
    ops,
    wireChecks,
    preparedBytes,
    options: () => ({
      expected: new ExpectedWrites(),
      ...runtime.hooks,
      beforeUpload: async (unit: Parameters<NonNullable<typeof runtime.hooks.beforeUpload>>[0]) => {
        const decision = await runtime.hooks.beforeUpload!(unit),
          native = runtime as any
        const evidence = await meta.getMeta(native.prefix + 'unit:' + unit.idempotencyKey)
        if (evidence !== null)
          preparedBytes.push({
            intent: (await meta.getMeta(native.intents.key))!.length,
            native: evidence.length,
          })
        return decision
      },
      keys: () => 'sample-request',
    }),
    runtime: () => runtime,
    reopen: async () => {
      runtime.close()
      return make(false)
    },
    versionCount: () => versionCount,
    publicationCount: () => publicationCount,
    close: () => runtime.close(),
  }
}
