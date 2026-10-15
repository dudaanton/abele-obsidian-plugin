/** Device-local, explicit offload planning. A preview never publishes or removes bytes. */
export interface FileCandidate {
  path: string
  size: number
  version: string
  pinned: boolean
  blocked: string | null
}
export interface OffloadRule {
  folder: string
  extensions: string[]
  minBytes: number
  unopenedDays: number
}
export function matchesRule(
  rule: OffloadRule,
  file: { path: string; size: number; lastOpened?: number },
  now = Date.now()
): boolean {
  const folder = rule.folder.replace(/^\/+|\/+$/g, '')
  return (
    (!folder || file.path.startsWith(folder + '/')) &&
    (!rule.extensions.length ||
      rule.extensions.includes(file.path.split('.').at(-1)?.toLowerCase() ?? '')) &&
    file.size >= rule.minBytes &&
    (!rule.unopenedDays ||
      (file.lastOpened !== undefined && now - file.lastOpened >= rule.unopenedDays * 86400000))
  )
}
export interface OffloadPreview {
  files: FileCandidate[]
  skipped: { path: string; status: string }[]
  bytes: number
}
export class ExternalFileActions {
  constructor(
    private readonly port: {
      inspect(path: string): Promise<FileCandidate>
      evict(path: string, version: string): Promise<{ status: string; reclaimedBytes: number }>
    }
  ) {}
  async preview(paths: readonly string[]): Promise<OffloadPreview> {
    const result: OffloadPreview = { files: [], skipped: [], bytes: 0 }
    for (const path of new Set(paths)) {
      try {
        const file = await this.port.inspect(path)
        const status = file.pinned ? 'pinned' : file.blocked
        if (status) result.skipped.push({ path, status })
        else {
          result.files.push(file)
          result.bytes += file.size
        }
      } catch (error) {
        result.skipped.push({
          path,
          status: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  }
  async apply(preview: OffloadPreview) {
    const results: { path: string; status: string; reclaimedBytes: number }[] = []
    for (const file of preview.files) {
      try {
        const current = await this.port.inspect(file.path)
        const status = current.pinned
          ? 'pinned'
          : (current.blocked ??
            (current.version !== file.version || current.size !== file.size
              ? 'version-changed'
              : null))
        results.push({
          path: file.path,
          ...(status
            ? { status, reclaimedBytes: 0 }
            : await this.port.evict(file.path, file.version)),
        })
      } catch (error) {
        results.push({
          path: file.path,
          status: error instanceof Error ? error.message : String(error),
          reclaimedBytes: 0,
        })
      }
    }
    return results
  }
}
