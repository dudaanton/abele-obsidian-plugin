import {
  normalizedSpelling,
  type KnownRename,
  type LinkFact,
  type LinkSnapshot,
  type SnapshotBinding,
} from './LinkSnapshotStore'
import {
  PublicationDecisionStore,
  existingExposureKey,
  existingPublicationQuestion,
  answerExistingPublication,
  type ExistingPublicationObservation,
  type ExistingPublicationQuestion,
  type ExistingPublicationDecision,
} from './publicationDecision'
import type { OwnerAdd } from '../sharing/sponsoredAssets'
/** Version comparison proposes a question, never permission. Only submitted LOCAL facts enter here. */
export function existingPrivateTargets(
  baseline: LinkSnapshot,
  local: LinkFact[],
  renames: KnownRename[]
): LinkFact[] {
  const old = baseline.kind === 'complete' ? baseline.facts : []
  const spellings = new Set(old.map((f) => normalizedSpelling(f.spelling)))
  const ids = new Set(old.flatMap((f) => (f.targetId ? [f.targetId] : [])))
  const paths = new Set(
    old.flatMap((f) =>
      [f.resolvedPath, f.spelling].filter((p): p is string => p !== null).map(normalizedSpelling)
    )
  )
  for (let n = 0; n < renames.length; n++)
    for (const r of renames)
      if (paths.has(normalizedSpelling(r.from))) paths.add(normalizedSpelling(r.to))
  const seen = new Set<string>()
  return local.filter((f) => {
    if (
      !f.targetId ||
      !f.resolvedPath ||
      f.resolution !== 'resolved' ||
      spellings.has(normalizedSpelling(f.spelling)) ||
      ids.has(f.targetId) ||
      paths.has(normalizedSpelling(f.resolvedPath)) ||
      seen.has(f.targetId)
    )
      return false
    seen.add(f.targetId)
    return true
  })
}
export interface ExistingPrivateCandidate {
  sponsorId: string
  targetId: string
  targetPath: string
}
export interface ExistingConfirmationPort {
  observe(
    candidate: ExistingPrivateCandidate,
    grantId: string
  ): Promise<ExistingPublicationObservation | null>
  add(request: OwnerAdd): Promise<unknown>
  held(): boolean
}
/** A separate queue: never awaited by personal settlement, never an upload hold. */
export class ExistingPrivateConfirmation {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly store: PublicationDecisionStore,
    private readonly binding: SnapshotBinding,
    private readonly grants: string[],
    private readonly port: ExistingConfirmationPort
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work)
    this.tail = next.catch(() => {})
    return next
  }
  async questions(): Promise<ExistingPublicationQuestion[]> {
    return (await this.store.existing(this.binding)).filter(
      (d) => d.state === 'pending' && !d.completed
    )
  }
  refresh(candidates: ExistingPrivateCandidate[]): Promise<void> {
    return this.serial(async () => {
      if (!this.port.held()) return
      for (const c of candidates)
        for (const grantId of this.grants) {
          const key = await existingExposureKey(this.binding, c.targetId, grantId)
          if (await this.store.getExisting(key)) continue
          const observation = await this.port.observe(c, grantId)
          if (!observation || !this.port.held()) continue
          const q = await existingPublicationQuestion(observation)
          if (q?.exposureKey === key) await this.store.rememberExisting({ ...q, state: 'pending' })
        }
      for (const d of await this.store.existing(this.binding))
        if (d.state === 'approved' && !d.completed) await this.deliver(d)
    })
  }
  private current(q: ExistingPublicationQuestion) {
    const o = q.observation
    return this.port.observe(
      { sponsorId: o.sponsor.fileId, targetId: o.target.fileId, targetPath: o.target.path },
      o.audience.grantId
    )
  }
  answer(q: ExistingPublicationQuestion, accepted: boolean): Promise<boolean> {
    return this.serial(async () => {
      if (!this.port.held()) return false
      const previous = await this.store.getExisting(q.exposureKey)
      if (previous?.state !== 'pending' || previous.fingerprint !== q.fingerprint) return false
      const current = await this.current(q)
      if (!current || !this.port.held()) return false
      const decision = await answerExistingPublication(q, current, accepted)
      if (!decision) return false
      if (accepted) decision.request = this.request(decision)
      await this.store.rememberExisting(decision)
      if (accepted) await this.deliver(decision)
      return true
    })
  }
  private request(
    d: ExistingPublicationDecision,
    intentId: string = crypto.randomUUID()
  ): OwnerAdd {
    const o = d.observation
    return {
      grantId: o.audience.grantId,
      expectedRevision: o.audience.revision,
      withdrawalGeneration: o.audience.withdrawalGeneration,
      intentId,
      decisionDeviceId: this.binding.principal,
      target: o.target,
      sponsors: [
        {
          fileId: o.sponsor.fileId,
          versionId: o.sponsor.versionId,
          admissionGeneration: o.sponsor.admissionGeneration,
          inScope: true,
          intrinsic: true,
        },
      ],
      reason: 'confirmed-existing',
    }
  }
  private async deliver(d: ExistingPublicationDecision) {
    if (!this.port.held()) return
    if (
      d.request &&
      JSON.stringify(d.request) !== JSON.stringify(this.request(d, d.request.intentId))
    )
      throw new Error('Stored existing-private request differs from its approved observation')
    const current = await this.current(d)
    if (!this.port.held()) return
    // A lost successful reply may have made the target visible and advanced revision.
    // Retry ONLY the stored request, never mint a new operation or repeat baseline novelty.
    const valid =
      current &&
      (await answerExistingPublication(
        d,
        { ...current, audience: { ...current.audience, alreadyShared: false } },
        true
      ))
    if (valid) {
      if (!d.request) {
        d.request = this.request(d)
        await this.store.rememberExisting(d)
      }
      if (!this.port.held()) return
      await this.port.add(d.request)
    }
    if (!this.port.held()) return
    d.completed = true
    await this.store.rememberExisting(d)
  }
}
