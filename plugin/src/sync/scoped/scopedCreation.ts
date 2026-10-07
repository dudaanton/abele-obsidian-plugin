import { sha256 } from '@abele/sync-core'
import type { SnapshotMeta } from '../publication/LinkSnapshotStore'
export const SCOPED_CREATION_ENABLED = true
export interface ApprovedRoot {
  fileId: string
  versionId: string
  label: string
  spelling: string
  approved: boolean
}
export interface NativeSponsor {
  fileId: string
  versionId: string
  inScope: boolean
  intrinsic: boolean
  admissionGeneration: number
}
export interface CreationScope {
  issuer: string
  vaultId: string
  grantId: string
  principalId: string
  role: 'reader' | 'editor'
  state: string
  generation: string
  selector: { kind: 'folder'; prefix: string } | { kind: 'group'; roots: ApprovedRoot[] }
}
export type CreationInput =
  | { kind: 'note'; path: string; text: string; rootId?: string }
  | { kind: 'asset'; path: string; bytes: Uint8Array; sponsor: NativeSponsor }
export interface CreationReview {
  id: string
  path: string
  kind: 'note' | 'asset'
  sha: string
  text?: string
  root?: ApprovedRoot
  sponsor?: NativeSponsor
}
export interface UploadProof {
  principalId: string
  grantId: string
  sha: string
  entitlementId: string
}
export interface NativeCreationRequest {
  handle: string
  path: string
  kind: 'note' | 'asset'
  sha: string
  size: number
  scope: CreationScope
  root?: ApprovedRoot
  sponsor?: NativeSponsor
  upload: UploadProof
}
export interface ScopedCreationPort {
  scope(): Promise<CreationScope>
  exists(path: string): Promise<boolean>
  sponsorCurrent(sponsor: NativeSponsor): Promise<boolean>
  place(path: string, source: { bytes: Uint8Array; sha: string }, handle: string): Promise<void>
  upload(
    path: string,
    source: { bytes: Uint8Array; sha: string },
    handle: string
  ): Promise<UploadProof>
  create(
    request: NativeCreationRequest
  ): Promise<{ fileId: string; versionId: string; created: boolean }>
  link(sponsorId: string, targetPath: string): Promise<void>
}
interface Intent {
  version: 1
  review: CreationReview
  scope: CreationScope
  bytes: number[]
  phase: 'prepared' | 'placing' | 'placed' | 'uploaded' | 'committed'
  request?: NativeCreationRequest
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const allowed = (path: string) =>
  path.length > 0 &&
  path.length < 4096 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  path.split('/').every((p) => p.length > 0 && p !== '.' && p !== '..' && !p.startsWith('.')) &&
  !/\.(?:js|mjs|cjs|ts|py|sh|wasm)$/i.test(path)
/** Exact NEW local paths only. No received-file remap, private occupant lookup or imported overwrite. */
export class ScopedCreationFlow {
  private generation = 0
  private draft: { review: CreationReview; scope: CreationScope; bytes: Uint8Array } | null = null
  private busy = false
  constructor(
    private readonly meta: SnapshotMeta,
    private readonly port: ScopedCreationPort,
    private readonly enabled: () => boolean = () => SCOPED_CREATION_ENABLED,
    private readonly held: () => boolean = () => false,
    private readonly configurationRoots: string[] = []
  ) {}
  private fence(g?: number) {
    if (!this.enabled()) throw new Error('Scoped native creation is disabled')
    if (!this.held()) throw new Error('Scoped native writer ownership lost')
    if (g !== undefined && g !== this.generation)
      throw new Error('Scoped creation review was closed or changed')
  }
  private key(id: string) {
    return 'scoped-native-create-v1:' + id
  }
  private async write(i: Intent) {
    const value = JSON.stringify({ intent: i, checksum: await hash(i) })
    if (value.length > 8 * 1024 * 1024)
      throw new Error('Scoped create durable payload budget reached')
    await this.meta.setMeta(this.key(i.review.id), value)
    if ((await this.meta.getMeta(this.key(i.review.id))) !== value)
      throw new Error('Scoped create intent was not persisted; recovery required')
  }
  private async read(id: string): Promise<Intent | null> {
    const raw = await this.meta.getMeta(this.key(id))
    if (raw === null) return null
    try {
      const e = JSON.parse(raw) as { intent: Intent; checksum: string }
      if (
        e.intent.version !== 1 ||
        e.intent.review.id !== id ||
        (await hash(e.intent)) !== e.checksum ||
        !Array.isArray(e.intent.bytes)
      )
        throw new Error()
      return e.intent
    } catch {
      throw new Error('Scoped create intent unreadable; recovery required')
    }
  }
  private current(scope: CreationScope) {
    if (
      scope.state !== 'active' ||
      scope.role !== 'editor' ||
      !scope.generation ||
      !scope.issuer ||
      !scope.vaultId ||
      !scope.grantId ||
      !scope.principalId
    )
      throw new Error('Current editor scope is required')
  }
  async review(input: CreationInput): Promise<CreationReview> {
    this.fence()
    if (this.busy) throw new Error('Scoped create is already running')
    this.close()
    const generation = this.generation,
      i =
        input.kind === 'asset'
          ? { ...input, sponsor: copy(input.sponsor), bytes: new Uint8Array(input.bytes) }
          : copy(input),
      scope = copy(await this.port.scope())
    this.fence(generation)
    this.current(scope)
    if (
      !allowed(i.path) ||
      this.configurationRoots.some((root) => i.path === root || i.path.startsWith(root + '/'))
    )
      throw new Error('Choose an allowed exact new-file path outside configuration')
    if (
      i.kind === 'note' &&
      scope.selector.kind === 'folder' &&
      !i.path.startsWith(scope.selector.prefix)
    )
      throw new Error('Choose a note path within the current folder scope')
    if (await this.port.exists(i.path))
      throw new Error('New-file path is occupied; existing files stay untouched')
    this.fence(generation)
    let root: ApprovedRoot | undefined, text: string | undefined
    if (i.kind === 'note') {
      if (scope.selector.kind === 'group') {
        root = scope.selector.roots.find((r) => r.fileId === i.rootId && r.approved)
        if (
          !root ||
          !root.versionId ||
          !root.spelling ||
          root.spelling.includes(']]') ||
          /[\r\n]/.test(root.spelling)
        )
          throw new Error('Choose an exact approved group root')
        if (/^\s*---(?:\r?\n|$)/.test(i.text))
          throw new Error('New group note metadata requires root-only review')
        text =
          '---\ngroups:\n  - ' + JSON.stringify('[[' + root.spelling + ']]') + '\n---\n' + i.text
      } else text = i.text
    } else if (
      !i.sponsor.inScope ||
      !i.sponsor.intrinsic ||
      !i.sponsor.fileId ||
      !i.sponsor.versionId ||
      !Number.isSafeInteger(i.sponsor.admissionGeneration) ||
      i.sponsor.admissionGeneration < 1
    )
      throw new Error('A current intrinsic sponsor is required')
    const bytes = i.kind === 'asset' ? i.bytes : new TextEncoder().encode(text),
      sha = await sha256(bytes)
    this.fence(generation)
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Scoped creation review budget reached')
    const review: CreationReview = {
      id: crypto.randomUUID(),
      path: i.path,
      kind: i.kind,
      sha,
      ...(text === undefined ? {} : { text }),
      ...(root ? { root: copy(root) } : {}),
      ...(i.kind === 'asset' ? { sponsor: copy(i.sponsor) } : {}),
    }
    this.draft = { review: copy(review), scope, bytes: new Uint8Array(bytes) }
    return copy(review)
  }
  async resume(handle: string): Promise<CreationReview> {
    this.fence()
    if (this.busy) throw new Error('Scoped create is already running')
    const i = await this.read(handle)
    if (!i) throw new Error('Missing native creation intent; recovery required')
    this.fence()
    this.draft = { review: copy(i.review), scope: copy(i.scope), bytes: new Uint8Array(i.bytes) }
    return copy(i.review)
  }
  async confirm(shown: CreationReview): Promise<void> {
    this.fence()
    if (this.busy) throw new Error('Scoped create is already running')
    this.busy = true
    const generation = this.generation
    try {
      const draft = this.draft
      if (!draft || !equal(shown, draft.review))
        throw new Error('Review the exact new-file choice first')
      const current = copy(await this.port.scope())
      this.fence(generation)
      this.current(current)
      if (!equal(current, draft.scope)) throw new Error('Scoped creation scope/root review changed')
      if (shown.sponsor && !(await this.port.sponsorCurrent(copy(shown.sponsor))))
        throw new Error('Native sponsor identity/version changed')
      this.fence(generation)
      let intent = await this.read(shown.id)
      this.fence(generation)
      if (!intent) {
        if (await this.port.exists(shown.path)) throw new Error('New-file path occupied')
        this.fence(generation)
        intent = {
          version: 1,
          review: copy(shown),
          scope: copy(draft.scope),
          bytes: [...draft.bytes],
          phase: 'prepared',
        }
        await this.write(intent)
        this.fence(generation)
      }
      if (
        !equal(intent.review, shown) ||
        !equal(intent.scope, current) ||
        (await sha256(new Uint8Array(intent.bytes))) !== shown.sha
      )
        throw new Error('Scoped create durable identity changed')
      if (intent.phase === 'prepared') {
        intent.phase = 'placing'
        await this.write(intent)
        this.fence(generation)
        await this.port.place(
          shown.path,
          { bytes: new Uint8Array(intent.bytes), sha: shown.sha },
          shown.id
        )
        this.fence(generation)
        intent.phase = 'placed'
        await this.write(intent)
      }
      if (intent.phase === 'placing')
        throw new Error('Interrupted local placement requires recovery, never replacement')
      if (intent.phase === 'placed') {
        const proof = await this.port.upload(
          shown.path,
          { bytes: new Uint8Array(intent.bytes), sha: shown.sha },
          shown.id
        )
        this.fence(generation)
        if (
          proof.principalId !== current.principalId ||
          proof.grantId !== current.grantId ||
          proof.sha !== shown.sha ||
          !proof.entitlementId
        )
          throw new Error('Own principal upload proof is required')
        intent.request = {
          handle: shown.id,
          path: shown.path,
          kind: shown.kind,
          sha: shown.sha,
          size: intent.bytes.length,
          scope: copy(current),
          ...(shown.root ? { root: copy(shown.root) } : {}),
          ...(shown.sponsor ? { sponsor: copy(shown.sponsor) } : {}),
          upload: copy(proof),
        }
        intent.phase = 'uploaded'
        await this.write(intent)
      }
      if (intent.phase === 'uploaded') {
        const latest = await this.port.scope()
        this.fence(generation)
        this.current(latest)
        if (!equal(latest, intent.scope)) throw new Error('Native scope/root changed before create')
        if (shown.sponsor && !(await this.port.sponsorCurrent(copy(shown.sponsor))))
          throw new Error('Native sponsor changed before create')
        this.fence(generation)
        const outcome = await this.port.create(copy(intent.request))
        this.fence(generation)
        if (!outcome.created || !outcome.fileId || !outcome.versionId)
          throw new Error('Native create collision/adoption held; local bytes preserved')
        intent.phase = 'committed'
        await this.write(intent)
      }
      if (shown.kind === 'asset' && shown.sponsor) {
        this.fence(generation)
        if (!(await this.port.sponsorCurrent(copy(shown.sponsor))))
          throw new Error('Native sponsor changed before link')
        this.fence(generation)
        await this.port.link(shown.sponsor.fileId, shown.path)
        this.fence(generation)
      }
    } finally {
      this.busy = false
    }
  }
  close() {
    this.generation++
    this.draft = null
  }
}
