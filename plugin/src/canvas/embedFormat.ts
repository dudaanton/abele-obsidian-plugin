/** Canvas embed subpaths are presentation requests, never storage edits. */
export function canvasEmbedOptions(source: string): { step?: number; node?: string } {
  const subpath = source.split('|')[0].split('#').slice(1).join('#')
  if (subpath.startsWith('step=')) {
    const value = subpath.slice(5)
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error('Canvas step must be a positive one-based number')
    return { step: Number(value) }
  }
  if (subpath.startsWith('node=')) {
    if (!subpath.slice(5)) throw new Error('Canvas node id is empty')
    return { node: subpath.slice(5) }
  }
  return {}
}
