/** Birth time distinguishes a newly allocated object when the filesystem reuses its inode. */
export function desktopFileIdentity(stat: {
  dev?: unknown
  ino?: unknown
  birthtimeNs?: unknown
}): string | null {
  const { dev, ino, birthtimeNs } = stat
  if (
    typeof dev !== 'bigint' ||
    typeof ino !== 'bigint' ||
    ino <= 0n ||
    typeof birthtimeNs !== 'bigint' ||
    birthtimeNs <= 0n
  )
    return null
  return `node-v1:${dev}:${ino}:${birthtimeNs}`
}
