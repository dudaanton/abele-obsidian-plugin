export const connectionPrivateRoot = (id: string) =>
  '.abele-sync/connections/' + encodeURIComponent(id)
export const withinRoot = (path: string, root: string) =>
  path === root || path.startsWith(root + '/')
export const legacyPrivateDownload = (path: string) =>
  /^\.abele-sync\/placement-inbox\/[a-f0-9-]+$/.test(path)
/** Uncommitted inbox streams are never publication recovery, including another owner's. */
export const privateDownload = (path: string) =>
  legacyPrivateDownload(path) ||
  /^\.abele-sync\/connections\/[^/]+\/placement-inbox\/[a-f0-9-]+$/.test(path)

export const CONNECTION_HOST = Symbol.for('abele.sync.connection-host-v1')
export const CONNECTION_ROOT = Symbol.for('abele.sync.connection-root-v1')
export const connectionHost = (host: object): object => Reflect.get(host, CONNECTION_HOST) ?? host
export const connectionRoot = (app: object): string | undefined => Reflect.get(app, CONNECTION_ROOT)

export const CONNECTION_PRIVATE = Symbol.for('abele.sync.connection-private-v1')
export const connectionPrivateArea = (app: object): string | undefined =>
  Reflect.get(app, CONNECTION_PRIVATE)

export const CONNECTION_JOURNAL_OWNER = Symbol.for('abele.sync.connection-journal-owner-v1')
export const connectionJournalOwner = (app: object): string | undefined =>
  Reflect.get(app, CONNECTION_JOURNAL_OWNER)
