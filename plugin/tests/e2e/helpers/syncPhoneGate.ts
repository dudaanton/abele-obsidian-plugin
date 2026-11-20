export interface GateFile {
  path: string
  sha: string
  size: number
}

export function assertPhoneGateInventory(expected: GateFile[], actual: GateFile[]): void {
  const sorted = (rows: GateFile[]) =>
    rows
      .map(({ path, sha, size }) => ({ path, sha, size }))
      .sort((a, b) => a.path.localeCompare(b.path))
  if (JSON.stringify(sorted(expected)) !== JSON.stringify(sorted(actual)))
    throw new Error('Phone gate byte inventory mismatch')
}

export function assertFreshPhoneLoad(before: number, after: number): void {
  if (!Number.isFinite(after) || after <= before)
    throw new Error('Fresh launch did not replace the phone page')
}

/** Synthetic bytes; serialize into the page without capturing any host state. */
export function phoneGateChunk(seed: number, offset: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++)
    bytes[i] = 32 + (((offset + i) * 31 + seed * 17 + ((offset + i) >>> 8)) % 95)
  // Distinguish all fixtures, including seeds separated by 256.
  if (offset === 0) bytes.set(new TextEncoder().encode(seed.toString(16).padStart(8, '0')))
  return bytes
}
