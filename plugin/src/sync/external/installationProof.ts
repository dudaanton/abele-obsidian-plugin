import { LocalBaseSchema, type ExternalDocument, type ExternalRecord } from './records'
import { ExternalFilePortError } from './filesystem'

export const installationProofKey = (fileId: string) => 'external-installation-v1:' + fileId

/** Current installation evidence is independent of immutable recovery-artifact provenance. */
export function installationBase(raw: string | null, doc: ExternalDocument, file: ExternalRecord) {
  if (raw === null) return file.lastProvenLocalBase
  try {
    const proof = JSON.parse(raw)
    const base = LocalBaseSchema.parse(proof.base)
    const op = doc.operations.find((item) => item.operationId === proof.operationId)
    if (
      proof.schema !== 1 ||
      proof.ledgerId !== doc.ledgerId ||
      proof.generation !== doc.binding.generation ||
      base.fileId !== file.fileId ||
      op?.kind !== 'hydration' ||
      op.phase !== 'hydrated' ||
      op.unresolvedOutcome ||
      op.connectionGeneration !== doc.binding.generation ||
      op.expected?.fileId !== base.fileId ||
      op.expected.versionId !== base.versionId ||
      op.expected.sha !== base.sha ||
      op.expected.size !== base.size ||
      op.targetPath !== base.path
    )
      throw new Error('Invalid installation proof')
    return base
  } catch {
    throw new ExternalFilePortError('recovery-required')
  }
}
