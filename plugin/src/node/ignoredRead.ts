const codeOf = (error: unknown): string =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : ''

const invisible = (error: unknown) =>
  [
    'ignored',
    'excluded',
    'not_visible',
    'path_ignored',
    'path_excluded',
    'not_found',
    'unsafe_path',
  ].includes(codeOf(error))

/** Retry only visibility failures, never authority or transport failures. */
export async function readWithIgnoredFallback<T>(
  path: string,
  read: (includeIgnored: boolean) => Promise<T>,
  explicit = false,
  explain = true,
  retryInvisible = true
): Promise<T> {
  if (!explicit) {
    try {
      return await read(false)
    } catch (error) {
      if (!retryInvisible || !invisible(error)) throw error
    }
  }
  try {
    return await read(true)
  } catch (error) {
    if (!['scan_limit', 'invalid_params'].includes(codeOf(error))) throw error
    try {
      return await read(false)
    } catch (fallbackError) {
      if (codeOf(error) !== 'scan_limit') throw fallbackError
      if (!explain) throw fallbackError
      if (!invisible(fallbackError)) throw fallbackError
      throw new Error(
        `Cannot read ${JSON.stringify(path)}: the path is ignored and the project's ignored trees are too big to scan.`
      )
    }
  }
}
