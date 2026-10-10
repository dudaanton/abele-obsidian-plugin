import type { TokenUi } from '../../../src/sync/tokenUi'

/** This fixture explicitly opts into its large transfer, including on a phone. */
export async function allowFixtureAttachment(svc: TokenUi, id: string, size: number) {
  const record = svc.registry.records().find((one) => one.id === id)
  if (!record) throw new Error('Attachment fixture connection missing')
  const selective = record.selective
  if (!selective) throw new Error('Attachment fixture policy missing')
  if (selective.maxFileBytes !== null && selective.maxFileBytes < size)
    await svc.updateConnection(id, { selective: { ...selective, maxFileBytes: size } })
}
