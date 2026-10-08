import { normalizeServerUrl, validatePath } from '@abele/sync-protocol'
import { z } from 'zod'
import { assertPhysicalPath, MAX_ATTACHMENT_BYTES } from './projection'

const id = z.string().min(1).max(256)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const size = z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES)
const physicalPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => {
    try {
      assertPhysicalPath(path)
      return true
    } catch {
      return false
    }
  }, 'Invalid physical path')
// Recovery artifacts are device-local and may have hidden names. They are not wire paths;
// still reject absolute paths, traversal, forbidden characters and overlong components.
const artifactPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => {
    try {
      const segments = path.normalize('NFC').split('/')
      if (segments.some((segment) => segment === '.' || segment === '..')) return false
      validatePath(
        segments
          .map((segment) => (segment.startsWith('.') ? 'x' + segment.slice(1) : segment))
          .join('/')
      )
      return true
    } catch {
      return false
    }
  }, 'Invalid recovery path')
const wirePath = physicalPath.refine(
  (path) => path === path.normalize('NFC'),
  'Wire path must be NFC'
)
const representation = z.enum(['hydrated', 'remote-only', 'pending-download'])
const availability = z.enum(['active', 'deleted', 'detached', 'unavailable'])

export const ConnectionBindingSchema = z
  .object({
    endpoint: z.string().transform((value, ctx) => {
      const normalized = normalizeServerUrl(value)
      if (normalized === null) {
        ctx.addIssue({ code: 'custom', message: 'Invalid endpoint' })
        return z.NEVER
      }
      return normalized
    }),
    vaultId: id,
    mode: z.enum(['personal', 'scoped']),
    principalId: id,
    principalType: z.enum(['account', 'device', 'key', 'installation']),
    grantId: id.nullable(),
    generation: revision,
    /** Local slot/fingerprint association only, never a credential or bearer token. */
    credentialAssociation: id,
  })
  .strict()
  .refine(
    (value) =>
      value.mode === 'scoped'
        ? value.grantId !== null && ['key', 'installation'].includes(value.principalType)
        : value.grantId === null,
    'Invalid mode/grant binding'
  )
export type ConnectionBinding = z.infer<typeof ConnectionBindingSchema>

export const LocalBaseSchema = z
  .object({
    fileId: id,
    versionId: id,
    path: wirePath,
    sha,
    size,
    mtime: revision,
  })
  .strict()
export const OwnedArtifactSchema = z
  .object({
    path: artifactPath,
    sha,
    size,
    role: z.enum(['incoming', 'retained', 'projection']),
    operationId: id,
  })
  .strict()

/** Local policy/representation only. The existing ledger remains the sole server-head authority. */
export const ExternalRecordSchema = z
  .object({
    schema: z.literal(1),
    ledgerId: id,
    binding: ConnectionBindingSchema,
    fileId: id,
    representation,
    preference: z.enum(['keep-local', 'on-demand']),
    pinned: z.boolean(),
    projectionPath: physicalPath.nullable(),
    projectionSha: sha.nullable(),
    localRevision: revision,
    pendingOperationId: id.nullable(),
    availability,
    blockingReason: z.string().min(1).max(1024).nullable(),
    lastProvenLocalBase: LocalBaseSchema.nullable(),
    retained: z.array(OwnedArtifactSchema),
  })
  .strict()
export type ExternalRecord = z.infer<typeof ExternalRecordSchema>

const phasesByKind = {
  eviction: ['prepared', 'delete-ready', 'remote-only'],
  hydration: ['download-intent', 'ready-to-install', 'hydrated'],
  'projection-update': ['projection-intent', 'projection-written'],
  'projection-move': ['projection-intent', 'projection-written'],
  tombstone: ['prepared', 'tombstone'],
  detach: ['prepared', 'detached'],
  'disconnect-preparation': ['disconnect-preparing', 'disconnect-ready'],
}

export const ExternalOperationSchema = z
  .object({
    schema: z.literal(1),
    operationId: id,
    kind: z.enum([
      'eviction',
      'hydration',
      'projection-update',
      'projection-move',
      'tombstone',
      'detach',
      'disconnect-preparation',
    ]),
    phase: z.enum([
      'prepared',
      'delete-ready',
      'remote-only',
      'download-intent',
      'ready-to-install',
      'hydrated',
      'projection-intent',
      'projection-written',
      'tombstone',
      'detached',
      'disconnect-preparing',
      'disconnect-ready',
      'cleanup-pending',
      'held',
      'complete',
    ]),
    revision,
    connectionGeneration: revision,
    expected: LocalBaseSchema.omit({ mtime: true }).nullable(),
    sourcePath: artifactPath.nullable(),
    targetPath: artifactPath.nullable(),
    previousRepresentation: representation.nullable(),
    localBase: LocalBaseSchema.nullable(),
    desiredRepresentation: representation.nullable(),
    desiredAvailability: availability.optional(),
    projectionDigest: sha.nullable(),
    ownedArtifacts: z.array(OwnedArtifactSchema),
    unresolvedOutcome: z.string().min(1).max(1024).nullable(),
    cleanupReason: z.string().min(1).max(1024).nullable(),
  })
  .strict()
  .refine(
    (op) =>
      ['held', 'cleanup-pending', 'complete'].includes(op.phase) ||
      phasesByKind[op.kind].includes(op.phase),
    'Invalid operation phase'
  )
export type ExternalOperation = z.infer<typeof ExternalOperationSchema>

export const ExternalDocumentSchema = z
  .object({
    schema: z.literal(1),
    ledgerId: id,
    binding: ConnectionBindingSchema,
    revision,
    files: z.array(ExternalRecordSchema),
    operations: z.array(ExternalOperationSchema),
  })
  .strict()
  .superRefine((document, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: 'custom', message })
    const operationIds = new Set(document.operations.map((op) => op.operationId))
    if (
      operationIds.size !== document.operations.length ||
      new Set(document.files.map((file) => file.fileId)).size !== document.files.length
    )
      issue('Duplicate external identity')
    for (const file of document.files) {
      if (file.ledgerId !== document.ledgerId || !sameConnection(file.binding, document.binding))
        issue('Foreign file binding')
      if (file.lastProvenLocalBase && file.lastProvenLocalBase.fileId !== file.fileId)
        issue('Foreign local base')
      if (file.pendingOperationId && !operationIds.has(file.pendingOperationId))
        issue('Missing operation')
    }
    for (const op of document.operations) {
      if (op.connectionGeneration !== document.binding.generation)
        issue('Foreign operation generation')
      if (op.kind !== 'disconnect-preparation' && !op.expected) issue('Missing expected version')
      if (op.localBase && op.expected && op.localBase.fileId !== op.expected.fileId)
        issue('Foreign operation base')
      if (op.ownedArtifacts.some((artifact) => artifact.operationId !== op.operationId))
        issue('Foreign artifact ownership')
    }
    for (const file of document.files) {
      const pending = document.operations.find((op) => op.operationId === file.pendingOperationId)
      if (pending?.expected && pending.expected.fileId !== file.fileId)
        issue('Foreign pending operation')
    }
  })
export type ExternalDocument = z.infer<typeof ExternalDocumentSchema>

export function sameConnection(a: ConnectionBinding, b: ConnectionBinding): boolean {
  return (
    a.endpoint === b.endpoint &&
    a.vaultId === b.vaultId &&
    a.mode === b.mode &&
    a.principalId === b.principalId &&
    a.principalType === b.principalType &&
    a.grantId === b.grantId &&
    a.generation === b.generation &&
    a.credentialAssociation === b.credentialAssociation
  )
}
