/** Verify every indexed and on-disk entry before recursively removing a fixture. */
export const OWNED_MEDIA_FIXTURE = String.raw`
  async function removeOwnedMediaFixture(root, sources) {
    const folder = app.vault.getAbstractFileByPath(root)
    if (!folder) return
    const refuse = () => { throw new Error('Media fixture folder is not owned: ' + root) }
    if (!Array.isArray(folder.children)) refuse()
    const verified = new Set()
    for (const child of folder.children) {
      const name = child.path.slice(root.length + 1)
      if (child.children || !Object.hasOwn(sources, name)) refuse()
      const bytes = [...new Uint8Array(await app.vault.adapter.readBinary(child.path))]
      if (!sources[name].some(value => JSON.stringify(value) === JSON.stringify(bytes))) refuse()
      verified.add(child.path)
    }
    // A marker permits partial setup. Older unmarked runs need the complete baseline.
    if (!verified.has(root + '/sample-fixture.txt') &&
        !['sample-keep.png', 'sample-links.md', 'sample-ref-one.md', 'sample-ref-two.md'].every(name => verified.has(root + '/' + name))) refuse()
    const disk = await app.vault.adapter.list(root)
    if (disk.folders.length || disk.files.length !== verified.size || disk.files.some(path => !verified.has(path))) refuse()
    await app.vault.delete(folder, true)
  }
`
