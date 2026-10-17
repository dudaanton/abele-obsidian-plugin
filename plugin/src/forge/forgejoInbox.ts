import { forgejoUrls } from './forgejoUrls'
import { forgejoConnectionClient } from './forgejoConnections'
import type { ForgejoClient } from './forgejoClient'

export interface NativeNotification {
  id: string
  repo: string
  title: string
  type: string
  updatedAt: string
  unread: boolean
  pinned: boolean
  url: string
  tab: boolean
  note?: string
}
export interface NativeInboxSnapshot {
  items: NativeNotification[]
  cutoff: string
  complete: boolean
}
interface RawThread {
  id: number
  unread: boolean
  pinned: boolean
  updated_at: string
  repository: { full_name: string }
  subject: { title: string; type: string; html_url?: string; latest_comment_html_url?: string }
}
/** Read is a notification mutation only. Neither service has GitHub's separate Done state. */
export class NativeInbox {
  private readonly snapshots = new WeakSet<NativeInboxSnapshot>()
  private readonly notifications = new WeakSet<NativeNotification>()
  constructor(readonly client: ForgejoClient) {}
  async load(which: 'all' | 'unread'): Promise<NativeInboxSnapshot> {
    const statuses = which === 'all' ? '&status-types=read&status-types=pinned' : ''
    const page = await this.client.pages<RawThread>(
      `/notifications?status-types=unread${statuses}`,
      50,
      4
    )
    const urls = forgejoUrls(this.client.deployment),
      items: NativeNotification[] = []
    for (const raw of page.value) {
      if (!Number.isSafeInteger(raw.id) || raw.id < 1 || !raw.repository?.full_name || !raw.subject)
        continue
      let repo: string
      try {
        repo = urls.repository(raw.repository.full_name)
      } catch {
        continue
      }
      const address = raw.subject.latest_comment_html_url || raw.subject.html_url
      const target = address ? urls.parse(address) : null
      const safe = target && `${target.owner}/${target.repo}` === raw.repository.full_name
      let browser = false
      if (address && !safe) {
        try {
          const candidate = new URL(address),
            root = new URL(repo)
          browser =
            !candidate.username &&
            !candidate.password &&
            candidate.origin === root.origin &&
            candidate.pathname.startsWith(`${root.pathname}/`) &&
            !/%2f|%5c/i.test(candidate.pathname)
        } catch {
          /* A malformed target leaves the repository as an explicit fallback. */
        }
      }
      const item: NativeNotification = {
        id: String(raw.id),
        repo: raw.repository.full_name,
        title: raw.subject.title,
        type: raw.subject.type,
        updatedAt: raw.updated_at,
        unread: raw.unread,
        pinned: raw.pinned,
        url: safe || browser ? address : repo,
        tab: !browser,
        ...(!safe
          ? {
              note: browser
                ? 'This notification target is not available in a tab. Open in browser.'
                : 'The notification target is unavailable. Open the repository instead.',
            }
          : {}),
      }
      items.push(item)
      this.notifications.add(item)
    }
    this.client.session.assertCurrent()
    // Use observed service activity, never the device clock (which can run ahead).
    const dates = items.map((item) => Date.parse(item.updatedAt)).filter(Number.isFinite)
    const cutoff = new Date(dates.length ? Math.max(...dates) : 0).toISOString()
    const snapshot = { items, cutoff, complete: page.complete && dates.length === items.length }
    this.snapshots.add(snapshot)
    return snapshot
  }
  open(item: NativeNotification): { url: string; tab: boolean } {
    this.client.session.assertCurrent()
    if (!this.notifications.has(item))
      throw new Error('This notification belongs to another inbox.')
    return { url: item.url, tab: item.tab }
  }
  async markRead(item: NativeNotification): Promise<void> {
    this.open(item)
    if (item.pinned)
      throw new Error(
        'Marking a pinned notification read without unpinning it is not available for this service.'
      )
    await this.client.write(
      'PATCH',
      `/notifications/threads/${encodeURIComponent(item.id)}?to-status=read`,
      undefined,
      'none',
      true
    )
  }
  async markAllRead(snapshot: NativeInboxSnapshot, repository = ''): Promise<void> {
    this.client.session.assertCurrent()
    if (!this.snapshots.has(snapshot))
      throw new Error('This notification snapshot belongs to another inbox.')
    if (!snapshot.complete)
      throw new Error(
        'The inbox snapshot is incomplete. Mark the displayed rows read individually.'
      )
    if (repository) forgejoUrls(this.client.deployment).repository(repository)
    const path = repository
      ? `/repos/${repository.split('/').map(encodeURIComponent).join('/')}/notifications`
      : '/notifications'
    await this.client.write(
      'PUT',
      `${path}?last_read_at=${encodeURIComponent(snapshot.cutoff)}&status-types=unread&to-status=read&all=false`,
      undefined,
      'none',
      true
    )
  }
  async markDone(_item: NativeNotification): Promise<never> {
    throw new Error(
      'Done is not available for this service. Mark read keeps the notification in the inbox.'
    )
  }
}
const inboxes = new Map<string, NativeInbox>()
export function nativeInboxFor(id: string): NativeInbox {
  const client = forgejoConnectionClient(id),
    key = `${id}:${client.session.generation}`
  let inbox = inboxes.get(key)
  if (!inbox) {
    inbox = new NativeInbox(client)
    inboxes.set(key, inbox)
    while (inboxes.size > 8) inboxes.delete(inboxes.keys().next().value)
  }
  return inbox
}
