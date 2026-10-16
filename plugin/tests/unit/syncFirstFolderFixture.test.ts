// @vitest-environment node
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { firstFolderFixture } from '../e2e/helpers/syncFirstFolderFixture'

it(
  'generates a repeatable multi-page first folder connection with realistic breadth and bytes',
  () => {
    const fixture = firstFolderFixture(42)
    const digest = (sample: ReturnType<typeof firstFolderFixture>) =>
      createHash('sha256')
        .update(
          Buffer.concat(
            sample.files.map((file) =>
              Buffer.concat([Buffer.from(file.path), Buffer.from(file.bytes)])
            )
          )
        )
        .digest('hex')
    const seededDigest = digest(fixture)
    expect(digest(firstFolderFixture(42))).toBe(seededDigest)
    expect(digest(firstFolderFixture(43))).not.toBe(seededDigest)
    expect(fixture.files).toHaveLength(1024)
    expect(new Set(fixture.files.map((file) => file.path)).size).toBe(1024)
    expect(fixture.directories).toHaveLength(60)
    expect(fixture.files.reduce((size, file) => size + file.bytes.length, 0)).toBe(20 * 1024 * 1024)
    expect(fixture.files.filter((file) => file.path.endsWith('.md'))).toHaveLength(959)
    expect(fixture.files.filter((file) => file.path.endsWith('.js'))).toHaveLength(1)
    expect(fixture.files.filter((file) => file.path.endsWith('.png'))).toHaveLength(50)
    expect(fixture.files.filter((file) => file.path.endsWith('.pdf'))).toHaveLength(10)
    expect(fixture.files.filter((file) => file.path.endsWith('.canvas'))).toHaveLength(4)
    expect(new Set(fixture.directories).size).toBe(60)
    for (const file of fixture.files)
      expect(fixture.directories).toContain(file.path.split('/').slice(0, -1).join('/'))
    expect(fixture.files.some((file) => /[А-Яа-я]/.test(file.path))).toBe(true)
    expect(fixture.files.every((file) => file.path.normalize('NFC') === file.path)).toBe(true)
    // The pinned puller requests manifest pages of 1,000 entries.
    expect(Math.ceil(fixture.files.length / 1000)).toBe(2)
    // Live seeding embeds the compiled function in the page: it must have no module dependencies.
    const pageFixture = runInNewContext(`(${firstFolderFixture.toString()})(42)`, {
      TextEncoder,
      Uint8Array,
      atob,
    }) as ReturnType<typeof firstFolderFixture>
    expect(
      pageFixture.files.map((file) => createHash('sha256').update(file.bytes).digest('hex'))
    ).toEqual(fixture.files.map((file) => createHash('sha256').update(file.bytes).digest('hex')))
    // Four complete 20 MiB fixtures, including the standalone VM copy, plus byte hashing.
  },
  4 * 20 * 1000
)
