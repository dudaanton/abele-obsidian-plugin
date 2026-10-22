import { createHash, createCipheriv } from 'node:crypto'
import { mkdir, open, readdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'

export const shapes = {
  smoke: { files: 1000, bytes: 200 * 1024 ** 2 },
  scale: { files: 33000, bytes: 11 * 1024 ** 3 },
}

export function planVault({ seed = 1, files, bytes }) {
  if (
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(files) ||
    files < 100 ||
    !Number.isSafeInteger(bytes) ||
    bytes < files * 4096
  )
    throw new Error('Invalid shape')
  const attachments = Math.max(4, Math.floor(files * 0.04))
  const result = Array.from({ length: files }, (_, i) => {
    const folder = Math.floor(i / 32)
    let path = `Notes/Section ${folder % 31}/层 ${folder % 7}/Nested ${folder % 13}/Sample ${i}.md`
    if (i === 0) path = 'Notes/Case.md'
    if (i === 1) path = 'Notes/case.md'
    if (i === 2) path = '.obsidian/scale-sample.json'
    if (i === 3) path = '.obsidian/plugins/sample-disabled/data.json'
    if (i >= files - attachments)
      path = `Attachments/Batch ${i % 9}/Sample ${i}.${i % 2 ? 'pdf' : 'png'}`
    return {
      path,
      size: i < files - attachments ? 512 + (((i * 1103515245 + seed) >>> 0) % 3584) : 0,
      index: i,
    }
  })
  let remaining = bytes - result.reduce((sum, f) => sum + f.size, 0)
  // Keep the extreme tail bounded: scaling total bytes must not create a multi-GiB file.
  const large = remaining >= 1024 ** 3 ? 3 : 1
  for (let j = 0; j < large; j++) {
    const size = large === 1 ? Math.floor(remaining * 0.56) : (256 - j * 64) * 1024 ** 2
    result[files - attachments + j].size = size
    remaining -= size
  }
  const weights = Array.from({ length: attachments - large }, (_, j) => 1 / Math.sqrt(j + 5))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const pool = remaining
  for (let j = 0; j < weights.length; j++) {
    const size =
      j === weights.length - 1 ? remaining : Math.floor((pool * weights[j]) / weightTotal)
    result[files - attachments + large + j].size = size
    remaining -= size
  }
  return result
}

export function contentChunk(seed, index, offset, length = 64 * 1024) {
  // Native counter-mode generation avoids millions of JavaScript hashing calls at scale.
  const key = createHash('sha256').update(`${seed}:${index}`).digest()
  const iv = Buffer.alloc(16)
  iv.writeBigUInt64BE(BigInt(Math.floor(offset / 16)), 8)
  return createCipheriv('aes-256-ctr', key, iv).update(Buffer.alloc(length))
}

export async function generate(root, options) {
  await mkdir(root, { recursive: true })
  if ((await readdir(root)).length) throw new Error('Generator requires an empty destination')
  // Detect filesystem folding before any fixture data can be overwritten.
  const first = await open(join(root, '.case-probe'), 'wx')
  await first.close()
  let second
  try {
    second = await open(join(root, '.CASE-PROBE'), 'wx')
  } catch {
    throw new Error('Case-sensitive filesystem required for case-only siblings')
  } finally {
    await second?.close()
    const { unlink } = await import('node:fs/promises')
    await unlink(join(root, '.case-probe'))
    if (second) await unlink(join(root, '.CASE-PROBE'))
  }
  const manifest = []
  for (const file of planVault(options)) {
    await mkdir(dirname(join(root, file.path)), { recursive: true })
    const handle = await open(join(root, file.path), 'wx')
    const hash = createHash('sha256')
    try {
      for (let offset = 0; offset < file.size; offset += 64 * 1024) {
        let chunk = contentChunk(
          options.seed ?? 1,
          file.index,
          offset,
          Math.min(64 * 1024, file.size - offset)
        )
        if (file.path.endsWith('.md') || file.path.endsWith('.json')) {
          chunk = Buffer.from(chunk.toString('hex').slice(0, chunk.length))
          if (offset === 0) chunk.write(file.path.endsWith('.md') ? '# Sample\n' : '"')
          if (offset + chunk.length === file.size)
            chunk[chunk.length - 1] = file.path.endsWith('.md') ? 10 : 34
        }
        hash.update(chunk)
        await handle.writeFile(chunk)
      }
    } finally {
      await handle.close()
    }
    manifest.push({ path: file.path, size: file.size, sha: hash.digest('hex') })
  }
  return manifest
}

export async function inventory(root, excluded = () => false, prefix = '') {
  const result = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (excluded(path)) continue
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not fixture files')
    if (entry.isDirectory()) result.push(...(await inventory(root, excluded, path)))
    else {
      const hash = createHash('sha256')
      const handle = await open(join(root, path), 'r')
      try {
        for await (const chunk of handle.createReadStream()) hash.update(chunk)
      } finally {
        await handle.close()
      }
      result.push({ path, sha: hash.digest('hex'), size: (await stat(join(root, path))).size })
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
