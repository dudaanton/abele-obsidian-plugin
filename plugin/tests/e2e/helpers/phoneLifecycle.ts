/** Runs in the page; keep this function self-contained for eval serialization. */
export function phoneLifecycle(win: Window, action?: string) {
  type EventRow = { kind: string; at: number; visibility: string; persisted: boolean }
  type RecordRow = {
    timeOrigin: number
    navigation: string
    action: string
    actionAt: number
    events: EventRow[]
  }
  type Api = {
    mark(action: string): void
    snapshot(): { current: RecordRow; previous: RecordRow | null; storageAvailable: boolean }
  }
  const host = win as Window & { __abelePhoneLifecycle?: Api }
  if (host.__abelePhoneLifecycle) {
    if (action !== undefined) host.__abelePhoneLifecycle.mark(action)
    return host.__abelePhoneLifecycle
  }
  const key = 'abele-e2e-phone-lifecycle-v1'
  const actions = new Set([
    'case-start',
    'type-focus',
    'type-keys',
    'type-driver',
    'sync-action',
    'open Share picker',
    'inline results above the native keyboard',
    'cancel Share picker',
    'open group server-delete preview',
    'cancel server deletion',
  ])
  const kinds = new Set([
    'beforeunload',
    'pagehide',
    'pageshow',
    'visibilitychange',
    'submit',
    'anchor-click',
    'popstate',
    'hashchange',
  ])
  const safeAction = (value: unknown) =>
    typeof value === 'string' && actions.has(value) ? value : 'sync-action'
  const navigation = (value: unknown) =>
    ['navigate', 'reload', 'back_forward', 'prerender'].includes(String(value))
      ? String(value)
      : 'unknown'
  const visibility = (value: unknown) =>
    value === 'visible' || value === 'hidden' ? value : 'unknown'
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  let storageAvailable = true
  let previous: RecordRow | null = null
  try {
    const saved = win.sessionStorage.getItem(key)
    const row = saved && saved.length <= 8192 ? JSON.parse(saved) : null
    if (row && typeof row === 'object' && typeof row.timeOrigin === 'number')
      previous = {
        timeOrigin: number(row.timeOrigin),
        navigation: navigation(row.navigation),
        action: safeAction(row.action),
        actionAt: number(row.actionAt),
        events: Array.isArray(row.events)
          ? row.events.slice(-16).flatMap((event: Partial<EventRow> | null) =>
              event && kinds.has(String(event.kind))
                ? [
                    {
                      kind: String(event.kind),
                      at: number(event.at),
                      visibility: visibility(event.visibility),
                      persisted: event.persisted === true,
                    },
                  ]
                : []
            )
          : [],
      }
  } catch {
    storageAvailable = false
  }
  let nav = 'unknown'
  try {
    nav = navigation(
      (win.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
        ?.type
    )
  } catch {
    /* Optional host evidence. */
  }
  const current: RecordRow = {
    timeOrigin: win.performance.timeOrigin,
    navigation: nav,
    action: 'sync-action',
    actionAt: Date.now(),
    events: [],
  }
  const save = () => {
    try {
      win.sessionStorage.setItem(key, JSON.stringify(current))
    } catch {
      storageAvailable = false
    }
  }
  const record = (kind: string, event: Event) => {
    current.events.push({
      kind,
      at: Date.now(),
      visibility: visibility(win.document.visibilityState),
      persisted: (event as PageTransitionEvent).persisted === true,
    })
    if (current.events.length > 16) current.events.shift()
    save()
  }
  for (const kind of ['beforeunload', 'pagehide', 'pageshow', 'popstate', 'hashchange'])
    win.addEventListener(kind, (event) => record(kind, event))
  win.document.addEventListener('visibilitychange', (event) => record('visibilitychange', event))
  win.document.addEventListener('submit', (event) => record('submit', event), true)
  win.document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null
      if (typeof target?.closest === 'function' && target.closest('a[href]'))
        record('anchor-click', event)
    },
    true
  )
  const api: Api = {
    mark(value) {
      current.action = safeAction(value)
      current.actionAt = Date.now()
      save()
    },
    snapshot() {
      return {
        current: structuredClone(current),
        previous: previous && structuredClone(previous),
        storageAvailable,
      }
    },
  }
  host.__abelePhoneLifecycle = api
  api.mark(action ?? 'sync-action')
  return api
}
