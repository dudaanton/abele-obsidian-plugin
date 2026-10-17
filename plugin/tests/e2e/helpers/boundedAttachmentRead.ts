/** Self-contained so the live fixture can serialize it into either renderer. */
export async function verifyBoundedAttachmentRead(
  probe: {
    verify(
      id: string,
      expected: { version_id: string; path: string; sha: string; size: number }
    ): Promise<unknown>
    openVersion(
      id: string,
      version: string,
      expected: { size: number; sha: string }
    ): Promise<{
      size: number
      read(offset: number, length: number): Promise<Uint8Array>
      assertUnchanged(): Promise<void>
      close(): Promise<void>
    }>
  },
  head: { fileId: string; versionId: string; path: string; sha: string; size: number },
  byte: number
): Promise<boolean> {
  const proof = await probe.verify(head.fileId, {
    version_id: head.versionId,
    path: head.path,
    sha: head.sha,
    size: head.size,
  })
  if (!proof || typeof proof !== 'object' || Reflect.get(proof, 'verified') !== true) return false
  const source = await probe.openVersion(head.fileId, head.versionId, {
    size: head.size,
    sha: head.sha,
  })
  try {
    if (source.size !== head.size) return false
    for (let offset = 0; offset < head.size; offset += 1024 * 1024) {
      const length = Math.min(1024 * 1024, head.size - offset)
      const bytes = await source.read(offset, length)
      if (bytes.length !== length || !bytes.every((one) => one === byte)) return false
    }
    await source.assertUnchanged()
    return true
  } finally {
    await source.close()
  }
}
