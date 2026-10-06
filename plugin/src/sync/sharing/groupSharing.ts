import { sha256 } from '@abele/sync-core'
import type { SnapshotMeta } from '../publication/LinkSnapshotStore'
import { OWNER_SHARING_ENABLED, type OwnerSession } from './folderSharing'
import type { OwnerAdd, AssetView, Target, Sponsor } from './sponsoredAssets'
export interface GroupNote {
  fileId: string
  versionId: string
  sha: string
  path: string
  eligible: boolean
}
export interface GroupRelation {
  sourceId: string
  sourceVersion: string
  targetId: string
  targetVersion: string
  tokenKey: string
  anchor: boolean
}
export interface GroupPreview {
  root: GroupNote
  generation: string
  complete: boolean
  certified: boolean
  notes: GroupNote[]
  anchors: GroupNote[]
  relations: GroupRelation[]
  uncertain: string[]
}
export interface GroupReview {
  id: string
  label: string
  role: 'reader' | 'editor'
  preview: GroupPreview
  fingerprint: string
}
export interface GroupGrant {
  preparation?: import('./grantPreparation').GrantPreparation
  id: string
  rootId: string
  rootVersion: string
  role: 'reader' | 'editor'
  revision: number
  state: string
}
export interface GroupApprovalReceipt {
  approvalId: string
  grantId: string
  expectedRevision: number
  revision: number
}
export interface GroupSharingPort {
  preview(rootId: string): Promise<GroupPreview>
  authorize(password: string, email?: string): Promise<OwnerSession>
  create(
    session: OwnerSession,
    input: { label: string; rootId: string; rootVersion: string; role: 'reader' | 'editor' }
  ): Promise<GroupGrant>
  prepare?(session: OwnerSession, grant: GroupGrant): Promise<GroupGrant>
  certified(grant: GroupGrant): Promise<boolean>
  approve(
    session: OwnerSession,
    grant: GroupGrant,
    relation: GroupRelation
  ): Promise<GroupApprovalReceipt>
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const validNote = (n: GroupNote) =>
  !!n.fileId && !!n.versionId && /^[a-f0-9]{64}$/.test(n.sha) && !!n.path && n.eligible
/** Certified server-owned membership facts, not a whole-vault frontmatter parser or basename guess. */
export class GroupSharingFlow {
  private generation = 0
  private shown: GroupReview | null = null
  private session: OwnerSession | null = null
  private grant: GroupGrant | null = null
  private approvedRelations = new Set<string>()
  private busy = false
  constructor(
    readonly vaultId: string,
    private readonly port: GroupSharingPort,
    private readonly enabled: () => boolean = () => OWNER_SHARING_ENABLED,
    private readonly now: () => number = () => Date.now()
  ) {}
  private fence(g?: number) {
    if (!this.enabled()) throw new Error('Group sharing is disabled')
    if (g !== undefined && g !== this.generation)
      throw new Error('Group review closed or superseded')
  }
  async review(rootId: string, role: 'reader' | 'editor', label: string): Promise<GroupReview> {
    this.fence()
    this.close()
    const generation = this.generation,
      p = copy(await this.port.preview(rootId))
    this.fence(generation)
    if (
      !rootId ||
      p.root.fileId !== rootId ||
      !validNote(p.root) ||
      !p.complete ||
      !p.certified ||
      !p.generation ||
      p.uncertain.length ||
      p.notes.length > 1000 ||
      p.anchors.length > 64 ||
      p.relations.length > 1000 ||
      ![...p.notes, ...p.anchors].every(validNote)
    )
      throw new Error('Complete certified root/anchor preview required')
    if (!['reader', 'editor'].includes(role) || !label.trim() || label.length > 200)
      throw new Error('Invalid group label/role')
    const notes = new Map([p.root, ...p.notes, ...p.anchors].map((n) => [n.fileId, n]))
    if (
      p.relations.some(
        (r) =>
          !notes.has(r.sourceId) ||
          !notes.has(r.targetId) ||
          notes.get(r.sourceId).versionId !== r.sourceVersion ||
          notes.get(r.targetId).versionId !== r.targetVersion ||
          !r.tokenKey ||
          r.tokenKey.length > 1024 ||
          !(r.targetId === p.root.fileId || p.anchors.some((a) => a.fileId === r.targetId))
      )
    )
      throw new Error('Relation/anchor identity is uncertain')
    const result = {
      id: crypto.randomUUID(),
      label: label.trim(),
      role,
      preview: p,
      fingerprint: await hash(p),
    }
    this.fence(generation)
    this.shown = copy(result)
    return copy(result)
  }
  private exact(shown: GroupReview) {
    if (!this.shown || !equal(shown, this.shown))
      throw new Error('Exact displayed group/root review required')
  }
  async confirm(shown: GroupReview, password: string, email?: string): Promise<GroupGrant> {
    this.fence()
    this.exact(shown)
    if (this.busy) throw new Error('Group confirmation already running')
    this.busy = true
    const generation = this.generation
    try {
      if (!this.session) {
        const s = await this.port.authorize(password, email)
        this.fence(generation)
        if (
          s.facet !== 'account' ||
          s.ownerVaultId !== this.vaultId ||
          !Number.isFinite(s.authenticatedAt) ||
          !Number.isFinite(s.expiresAt) ||
          s.authenticatedAt > this.now() ||
          this.now() - s.authenticatedAt >= 300000 ||
          s.expiresAt <= this.now()
        )
          throw new Error('Fresh vault-owner authentication required')
        this.session = s
      }
      const p = await this.port.preview(shown.preview.root.fileId)
      this.fence(generation)
      if ((await hash(p)) !== shown.fingerprint) throw new Error('Group/root preview changed')
      this.fence(generation)
      if (!this.grant) {
        const g = await this.port.create(this.session, {
          label: shown.label,
          rootId: p.root.fileId,
          rootVersion: p.root.versionId,
          role: shown.role,
        })
        this.fence(generation)
        if (
          !g.id ||
          g.rootId !== p.root.fileId ||
          g.rootVersion !== p.root.versionId ||
          g.role !== shown.role ||
          !Number.isSafeInteger(g.revision) ||
          g.revision < 0
        )
          throw new Error('Group grant differs from reviewed root/rights')
        this.grant = copy(g)
      }
      if (this.grant.state === 'preparing' && this.grant.preparation) {
        if (!this.port.prepare) throw new Error('Group preparation must be retried')
        const prepared = await this.port.prepare(this.session, copy(this.grant))
        this.fence(generation)
        if (
          prepared.id !== this.grant.id ||
          prepared.revision !== this.grant.revision ||
          prepared.rootId !== this.grant.rootId ||
          prepared.rootVersion !== this.grant.rootVersion ||
          prepared.role !== this.grant.role
        )
          throw new Error('Group preparation identity changed')
        this.grant = prepared
        if (prepared.state !== 'active')
          throw new Error('Group preparing; retry preparation, not creation')
      }
      return copy(this.grant)
    } finally {
      this.busy = false
    }
  }
  async approveRelations(shown: GroupReview): Promise<void> {
    this.fence()
    this.exact(shown)
    if (!this.session || !this.grant) throw new Error('Create the reviewed group first')
    if (this.busy) throw new Error('Group approval already running')
    this.busy = true
    const generation = this.generation
    try {
      if (!(await this.port.certified(copy(this.grant))))
        throw new Error('Group scope preparing; approval held')
      this.fence(generation)
      const current = await this.port.preview(shown.preview.root.fileId)
      this.fence(generation)
      if ((await hash(current)) !== shown.fingerprint) throw new Error('Approval preview changed')
      this.fence(generation)
      for (const relation of shown.preview.relations) {
        const key = JSON.stringify(relation)
        if (this.approvedRelations.has(key)) continue
        this.fence(generation)
        const before = copy(this.grant),
          receipt = await this.port.approve(this.session, before, copy(relation))
        this.fence(generation)
        if (
          !receipt?.approvalId ||
          receipt.grantId !== before.id ||
          receipt.expectedRevision !== before.revision ||
          receipt.revision !== before.revision + 1
        )
          throw new Error('Group approval receipt uncertain; recovery required')
        this.grant = { ...before, revision: receipt.revision }
        this.approvedRelations.add(key)
      }
    } finally {
      this.busy = false
    }
  }
  close() {
    this.generation++
    this.shown = null
    this.session = null
    this.grant = null
    this.approvedRelations.clear()
  }
}
export interface BatchEntry {
  target: Target
  sponsors: Sponsor[]
  reason: 'initial-batch'
}
export interface BatchReview {
  id: string
  entries: BatchEntry[]
  audiences: { grantId: string; revision: number; withdrawalGeneration: number }[]
}
export interface InitialBatchPort {
  view(grantId: string): Promise<AssetView>
  target(fileId: string): Promise<Target>
  sponsors(grantId: string, sponsorIds: string[]): Promise<Sponsor[]>
  lookup(request: OwnerAdd): Promise<boolean>
  add(request: OwnerAdd): Promise<AssetView>
}
interface BatchJournal {
  version: 1
  review: BatchReview
  owner: { vaultId: string; principal: string }
  operations: { id: string; grantId: string; entry: number; request?: OwnerAdd; done: boolean }[]
}
/** Manual existing-file batch is explicit per audience; immutable requests are durable before send. */
export class InitialAssetBatch {
  private shown: BatchReview | null = null
  private readonly expectedJournals = new Set<string>()
  private generation = 0
  private busy = false
  constructor(
    private readonly meta: SnapshotMeta,
    private readonly owner: { vaultId: string; principal: string },
    private readonly port: InitialBatchPort,
    private readonly enabled: () => boolean = () => OWNER_SHARING_ENABLED
  ) {}
  private fence(g?: number) {
    if (!this.enabled()) throw new Error('Initial asset publication is disabled')
    if (g !== undefined && g !== this.generation)
      throw new Error('Initial batch review closed or changed')
  }
  private async write(j: BatchJournal) {
    this.fence()
    const value = JSON.stringify({ journal: j, checksum: await hash(j) })
    if (value.length > 1024 * 1024) throw new Error('Initial batch journal budget reached')
    if (this.expectedJournals.has(j.review.id) && !(await this.read(j.review.id)))
      throw new Error('Missing retained initial batch journal; recovery required')
    // Also remember an uncertain first persistence attempt; retries never mint replacement IDs.
    this.expectedJournals.add(j.review.id)
    await this.meta.setMeta('initial-asset-batch-v1:' + j.review.id, value)
    if ((await this.meta.getMeta('initial-asset-batch-v1:' + j.review.id)) !== value)
      throw new Error('Initial batch journal was not persisted')
  }
  private async read(id: string): Promise<BatchJournal | null> {
    const raw = await this.meta.getMeta('initial-asset-batch-v1:' + id)
    if (raw === null) return null
    try {
      const e = JSON.parse(raw)
      if (
        e.journal.version !== 1 ||
        e.journal.review.id !== id ||
        !equal(e.journal.owner, this.owner) ||
        (await hash(e.journal)) !== e.checksum
      )
        throw new Error()
      return e.journal
    } catch {
      throw new Error('Initial batch unreadable; recovery required')
    }
  }
  async review(entries: BatchEntry[], audiences: string[]): Promise<BatchReview> {
    this.fence()
    this.close()
    const generation = this.generation,
      selected = copy(entries)
    if (
      !selected.length ||
      selected.length > 64 ||
      !audiences.length ||
      audiences.length > 16 ||
      new Set(audiences).size !== audiences.length ||
      new Set(selected.map((e) => e.target.fileId)).size !== selected.length
    )
      throw new Error('Bounded distinct entries/audiences required')
    for (const e of selected)
      if (
        !e.target.eligible ||
        !e.target.fileId ||
        !e.target.versionId ||
        !e.target.path ||
        !/^[a-f0-9]{64}$/.test(e.target.sha) ||
        !e.sponsors.length ||
        e.sponsors.some(
          (s) =>
            !s.inScope ||
            !s.intrinsic ||
            !s.fileId ||
            !s.versionId ||
            !Number.isSafeInteger(s.admissionGeneration) ||
            s.admissionGeneration < 1
        )
      )
        throw new Error('Exact eligible target and intrinsic sponsor evidence required')
    const views = []
    for (const grantId of audiences) {
      const v = await this.port.view(grantId)
      this.fence(generation)
      if (!v.active || v.grantId !== grantId) throw new Error('Current audience unavailable')
      views.push({ grantId, revision: v.revision, withdrawalGeneration: v.withdrawalGeneration })
    }
    const result = { id: crypto.randomUUID(), entries: selected, audiences: views }
    this.shown = copy(result)
    return copy(result)
  }
  async resume(id: string): Promise<BatchReview> {
    this.fence()
    const generation = this.generation,
      j = await this.read(id)
    this.fence(generation)
    if (!j) throw new Error('Missing initial batch journal; recovery required')
    this.expectedJournals.add(id)
    this.shown = copy(j.review)
    return copy(j.review)
  }
  async confirm(shown: BatchReview): Promise<void> {
    this.fence()
    if (!this.shown || !equal(shown, this.shown))
      throw new Error('Review exact batch/audiences first')
    if (this.busy) throw new Error('Initial batch already running')
    this.busy = true
    const generation = this.generation
    try {
      let j = await this.read(shown.id)
      this.fence(generation)
      if (j) this.expectedJournals.add(shown.id)
      else if (this.expectedJournals.has(shown.id))
        throw new Error('Missing retained initial batch journal; recovery required')
      if (!j) {
        // Preflight ALL targets/audiences before the first mutation; never partial stale acceptance.
        for (const e of shown.entries) {
          if (!equal(await this.port.target(e.target.fileId), e.target))
            throw new Error('Initial target identity/version changed')
          for (const a of shown.audiences) {
            const v = await this.port.view(a.grantId)
            this.fence(generation)
            if (
              !v.active ||
              v.withdrawalGeneration !== a.withdrawalGeneration ||
              !equal(
                await this.port.sponsors(
                  a.grantId,
                  e.sponsors.map((s) => s.fileId)
                ),
                e.sponsors
              )
            )
              throw new Error('Audience/sponsor/withdrawal changed')
          }
        }
        j = {
          version: 1,
          review: copy(shown),
          owner: copy(this.owner),
          operations: shown.audiences.flatMap((a) =>
            shown.entries.map((_e, index) => ({
              id: crypto.randomUUID(),
              grantId: a.grantId,
              entry: index,
              done: false,
            }))
          ),
        }
        await this.write(j)
      }
      for (const op of j.operations) {
        if (op.done) continue
        this.fence(generation)
        const e = j.review.entries[op.entry],
          a = j.review.audiences.find((a) => a.grantId === op.grantId)
        if (op.request && (await this.port.lookup(copy(op.request)))) {
          op.done = true
          await this.write(j)
          continue
        }
        const v = await this.port.view(op.grantId)
        this.fence(generation)
        if (
          !v.active ||
          v.withdrawalGeneration !== a.withdrawalGeneration ||
          !equal(await this.port.target(e.target.fileId), e.target) ||
          !equal(
            await this.port.sponsors(
              op.grantId,
              e.sponsors.map((s) => s.fileId)
            ),
            e.sponsors
          )
        )
          throw new Error('Initial batch authority/identity changed')
        if (!op.request) {
          op.request = {
            grantId: op.grantId,
            expectedRevision: v.revision,
            withdrawalGeneration: v.withdrawalGeneration,
            intentId: op.id,
            decisionDeviceId: this.owner.principal,
            target: copy(e.target),
            sponsors: copy(e.sponsors),
            reason: 'initial-batch',
          }
          await this.write(j)
        }
        this.fence(generation)
        const durable = await this.read(shown.id)
        this.fence(generation)
        if (!durable || !equal(durable, j))
          throw new Error('Initial batch journal missing or changed; recovery required')
        const result = await this.port.add(copy(op.request))
        this.fence(generation)
        if (result.grantId !== op.grantId) throw new Error('Batch response audience differs')
        op.done = true
        await this.write(j)
      }
    } finally {
      this.busy = false
    }
  }
  close() {
    this.generation++
    this.shown = null
  }
}
