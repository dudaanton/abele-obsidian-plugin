/** Pure seeded data, also evaluated in the vault page to avoid shipping megabytes through the CLI. */
export function firstFolderFixture(seed = 42): {
  directories: string[]
  files: { path: string; bytes: Uint8Array }[]
} {
  let state = seed >>> 0
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  const directories: string[] = []
  for (let i = 0; i < 10; i++) {
    const parent = `Раздел-${i}`
    directories.push(parent)
    for (let j = 0; j < 5; j++) directories.push(`${parent}/Topic-${j}`)
  }
  const files: { path: string; bytes: Uint8Array }[] = []
  for (let i = 0; i < 1024; i++) {
    const extension =
      i < 959 ? 'md' : i < 1009 ? 'png' : i < 1019 ? 'pdf' : i < 1023 ? 'canvas' : 'js'
    const directory = directories[(i % 50) + Math.floor((i % 50) / 5) + 1]
    const path = `${directory}/${i % 2 ? 'Заметка' : 'Sample'}-${i}.${extension}`
    let bytes: Uint8Array
    if (extension === 'png') {
      const image = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
        ),
        (c) => c.charCodeAt(0)
      )
      bytes = new Uint8Array(240 * 1024)
      for (let j = 0; j < bytes.length; j++) bytes[j] = random() >>> 24
      bytes.set(image)
    } else {
      const content =
        extension === 'md'
          ? `# Sample ${random()}\n\nSynthetic note.\n`
          : extension === 'pdf'
            ? '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'
            : extension === 'canvas'
              ? JSON.stringify({
                  nodes: [
                    {
                      id: String(random()),
                      type: 'text',
                      text: 'Sample',
                      x: 0,
                      y: 0,
                      width: 200,
                      height: 100,
                    },
                  ],
                  edges: [],
                })
              : 'export const sample = 42\n'
      bytes = new TextEncoder().encode(
        extension === 'md' ? content.padEnd(7000, 'sample text\n') : content
      )
    }
    files.push({ path, bytes })
  }
  const size = files.reduce((total, file) => total + file.bytes.length, 0)
  // Pad one PDF after its EOF; all bytes, including binary padding, are checked on arrival.
  const attachment = files[1009]
  const padded = new Uint8Array(attachment.bytes.length + 20 * 1024 * 1024 - size)
  padded.set(attachment.bytes)
  for (let i = attachment.bytes.length; i < padded.length; i++) padded[i] = random() >>> 24
  attachment.bytes = padded
  return { directories, files }
}
