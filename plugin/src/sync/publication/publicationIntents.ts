import { sha256 } from '@abele/sync-core'
import { CommitRequestSchema, type CommitOp } from '@abele/sync-protocol'
import { bindingKey, type SnapshotBinding, type SnapshotMeta } from './LinkSnapshotStore'
import {
  reducePublication,
  PublicationDecisionStore,
  type PublicationInput,
  type PublicationProposal,
} from './publicationDecision'
import { PUBLICATION_ENABLED } from './fence'
export interface PushUnit {
  requestId: string
  ops: CommitOp[]
  createHandles: Record<number, string>
}
export interface PushReceipt {
  requestId: string
  ops: CommitOp[]
  outcomes: {
    index: number
    status: 'created' | 'applied' | 'merged' | 'adopted' | 'conflict' | 'restored' | 'rejected'
    fileId?: string
    versionId?: string
    sha?: string | null
    path?: string
    code?: string
  }[]
}
export interface PublicationAuthority {
  grantId: string
  active: boolean
  revision: number
  admissionGeneration: number
  publicationGeneration: number
  withdrawalGeneration: number
  targetFileId?: string
  targetVersionId?: string
  sponsorFileId?: string
  sponsorVersionId?: string
}
export interface PublicationDelta {
  intentId: string
  grantId: string
  expectedRevision: number
  target: { fileId: string; versionId: string; sha: string; path: string }
  sponsor: { fileId: string; versionId: string; sha: string }
  admissionGeneration: number
  publicationGeneration: number
  withdrawalGeneration: number
}
export interface PublicationIntentPort {
  /** Exact native cache + individual owner-introduction + pending-create provenance. */
  attest(input: PublicationInput): Promise<boolean>
  /** Must distinguish genuinely created identity; ordinary applied does NOT certify novelty. */
  verifyReceipt(receipt: PushReceipt): Promise<boolean>
  inspect(
    grantId: string,
    targetFileId?: string,
    sponsorFileId?: string
  ): Promise<PublicationAuthority>
  /** Authorized exact stored receipt lookup, never derive success from current membership. */
  lookup(delta: PublicationDelta): Promise<{ status: 'applied' } | null>
  apply(
    delta: PublicationDelta
  ): Promise<{ status: 'applied' | 'cas-conflict' | 'withdrawn' | 'unavailable' }>
}
interface Intent {
  id: string
  proposal: PublicationProposal
  input: PublicationInput
  authorities: PublicationAuthority[]
  state: 'prepared' | 'settled' | 'held' | 'published'
  reason?: string
  deltas?: { value: PublicationDelta; done: boolean; attempted?: boolean }[]
}
interface Unit {
  unit: PushUnit
  sha: string
  intents: Intent[]
  holds: string[]
  settled: boolean
  receiptSha?: string
}
interface Ledger {
  version: 1
  binding: SnapshotBinding
  units: Unit[]
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
const digest = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 4096
/** One host-owned writer, one durable metadata record. No network adapter or activation shortcut.
 * Entire inputs/deltas are immutable; recovery never rescans a merged/current note as owner additions.
 */
export class PublicationIntents {
  private readonly key: string
  private readonly binding: SnapshotBinding
  private tail: Promise<void> = Promise.resolve()
  constructor(
    private readonly meta: SnapshotMeta,
    binding: SnapshotBinding,
    private readonly port: PublicationIntentPort,
    private readonly enabled: () => boolean = () => PUBLICATION_ENABLED,
    private readonly held: () => boolean = () => false
  ) {
    this.binding = copy(binding)
    this.key = 'publication-intents-v1:' + bindingKey(binding)
  }
  private fence() {
    if (!this.enabled()) throw new Error('Publication intent integration is disabled')
    if (!this.held()) throw new Error('Publication writer ownership lost')
    if (this.binding.facet !== 'personal' || this.binding.grantId !== null)
      throw new Error('Scoped publication authority is refused')
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work)
    this.tail = next.then(
      () => {},
      () => {}
    )
    return next
  }
  /** Only during explicit first allocation of the protected publication database, never reopen. */
  async initialize(): Promise<void> {
    this.fence()
    if ((await this.meta.getMeta(this.key)) !== null)
      throw new Error('Publication intent storage already allocated')
    await this.write({ version: 1, binding: copy(this.binding), units: [] })
  }
  private async read(): Promise<Ledger> {
    this.fence()
    const raw = await this.meta.getMeta(this.key)
    this.fence()
    if (raw === null) throw new Error('Publication intent storage missing; recovery required')
    try {
      if (raw.length > 1024 * 1024) throw new Error()
      const envelope = JSON.parse(raw) as { ledger: Ledger; checksum: string }
      if (!digest(envelope.checksum) || (await hash(envelope.ledger)) !== envelope.checksum)
        throw new Error()
      const l = envelope.ledger
      if (
        l.version !== 1 ||
        bindingKey(l.binding) !== bindingKey(this.binding) ||
        !Array.isArray(l.units) ||
        l.units.length > 128
      )
        throw new Error()
      for (const u of l.units) {
        if (
          !text(u.unit.requestId) ||
          (await hash(u.unit)) !== u.sha ||
          !Array.isArray(u.intents) ||
          u.intents.length > 16 ||
          typeof u.settled !== 'boolean' ||
          !Array.isArray(u.holds)
        )
          throw new Error()
        CommitRequestSchema.parse({ ops: u.unit.ops })
        for (const i of u.intents)
          if (
            !text(i.id) ||
            !digest(i.proposal.fingerprint) ||
            !digest(i.proposal.exposureKey) ||
            bindingKey(i.input.binding) !== bindingKey(this.binding) ||
            !['prepared', 'settled', 'held', 'published'].includes(i.state) ||
            !Array.isArray(i.authorities)
          )
            throw new Error()
      }
      return l
    } catch {
      throw new Error('Publication intent storage unreadable; recovery required')
    }
  }
  private async write(l: Ledger) {
    this.fence()
    const raw = JSON.stringify({ ledger: l, checksum: await hash(l) })
    if (raw.length > 1024 * 1024) throw new Error('Publication intent storage budget reached')
    await this.meta.setMeta(this.key, raw)
    this.fence()
    if ((await this.meta.getMeta(this.key)) !== raw)
      throw new Error('Publication intent was not persisted; recovery required')
    this.fence()
  }
  async prepare(unit: PushUnit, inputs: PublicationInput[]): Promise<void> {
    const u = copy(unit),
      observations = copy(inputs)
    this.fence()
    return this.serial(async () => {
      CommitRequestSchema.parse({ ops: u.ops })
      if (!text(u.requestId) || observations.length > 16)
        throw new Error('Invalid publication request unit')
      const l = await this.read(),
        sha = await hash(u),
        old = l.units.find((v) => v.unit.requestId === u.requestId)
      if (old) {
        if (old.sha !== sha) throw new Error('Publication request identity changed')
        return
      }
      if (l.units.length >= 128) throw new Error('Publication intent unit budget reached')
      const record: Unit = { unit: u, sha, intents: [], holds: [], settled: false }
      const decisions = new PublicationDecisionStore(this.meta)
      for (const input of observations) {
        if (
          bindingKey(input.binding) !== bindingKey(this.binding) ||
          !(await this.port.attest(copy(input)))
        ) {
          record.holds.push('unproven cache/create origin')
          continue
        }
        this.fence()
        let proposal = await reducePublication({ ...input, decisions: [] })
        if (proposal.kind === 'confirm') {
          const remembered = await decisions.get(proposal.exposureKey)
          proposal = await reducePublication({
            ...input,
            decisions: remembered ? [remembered] : [],
          })
        }
        if (!['auto-intent', 'sponsor-intent', 'confirmed-intent'].includes(proposal.kind)) {
          record.holds.push('no approved publication candidate')
          continue
        }
        const p = proposal as PublicationProposal
        if (input.target.creator === 'pending-local-create') {
          const handle = input.target.create?.handle,
            index = u.ops.findIndex(
              (op, n) =>
                op.op === 'create' &&
                op.path === p.targetPath &&
                op.sha === p.targetSha &&
                u.createHandles[n] === handle
            )
          if (
            index < 0 ||
            !handle ||
            l.units.some(
              (v) =>
                v.unit.requestId !== u.requestId &&
                Object.values(v.unit.createHandles).includes(handle)
            )
          ) {
            record.holds.push('create handle is absent or already settled')
            continue
          }
        }
        // Sponsor bytes must belong to this exact unit, not an unrelated later body save.
        if (
          !u.ops.some((op, index) =>
            op.op === 'create' && input.baseline.kind === 'local-create'
              ? u.createHandles[index] === input.baseline.handle && op.sha === input.current.sha
              : op.op === 'modify' &&
                op.file_id === input.current.noteId &&
                op.sha === input.current.sha
          ) ||
          p.sponsors.length !== 1
        ) {
          record.holds.push('sponsor is not in exact committed unit')
          continue
        }
        const authorities: PublicationAuthority[] = []
        for (const a of input.audiences) {
          const current = await this.port.inspect(a.grantId)
          this.fence()
          if (
            !current.active ||
            current.grantId !== a.grantId ||
            !Number.isSafeInteger(current.revision) ||
            current.revision < 0 ||
            current.admissionGeneration !== a.admissionGeneration ||
            current.publicationGeneration !== a.publicationGeneration ||
            current.withdrawalGeneration !== a.withdrawalGeneration
          )
            break
          authorities.push(copy(current))
        }
        if (authorities.length !== input.audiences.length) {
          record.holds.push('audience authority changed')
          continue
        }
        record.intents.push({
          id: crypto.randomUUID(),
          proposal: copy(p),
          input,
          authorities,
          state: 'prepared',
        })
      }
      l.units.push(record)
      await this.write(l)
    })
  }
  async settle(receipt: PushReceipt): Promise<void> {
    const r = copy(receipt)
    this.fence()
    return this.serial(async () => {
      const l = await this.read(),
        unit = l.units.find((v) => v.unit.requestId === r.requestId)
      if (
        !unit ||
        JSON.stringify(unit.unit.ops) !== JSON.stringify(r.ops) ||
        !(await this.port.verifyReceipt(copy(r)))
      )
        throw new Error('Exact publication receipt proof required')
      this.fence()
      const receiptSha = await hash(r)
      if (unit.settled) {
        if (unit.receiptSha !== receiptSha) throw new Error('Publication receipt identity changed')
        return
      }
      if (
        r.outcomes.length !== r.ops.length ||
        new Set(r.outcomes.map((o) => o.index)).size !== r.ops.length ||
        r.outcomes.some(
          (o) =>
            !Number.isSafeInteger(o.index) ||
            o.index < 0 ||
            o.index >= r.ops.length ||
            (o.status === 'rejected'
              ? !text(o.code) && !(text(o.fileId) && text(o.versionId))
              : !text(o.fileId) ||
                !text(o.versionId) ||
                !text(o.path) ||
                !(
                  digest(o.sha) ||
                  (r.ops[o.index].op === 'delete' && o.status === 'applied' && o.sha === null)
                ))
        )
      )
        throw new Error('Publication receipt cardinality/identity invalid')
      for (const intent of unit.intents) {
        const i = intent.input,
          p = intent.proposal
        const sponsor = r.outcomes.find(
          (o) =>
            o.sha === i.current.sha &&
            (i.baseline.kind === 'local-create'
              ? r.ops[o.index].op === 'create' &&
                unit.unit.createHandles[o.index] === i.baseline.handle &&
                o.status === 'created'
              : r.ops[o.index].op === 'modify' &&
                (r.ops[o.index] as { file_id: string }).file_id === i.current.noteId &&
                o.fileId === i.current.noteId &&
                o.status === 'applied')
        )
        const target =
          i.target.creator === 'pending-local-create'
            ? r.outcomes.find(
                (o) =>
                  r.ops[o.index].op === 'create' &&
                  unit.unit.createHandles[o.index] === i.target.create?.handle &&
                  o.status === 'created' &&
                  o.path === p.targetPath &&
                  o.sha === p.targetSha
              )
            : {
                fileId: i.target.id,
                versionId: i.target.versionId,
                sha: i.target.sha,
                path: i.target.path,
              }
        if (
          !sponsor ||
          !text(sponsor.fileId) ||
          !text(sponsor.versionId) ||
          !digest(sponsor.sha) ||
          !target ||
          !text(target.fileId) ||
          !text(target.versionId) ||
          !digest(target.sha) ||
          !text(target.path)
        ) {
          intent.state = 'held'
          intent.reason = 'create adopted/collided or sponsor changed'
          continue
        }
        intent.deltas = intent.authorities.map((a) => ({
          done: false,
          value: {
            intentId: intent.id + ':' + a.grantId,
            grantId: a.grantId,
            expectedRevision: a.revision,
            target: {
              fileId: target.fileId,
              versionId: target.versionId,
              sha: target.sha,
              path: target.path,
            },
            sponsor: { fileId: sponsor.fileId, versionId: sponsor.versionId, sha: sponsor.sha },
            admissionGeneration: a.admissionGeneration,
            publicationGeneration: a.publicationGeneration,
            withdrawalGeneration: a.withdrawalGeneration,
          },
        }))
        intent.state = 'settled'
      }
      unit.settled = true
      unit.receiptSha = receiptSha
      await this.write(l)
    })
  }
  async retry(requestId: string): Promise<void> {
    this.fence()
    return this.serial(async () => {
      const l = await this.read(),
        unit = l.units.find((v) => v.unit.requestId === requestId)
      if (!unit) throw new Error('Missing publication unit; recovery required')
      for (const i of unit.intents) {
        if (i.state !== 'settled') continue
        for (const d of i.deltas ?? []) {
          if (d.done) continue
          const value = d.value
          const receipt = await this.port.lookup(copy(value))
          this.fence()
          if (receipt?.status === 'applied') {
            d.done = true
            await this.write(l)
            continue
          }
          const a = await this.port.inspect(
            value.grantId,
            value.target.fileId,
            value.sponsor.fileId
          )
          this.fence()
          if (
            !a.active ||
            a.grantId !== value.grantId ||
            a.admissionGeneration !== value.admissionGeneration ||
            a.publicationGeneration !== value.publicationGeneration ||
            a.withdrawalGeneration !== value.withdrawalGeneration ||
            a.targetFileId !== value.target.fileId ||
            a.targetVersionId !== value.target.versionId ||
            a.sponsorFileId !== value.sponsor.fileId ||
            a.sponsorVersionId !== value.sponsor.versionId
          ) {
            i.state = 'held'
            i.reason = 'withdrawal, identity, sponsor or authority changed'
            await this.write(l)
            break
          }
          // Before the FIRST send only, reconcile the current grant CAS after validating exact
          // target/sponsor/generation authority. Earlier deltas (or unrelated list edits) are not
          // whole-list replacement. Once attempted, the id/body stays immutable for lost replies.
          if (!d.attempted) {
            if (!Number.isSafeInteger(a.revision) || a.revision < value.expectedRevision)
              throw new Error('Publication CAS revision invalid')
            value.expectedRevision = a.revision
            d.attempted = true
          }
          await this.write(l)
          this.fence()
          const result = await this.port.apply(copy(value))
          this.fence()
          if (result.status !== 'applied') {
            i.state = 'held'
            i.reason = result.status
            await this.write(l)
            break
          }
          d.done = true
          await this.write(l)
        }
        if (i.state === 'settled' && i.deltas?.every((d) => d.done)) {
          i.state = 'published'
          await this.write(l)
        }
      }
    })
  }
}
