/**
 * Which of Abele's own settings sections this device syncs, as the connection window shows it.
 *
 * The choice is the device's own (never in `data.json`): a ticked section travels with the
 * plugin's settings file, an unticked one stays as this device has it and nothing arriving
 * changes it. A section's keys travel with it, but only through synced keys.
 *
 * This file is the screen's side of it: what a row needs to be drawn and what pressing it asks
 * for. The engine behind it is not reached from here, so the same screen can be shown on
 * made-up data.
 */
import { shallowRef, type Ref } from 'vue'
import type { SectionId } from '@/transfer/types'

export interface AbeleSectionRow {
  id: SectionId
  /** The section's name as Transfer names it. */
  label: string
  /** Keys the section's settings point at. */
  keys: number
  /** Of those, how many this device does not have. */
  missing: number
  /** Sections this one names things in: agents name providers. */
  needs?: SectionId[]
}

/** Where synced keys stand on this device. */
export type KeyStoreState = 'on' | 'off' | 'locked'

/** A section both devices changed apart: the arrived version was taken, this one kept. */
export interface KeptSection {
  id: SectionId
  /** The device whose version arrived. */
  from: string
  at: number
  /** A deliberate re-enable choice retained the alternative, rather than an offline conflict. */
  choice?: boolean
}

export interface AbeleSectionsSource {
  rows: Ref<AbeleSectionRow[]>
  chosen: Ref<ReadonlySet<SectionId>>
  keys: Ref<KeyStoreState>
  kept: Ref<KeptSection[]>
  /** Whether this device's copy of a section differs from the vault's, asked before ticking. */
  differs: (id: SectionId) => Promise<boolean>
  /** Ticks or unticks; ticking a section that differs names which version both keep. */
  choose: (id: SectionId, on: boolean, take?: 'vault' | 'device') => Promise<void>
  /** Puts this device's kept version back and sends it. */
  restore: (id: SectionId) => Promise<void>
  /** Opens synced keys in the settings, to turn them on or unlock them. */
  openKeys: () => void
}

/** Set by the plugin when sync starts, or by a design stand. */
export const abeleSectionsSource = shallowRef<AbeleSectionsSource | null>(null)
