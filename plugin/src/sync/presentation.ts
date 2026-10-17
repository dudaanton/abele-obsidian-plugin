/** A client supplies localized presentation without changing exchange data or diagnostics. */
export type SyncText = (
  template: string,
  values?: Record<string, string | number>,
  one?: string
) => string

export const englishSyncText: SyncText = (template, values = {}, one) =>
  (values.count === 1 && one ? one : template).replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  )
