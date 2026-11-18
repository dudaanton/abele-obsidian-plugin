import { SECTIONS, isDeviceOnly } from '@/transfer/entries'
import { canonicalJson } from '@/services/settingsFile'
import type { AbeleSettings } from '@/services/settingsShape'
import type { SectionId } from '@/transfer/types'
import type { KeptSection } from './abeleSections'
import { githubSettingsFrom } from '@/github/settings'
import { projectLegacy } from '@/github/connections'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const sections = SECTIONS.filter((section) => section.id !== 'sync' && !isDeviceOnly(section.id))
type Values = Partial<Record<SectionId, unknown>>
interface LocalSections {
  v: 1
  chosen: SectionId[]
  local: Values
  remote: Values
  base: Values
  kept: (KeptSection & { value: unknown })[]
  sender?: string
}
export interface SectionStorage {
  read(): unknown
  write(value: unknown): void
}

/** Section ownership comes from Transfer; local choices and recovery values never enter data.json. */
export class SectionSettings {
  readonly ids = sections.map((section) => section.id)
  private state: LocalSections
  private restoring = new Map<SectionId, object>()
  constructor(
    private readonly storage: SectionStorage,
    private readonly deviceName = 'Another device'
  ) {
    const saved = storage.read() as LocalSections | null
    if (
      saved?.v === 1 &&
      Array.isArray(saved.chosen) &&
      saved.local &&
      saved.remote &&
      saved.base &&
      Array.isArray(saved.kept)
    ) {
      this.state = clone(saved)
      this.state.chosen = this.state.chosen.filter((id) => this.ids.includes(id))
    } else {
      if (saved !== null && saved !== undefined)
        throw new Error('Device settings section policy is unreadable; shared settings were kept')
      this.state = { v: 1, chosen: [...this.ids], local: {}, remote: {}, base: {}, kept: [] }
    }
  }
  get chosen(): ReadonlySet<SectionId> {
    return new Set(this.state.chosen)
  }
  get kept(): KeptSection[] {
    return [...new Map(this.state.kept.map(({ id, from, at }) => [id, { id, from, at }])).values()]
  }
  private values(settings: AbeleSettings): Values {
    return Object.fromEntries(
      sections.map((section) => [section.id, clone(section.read(settings))])
    )
  }
  private put(settings: AbeleSettings, values: Values, ids: readonly SectionId[]): AbeleSettings {
    const next = clone(settings)
    for (const section of sections) {
      if (!ids.includes(section.id) || !Object.hasOwn(values, section.id)) continue
      // Each section's writer owns exactly the same keys as Transfer, including empty lists.
      const value = clone(values[section.id])
      if (section.kind === 'list') section.write(next, value as ReturnType<typeof section.read>)
      else {
        section.clear?.(next)
        section.write(next, value as Record<string, unknown>)
      }
    }
    if (ids.includes('github-connections') && next.github)
      next.github = projectLegacy(githubSettingsFrom(next.github))
    return next
  }
  private save(): void {
    this.storage.write(clone(this.state))
  }
  private keep(id: SectionId, value: unknown, from: string): void {
    this.state.kept.push({ id, value: clone(value), from, at: Date.now() })
  }
  receive(incoming: AbeleSettings, mine?: AbeleSettings, from = 'Another device'): AbeleSettings {
    const remote = this.values(incoming)
    const local = mine ? this.values(mine) : this.state.local
    for (const id of this.ids) {
      if (
        this.chosen.has(id) &&
        Object.hasOwn(this.state.base, id) &&
        Object.hasOwn(local, id) &&
        canonicalJson(local[id]) !== canonicalJson(this.state.base[id]) &&
        canonicalJson(remote[id]) !== canonicalJson(this.state.base[id]) &&
        canonicalJson(remote[id]) !== canonicalJson(local[id])
      )
        this.keep(id, local[id], from)
    }
    this.state.remote = remote
    const sender = (incoming as unknown as { _abeleSectionDevice?: unknown })._abeleSectionDevice
    this.state.sender = typeof sender === 'string' ? sender.slice(0, 200) : undefined
    const ownIds = this.ids.filter(
      (id) =>
        !this.chosen.has(id) ||
        (mine !== undefined &&
          Object.hasOwn(this.state.base, id) &&
          canonicalJson(remote[id]) === canonicalJson(this.state.base[id]))
    )
    this.state.base = clone(remote)
    const applied = this.put(incoming, local, ownIds)
    this.state.local = this.values(applied)
    this.save() // Recovery is durable before the incoming version can replace memory.
    return applied
  }
  project(mine: AbeleSettings): AbeleSettings {
    this.state.local = this.values(mine)
    const off = this.ids.filter((id) => !this.chosen.has(id))
    this.save() // A crash after the wire write still has the device's unticked settings.
    const projected = this.put(mine, this.state.remote, off)
    const changed = this.ids.some(
      (id) =>
        this.chosen.has(id) &&
        canonicalJson(this.state.local[id]) !== canonicalJson(this.state.remote[id])
    )
    const sender = changed ? this.deviceName : this.state.sender
    if (sender) (projected as unknown as Record<string, unknown>)._abeleSectionDevice = sender
    return projected
  }
  differs(id: SectionId, mine: AbeleSettings): boolean {
    return (
      Object.hasOwn(this.state.remote, id) &&
      canonicalJson(this.values(mine)[id]) !== canonicalJson(this.state.remote[id])
    )
  }
  choose(
    id: SectionId,
    on: boolean,
    mine: AbeleSettings,
    take?: 'vault' | 'device'
  ): AbeleSettings {
    if (!this.ids.includes(id)) throw new Error('This section cannot be synced')
    const different = on && !this.chosen.has(id) && this.differs(id, mine)
    if (different && !take) throw new Error('Choose which section version to keep')
    let next = mine
    if (different) {
      const own = this.values(mine)[id]
      this.keep(id, take === 'vault' ? own : this.state.remote[id], 'Another device')
      if (take === 'vault') next = this.put(mine, this.state.remote, [id])
    }
    this.state.local = this.values(next)
    const chosen = new Set(this.state.chosen)
    if (on) chosen.add(id)
    else chosen.delete(id)
    this.state.chosen = [...chosen]
    this.save()
    return next
  }
  restore(id: SectionId, mine: AbeleSettings): AbeleSettings {
    const kept = this.state.kept.findLast((item) => item.id === id)
    if (!kept) throw new Error('No retained version of this section')
    const next = this.put(mine, { [id]: kept.value }, [id])
    this.state.local = this.values(next)
    this.restoring.set(id, kept)
    if (!this.state.chosen.includes(id)) this.state.chosen.push(id)
    // Kept until a successful settings save; repeating Restore is safe after an interrupted save.
    this.save()
    return next
  }
  restored(id: SectionId): void {
    const restored = this.restoring.get(id)
    if (!restored) return
    this.state.kept = this.state.kept.filter((item) => item !== restored)
    this.restoring.delete(id)
    this.save()
  }
}
