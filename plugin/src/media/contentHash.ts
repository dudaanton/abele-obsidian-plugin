/** Cooperative FNV-1a fingerprint. A match is only a candidate; callers still compare bytes. */
export async function hashMediaBytes(
  buffer: ArrayBuffer,
  yieldWork: () => Promise<void> = () => new Promise((resolve) => window.setTimeout(resolve, 0))
): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const chunk = 1024 * 1024
  let hash = 0x811c9dc5
  for (let start = 0; start < bytes.length; start += chunk) {
    if (start) await yieldWork()
    const end = Math.min(start + chunk, bytes.length)
    for (let i = start; i < end; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
