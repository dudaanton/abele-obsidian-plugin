/** Read-only exposure probe. Function is serialized into the phone's page. */
export function phoneCapabilities(capacitor: unknown, adapter: unknown) {
  const get = (object: unknown, key: string): unknown => {
    try {
      return (object as Record<string, unknown> | null)?.[key]
    } catch {
      return undefined
    }
  }
  const names = (object: unknown): string[] => {
    try {
      return object ? Object.keys(object).sort() : []
    } catch {
      return []
    }
  }
  const plugins = get(capacitor, 'Plugins')
  const filesystem = get(plugins, 'Filesystem')
  const methods = (object: unknown, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, typeof get(object, key)]))
  const headers = get(capacitor, 'PluginHeaders')
  const filesystemHeader = Array.isArray(headers)
    ? headers.find((header) => get(header, 'name') === 'Filesystem')
    : get(headers, 'Filesystem')
  const version =
    get(filesystem, 'version') ??
    get(filesystem, 'pluginVersion') ??
    get(filesystemHeader, 'version')
  let platform: unknown = null
  const getPlatform = get(capacitor, 'getPlatform')
  if (typeof getPlatform === 'function') {
    try {
      platform = getPlatform.call(capacitor)
    } catch {
      platform = 'unavailable'
    }
  }
  return {
    capacitorExists: capacitor != null,
    capacitorVersion:
      typeof get(capacitor, 'version') === 'string' ? get(capacitor, 'version') : null,
    plugins: names(plugins),
    getPlatformType: typeof get(capacitor, 'getPlatform'),
    platform,
    filesystemHeader: filesystemHeader ?? null,
    filesystemExists: filesystem != null,
    filesystemNames: names(filesystem),
    filesystemVersion: typeof version === 'string' ? version : null,
    filesystemMethods: methods(filesystem, ['readFile', 'appendFile', 'stat', 'readFileInChunks']),
    readFileOffsetLength: 'unknown',
    readFileOffsetLengthReason:
      'The bridge does not expose a verified options schema; method presence or arity cannot prove ranged reads.',
    adapterMethods: methods(adapter, [
      'readBinary',
      'appendBinary',
      'readBinaryPrefix',
      'readBinaryRange',
      'readRange',
      'readFileRange',
    ]),
    adapterOwnNames: names(adapter),
  }
}
