import { sha256 } from '@abele/sync-core'
import type { OwnerAdd, Sponsor, Target } from '../sharing/sponsoredAssets'
import {
  bindingKey,
  normalizedSpelling,
  type CompleteSnapshot,
  type KnownRename,
  type LinkSnapshot,
  type SnapshotBinding,
  type SnapshotMeta,
} from './LinkSnapshotStore'

export interface ExistingPublicationObservation {
  binding: SnapshotBinding
  target: Target
  sponsor: Sponsor & { path: string }
  audience: {
    grantId: string
    label: string
    active: boolean
    alreadyShared: boolean
    revision: number
    withdrawalGeneration: number
  }
  linked: boolean
}
export interface ExistingPublicationQuestion {
  exposureKey: string
  fingerprint: string
  observation: ExistingPublicationObservation
}
export interface ExistingPublicationDecision extends ExistingPublicationQuestion {
  state: ExposureDecision['state']
  request?: OwnerAdd
  completed?: boolean
}
/** Identity of an answer, independent of bytes, sponsor, generation, or the audience set. */
export const existingExposureKey = (binding: SnapshotBinding, targetId: string, grantId: string) =>
  hash([bindingKey(binding), targetId, grantId])

/** Only the separate existing-private path can ask without paste-specific link provenance. */
export async function existingPublicationQuestion(
  observation: ExistingPublicationObservation,
  previous?: ExistingPublicationDecision | null
): Promise<ExistingPublicationQuestion | null> {
  const o = clone(observation),
    a = o.audience,
    s = o.sponsor,
    t = o.target
  if (
    o.binding.facet !== 'personal' ||
    o.binding.grantId !== null ||
    !o.linked ||
    !t.fileId ||
    !t.versionId ||
    !digest(t.sha) ||
    !t.eligible ||
    !t.path ||
    !s.fileId ||
    !s.versionId ||
    !s.intrinsic ||
    !s.inScope ||
    !Number.isSafeInteger(s.admissionGeneration) ||
    s.admissionGeneration < 1 ||
    !a.grantId ||
    !a.label ||
    !a.active ||
    a.alreadyShared ||
    !Number.isSafeInteger(a.revision) ||
    a.revision < 0 ||
    !Number.isSafeInteger(a.withdrawalGeneration) ||
    a.withdrawalGeneration < 0
  )
    return null
  const exposureKey = await existingExposureKey(o.binding, t.fileId, a.grantId)
  if (previous?.exposureKey === exposureKey) return null
  const fingerprint = await hash([
    exposureKey,
    t,
    s.fileId,
    s.admissionGeneration,
    a.label,
    a.withdrawalGeneration,
  ])
  return { exposureKey, fingerprint, observation: o }
}
/** Revalidate current link/target/authority, not novelty against the already advanced baseline. */
export async function answerExistingPublication(
  question: ExistingPublicationQuestion,
  current: ExistingPublicationObservation,
  accepted: boolean
): Promise<ExistingPublicationDecision | null> {
  const fresh = await existingPublicationQuestion(current)
  if (
    !fresh ||
    fresh.exposureKey !== question.exposureKey ||
    fresh.fingerprint !== question.fingerprint
  )
    return null
  return { ...fresh, state: accepted ? 'approved' : 'declined' }
}
export interface LocalNoteBase {
  kind: 'local-create'
  binding: SnapshotBinding
  noteId: string
  handle: string
  pending: boolean
  hasLedgerIdentity: boolean
}
export interface PublicationTarget {
  id: string | null
  path: string
  sha: string
  versionId: string | null
  security: 'eligible' | 'script' | 'settings' | 'unknown'
  creator:
    | 'pending-local-create'
    | 'existing-private'
    | 'received'
    | 'restored'
    | 'renamed'
    | 'unknown'
  create?: { handle: string; installation: string; pending: boolean; hasLedgerIdentity: boolean }
}
export interface PublicationAudience {
  grantId: string
  active: boolean
  sponsorId: string
  admissionGeneration: number
  publicationGeneration: number
  withdrawalGeneration: number
  alreadyShared: boolean
  withdrawn: boolean
}
export interface OwnerEdit {
  kind:
    | 'owner-edit'
    | 'owner-create'
    | 'received'
    | 'restore'
    | 'merge'
    | 'linter'
    | 'rename-rewrite'
    | 'unknown'
  noteId: string
  sourceSha: string
  cacheGeneration: string
  baseVersionId: string | null
  baseCreateHandle?: string
}
export interface ExposureDecision {
  exposureKey: string
  fingerprint: string
  state: 'pending' | 'declined' | 'approved'
}
export interface PublicationInput {
  binding: SnapshotBinding
  baseline: LinkSnapshot | LocalNoteBase
  current: CompleteSnapshot
  owner: OwnerEdit
  target: PublicationTarget
  audiences: PublicationAudience[]
  knownRenames: { complete: boolean; items: KnownRename[] }
  decisions: ExposureDecision[]
  /** Availability from this client's authorized inventory only; no private metadata lookup. */
  availableTargetIds?: string[]
}
export interface PublicationProposal {
  kind: 'confirm' | 'auto-intent' | 'sponsor-intent' | 'confirmed-intent'
  exposureKey: string
  fingerprint: string
  targetRef: string
  targetPath: string
  targetVersion: string | null
  targetSha: string
  audiences: string[]
  sponsors: string[]
  requiresPassword: false
  mustPersistBeforeUpload: true
}
export interface PublicationHold {
  kind: 'hold' | 'none' | 'refuse'
  reason: string
  missingReferences: { known: boolean; count?: number }
}
export type PublicationResult = PublicationProposal | PublicationHold
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
const pathKey = (s: string) => s.normalize('NFC').toLowerCase()
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
function currentProven(i: PublicationInput): boolean {
  const c = i.current,
    e = c.evidence
  return (
    c.kind === 'complete' &&
    bindingKey(c.binding) === bindingKey(i.binding) &&
    e?.complete === true &&
    e.noteId === c.noteId &&
    e.versionId === c.versionId &&
    e.sourceSha === c.sha &&
    digest(c.sha) &&
    !!e.generation &&
    Array.isArray(c.facts) &&
    c.facts.every((f) => f.resolution === 'resolved' || f.resolution === 'unresolved')
  )
}
function missing(i: PublicationInput): PublicationHold['missingReferences'] {
  if (!currentProven(i) || !i.availableTargetIds) return { known: false }
  const available = new Set(i.availableTargetIds)
  return {
    known: true,
    count: new Set(
      i.current.facts
        .filter((f) => !f.targetId || !available.has(f.targetId))
        .map((f) => normalizedSpelling(f.spelling))
    ).size,
  }
}
/** Pure R1/R2 contract reducer. A proposal is NEVER a list mutation or upload permission. */
export async function reducePublication(input: PublicationInput): Promise<PublicationResult> {
  const i = clone(input),
    info = missing(i)
  const stop = (kind: PublicationHold['kind'], reason: string): PublicationHold => ({
    kind,
    reason,
    missingReferences: info,
  })
  if (i.binding.facet !== 'personal' || i.binding.grantId !== null)
    return stop('refuse', 'scoped connections refuse owner publication')
  if (!currentProven(i) || !i.knownRenames.complete)
    return stop('hold', 'unproven current cache or rename evidence')
  if (!['owner-edit', 'owner-create'].includes(i.owner.kind))
    return stop('hold', 'not a proven deliberate owner addition')
  if (
    i.owner.noteId !== i.current.noteId ||
    i.owner.sourceSha !== i.current.sha ||
    i.owner.cacheGeneration !== i.current.evidence.generation
  )
    return stop('hold', 'owner observation advanced or changed')
  let facts: CompleteSnapshot['facts']
  if (i.baseline.kind === 'complete') {
    if (
      bindingKey(i.baseline.binding) !== bindingKey(i.binding) ||
      i.baseline.noteId !== i.current.noteId ||
      !i.baseline.evidence.complete ||
      i.baseline.evidence.noteId !== i.baseline.noteId ||
      i.baseline.evidence.versionId !== i.baseline.versionId ||
      i.baseline.evidence.sourceSha !== i.baseline.sha ||
      !digest(i.baseline.sha) ||
      i.baseline.facts.some((f) => !['resolved', 'unresolved'].includes(f.resolution)) ||
      i.owner.baseVersionId !== i.baseline.versionId
    )
      return stop('hold', 'baseline binding or version changed')
    facts = i.baseline.facts
  } else if (i.baseline.kind === 'local-create') {
    if (
      i.owner.kind !== 'owner-create' ||
      bindingKey(i.baseline.binding) !== bindingKey(i.binding) ||
      i.baseline.noteId !== i.current.noteId ||
      !i.baseline.pending ||
      i.baseline.hasLedgerIdentity ||
      i.owner.baseCreateHandle !== i.baseline.handle ||
      i.owner.baseVersionId !== null
    )
      return stop('hold', 'unproven empty local-create base')
    facts = []
  } else return stop('hold', 'missing or unknown baseline')
  const target = i.target
  if (target.security === 'script' || target.security === 'settings')
    return stop('refuse', 'code and settings are excluded, including renamed known code')
  if (target.security !== 'eligible' || !digest(target.sha))
    return stop('hold', 'target eligibility or bytes unknown')
  const links = i.current.facts.filter(
    (f) => f.resolvedPath !== null && pathKey(f.resolvedPath) === pathKey(target.path)
  )
  if (!links.length)
    return stop(
      'none',
      'target is not currently referenced; do not withdraw an existing publication'
    )
  if (
    links.some(
      (f) => f.resolution !== 'resolved' || (f.targetId !== null && f.targetId !== target.id)
    )
  )
    return stop('hold', 'target resolution or identity is ambiguous')
  const oldSpellings = new Set(facts.map((f) => normalizedSpelling(f.spelling)))
  const oldIds = new Set(facts.flatMap((f) => (f.targetId ? [f.targetId] : [])))
  const oldPaths = new Set(facts.flatMap((f) => (f.resolvedPath ? [pathKey(f.resolvedPath)] : [])))
  // Follow only identity-proven rename edges. Never rewrite the immutable baseline itself.
  const aliases = new Set(oldPaths)
  for (let n = 0; n < i.knownRenames.items.length; n++)
    for (const rename of i.knownRenames.items) {
      if (aliases.has(pathKey(rename.from)) && (target.id === null || rename.fileId === target.id))
        aliases.add(pathKey(rename.to))
    }
  const newSpelling = links.some((f) => !oldSpellings.has(normalizedSpelling(f.spelling)))
  const newTarget =
    (target.id === null || !oldIds.has(target.id)) && !aliases.has(pathKey(target.path))
  if (!newSpelling || !newTarget) return stop('none', 'link or target already in baseline')
  const oldLinkIds = new Set(
    facts.flatMap((f) => (f.provenance?.linkId ? [f.provenance.linkId] : []))
  )
  // Note-wide owner-edit is not link authorship: a moved note can rewrite received unresolved
  // spellings before an unrelated owner body edit. Only a fresh, individually proven addition
  // may authorize this target. Missing/legacy link lineage is deliberately a hold.
  const ownerLinks = links.filter((f) => {
    const p = f.provenance
    return (
      !oldSpellings.has(normalizedSpelling(f.spelling)) &&
      p?.origin === 'owner-added' &&
      typeof p.linkId === 'string' &&
      p.linkId.length > 0 &&
      p.linkId.length <= 4096 &&
      typeof p.proofId === 'string' &&
      p.proofId.length > 0 &&
      p.proofId.length <= 4096 &&
      !oldLinkIds.has(p.linkId) &&
      p.noteId === i.current.noteId &&
      p.sourceSha === i.current.sha &&
      p.cacheGeneration === i.current.evidence.generation
    )
  })
  if (!ownerLinks.length)
    return stop('hold', 'individual link introduction is not proven owner-added')
  if (
    !i.audiences.length ||
    i.audiences.some(
      (a) =>
        !a.active ||
        a.sponsorId !== i.current.noteId ||
        !a.grantId ||
        !Number.isSafeInteger(a.admissionGeneration) ||
        a.admissionGeneration < 1 ||
        !Number.isSafeInteger(a.publicationGeneration) ||
        a.publicationGeneration < 0 ||
        !Number.isSafeInteger(a.withdrawalGeneration) ||
        a.withdrawalGeneration < 0
    )
  )
    return stop('hold', 'sponsor admission or audience is unknown/revoked')
  if (i.audiences.some((a) => a.withdrawn))
    return stop('hold', 'withdrawal requires an explicit new settings decision')
  if (new Set(i.audiences.map((a) => a.grantId)).size !== i.audiences.length)
    return stop('hold', 'duplicate or inconsistent audience evidence')
  const pending = target.creator === 'pending-local-create'
  if (pending) {
    if (
      target.id !== null ||
      target.versionId !== null ||
      !target.create?.handle ||
      target.create.installation !== i.binding.localVault ||
      !target.create.pending ||
      target.create.hasLedgerIdentity
    )
      return stop('hold', 'create settled/adopted or novelty is unproven')
  } else if (target.creator !== 'existing-private' || !target.id || !target.versionId)
    return stop('hold', 'creator is received/restored/renamed or unknown')
  const audiences = [...i.audiences].sort((a, b) =>
    a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0
  )
  const targetRef = pending ? 'create:' + target.create.handle : 'file:' + target.id
  // Exposure identity excludes note body resaves, avoiding repeated declined/pending prompts.
  const exposureKey = await hash([
    bindingKey(i.binding),
    targetRef,
    target.versionId,
    target.sha,
    audiences.map((a) => [
      a.grantId,
      a.admissionGeneration,
      a.publicationGeneration,
      a.withdrawalGeneration,
    ]),
  ])
  // Open-dialog freshness is stricter than persistent exposure identity.
  const fingerprint = await hash([
    exposureKey,
    i.current.noteId,
    i.current.sha,
    i.current.evidence.generation,
    i.current.evidence.cacheSha,
    target.path,
    ownerLinks.map((f) => [
      f.provenance!.linkId,
      f.provenance!.proofId,
      f.spelling,
      f.start,
      f.end,
    ]),
    i.owner.baseVersionId,
    i.owner.baseCreateHandle ?? null,
    audiences.map((a) => [a.sponsorId, a.admissionGeneration]),
  ])
  const common = {
    exposureKey,
    fingerprint,
    targetRef,
    targetPath: target.path,
    targetVersion: target.versionId,
    targetSha: target.sha,
    audiences: audiences.map((a) => a.grantId),
    sponsors: [...new Set(audiences.map((a) => a.sponsorId))],
    requiresPassword: false as const,
    mustPersistBeforeUpload: true as const,
  }
  const previous = i.decisions.find((d) => d.exposureKey === exposureKey)
  if (previous) {
    if (previous.state === 'approved' && previous.fingerprint === fingerprint)
      return { kind: 'confirmed-intent', ...common }
    return stop(
      'hold',
      previous.state === 'approved'
        ? 'approved observation changed'
        : 'exposure decision is already pending or declined'
    )
  }
  if (audiences.every((a) => a.alreadyShared)) return { kind: 'sponsor-intent', ...common }
  return { kind: pending ? 'auto-intent' : 'confirm', ...common }
}
/** Must run at acceptance, never trust the proposal captured when a dialog opened. */
export async function answerPublication(
  proposal: PublicationProposal,
  current: PublicationInput,
  accepted: boolean
): Promise<PublicationResult> {
  const fresh = await reducePublication({ ...clone(current), decisions: [] })
  if (
    fresh.kind !== 'confirm' ||
    fresh.exposureKey !== proposal.exposureKey ||
    fresh.fingerprint !== proposal.fingerprint
  )
    return {
      kind: 'hold',
      reason: 'confirmation identity/version/audience changed',
      missingReferences: missing(current),
    }
  if (!accepted)
    return {
      kind: 'hold',
      reason: 'exposure declined; persist this exact decision',
      missingReferences: missing(current),
    }
  return { ...fresh, kind: 'confirmed-intent' }
}
/** Durable prompt decisions only; publication intent/receipt integration belongs to task 41. */
export class PublicationDecisionStore {
  constructor(private readonly meta: SnapshotMeta) {}
  async remember(proposal: PublicationProposal, state: ExposureDecision['state']): Promise<void> {
    if (
      !digest(proposal.exposureKey) ||
      !digest(proposal.fingerprint) ||
      (state === 'approved' && proposal.kind !== 'confirmed-intent')
    )
      throw new Error('Exact revalidated exposure decision is required')
    const value: ExposureDecision = {
      exposureKey: proposal.exposureKey,
      fingerprint: proposal.fingerprint,
      state,
    }
    const encoded = JSON.stringify(value),
      key = 'publication-decision-v1:' + value.exposureKey
    await this.meta.setMeta(key, encoded)
    if ((await this.meta.getMeta(key)) !== encoded)
      throw new Error('Publication decision was not persisted; recovery required')
  }
  async rememberExisting(decision: ExistingPublicationDecision): Promise<void> {
    const d = clone(decision),
      o = d.observation
    if (
      d.exposureKey !==
        (await existingExposureKey(o.binding, o.target.fileId, o.audience.grantId)) ||
      !digest(d.fingerprint) ||
      !['pending', 'declined', 'approved'].includes(d.state)
    )
      throw new Error('Exact existing-private decision identity is required')
    const prefix = 'existing-publication-v1:' + bindingKey(o.binding) + ':'
    const raw = await this.meta.getMeta(prefix + 'index')
    const keys = raw === null ? [] : (JSON.parse(raw) as string[])
    if (!keys.includes(d.exposureKey)) keys.push(d.exposureKey)
    // Index first: a crash may leave a missing question, never an unindexed send request.
    const index = JSON.stringify(keys)
    await this.meta.setMeta(prefix + 'index', index)
    if ((await this.meta.getMeta(prefix + 'index')) !== index)
      throw new Error('Existing-private pending index was not persisted')
    const encoded = JSON.stringify(d),
      key = 'existing-publication-decision-v1:' + d.exposureKey
    await this.meta.setMeta(key, encoded)
    if ((await this.meta.getMeta(key)) !== encoded)
      throw new Error('Existing-private decision was not persisted')
  }
  async getExisting(exposureKey: string): Promise<ExistingPublicationDecision | null> {
    const raw = await this.meta.getMeta('existing-publication-decision-v1:' + exposureKey)
    if (raw === null) return null
    const d = JSON.parse(raw) as ExistingPublicationDecision
    if (
      d.exposureKey !== exposureKey ||
      !digest(d.fingerprint) ||
      !['pending', 'declined', 'approved'].includes(d.state) ||
      d.exposureKey !==
        (await existingExposureKey(
          d.observation.binding,
          d.observation.target.fileId,
          d.observation.audience.grantId
        ))
    )
      throw new Error('Existing-private decision is unreadable; recovery required')
    return clone(d)
  }
  async existing(binding: SnapshotBinding): Promise<ExistingPublicationDecision[]> {
    const raw = await this.meta.getMeta('existing-publication-v1:' + bindingKey(binding) + ':index')
    const keys = raw === null ? [] : (JSON.parse(raw) as string[])
    const decisions = await Promise.all(keys.map((k) => this.getExisting(k)))
    return decisions.filter((d): d is ExistingPublicationDecision => d !== null)
  }
  async get(exposureKey: string): Promise<ExposureDecision | null> {
    const raw = await this.meta.getMeta('publication-decision-v1:' + exposureKey)
    if (raw === null) return null
    let value: ExposureDecision
    try {
      value = JSON.parse(raw) as ExposureDecision
    } catch {
      throw new Error('Publication decision is unreadable; recovery required')
    }
    if (
      !value ||
      value.exposureKey !== exposureKey ||
      !digest(value.fingerprint) ||
      !['pending', 'declined', 'approved'].includes(value.state)
    )
      throw new Error('Publication decision is unreadable; recovery required')
    return clone(value)
  }
}
