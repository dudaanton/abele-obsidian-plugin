import type { ExternalFileHost, ExternalHostRequest } from './external/ObsidianExternalFileHost'
import type { ExternalSerialization } from './external/coordination'
import type { ExternalFileEffects } from './external/filesystem'
import type { LocalFolderPlacement } from './localFolderPlacement'

/** External state keeps canonical paths; reservations and effects use physical local paths. */
export function placedExternalHost(
  host: ExternalFileHost,
  placement?: LocalFolderPlacement
): ExternalFileHost {
  if (!placement) return host
  const map = (value: unknown, path: (value: string) => string): any => {
    if (typeof value === 'string') return path(value)
    if (Array.isArray(value)) return value.map((item) => map(item, path))
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
      return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['path', 'paths', 'artifact', 'artifacts'].includes(key) ? map(item, path) : item,
      ])
    )
  }
  const privatePrefix = host.artifactPath?.('')
  const privatePath = (path: string) => {
    return (
      !!privatePrefix &&
      path.startsWith(privatePrefix) &&
      !path.includes('\\') &&
      path.split('/').every((part) => part !== '.' && part !== '..' && part.length > 0)
    )
  }
  const local = (value: unknown) =>
    map(value, (path) => (privatePath(path) ? path : placement.toLocal(path)))
  const server = (value: unknown) =>
    map(value, (path) => (privatePath(path) ? path : placement.toServer(path)))
  return new Proxy(host, {
    get(target, key) {
      if (key === 'run')
        return <T>(
          serial: ExternalSerialization,
          request: ExternalHostRequest,
          work: (effects: ExternalFileEffects) => Promise<T>
        ) =>
          target.run(
            serial,
            {
              ...request,
              paths: request.paths.map((path) => local(path)),
              assertIntent: (phase, paths, artifact) =>
                request.assertIntent(phase, server(paths), server(artifact)),
            },
            (effects) =>
              work(
                new Proxy(effects, {
                  get(target, key) {
                    const value = Reflect.get(target, key)
                    return typeof value === 'function'
                      ? async (...args: unknown[]) =>
                          server(await value.apply(target, args.map(local)))
                      : value
                  },
                })
              )
          )
      const value = Reflect.get(target, key)
      if (
        ['read', 'exists', 'openRead', 'fingerprint', 'prepareRemoval', 'matches'].includes(
          String(key)
        )
      )
        return (...args: unknown[]) => value.apply(target, args.map(local))
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
