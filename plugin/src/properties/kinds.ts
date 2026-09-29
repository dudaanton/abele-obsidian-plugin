/**
 * Which of the plugin's own rows draws a property: a counter, a date, a priority, labels or
 * groups, by the lists of property names in the settings and the type Obsidian draws the property
 * as. A name in more than one list is drawn as the first of them, in that order. A listed property
 * holding what its kind cannot read — `someday` in a date — is left to Obsidian.
 */
import { counterKeys, counterValue, isCounterKey } from './counter'
import { renderCounter } from './counterWidget'
import { isDateValue } from './dates'
import { renderDate } from './dateWidget'
import { isGroupsValue } from './groups'
import { renderGroups } from './groupsWidget'
import { isLabelsValue } from './labels'
import { renderLabels } from './labelsWidget'
import { priorityLevel } from './priority'
import { renderPriority } from './priorityWidget'
import type { WidgetContext } from './widgets'

/** The property names of each kind, read each time a row is drawn. */
export interface KindLists {
  /** Drawn as counters. */
  counterKeys?: () => readonly string[]
  /** Drawn as dates stepped a day at a time. */
  dateKeys?: () => readonly string[]
  /** Drawn as a task priority. */
  priorityKeys?: () => readonly string[]
  /** Drawn as labels. */
  labelKeys?: () => readonly string[]
  /** Drawn as links to group notes. */
  groupKeys?: () => readonly string[]
}

/** Obsidian's own drawing of a type, for a kind that builds on it; null when it is not there. */
export type StockRender = (
  type: string
) => ((el: HTMLElement, value: unknown, ctx: WidgetContext) => unknown) | null

type Draw = (
  el: HTMLElement,
  value: unknown,
  ctx: WidgetContext,
  type: string,
  stock: StockRender
) => unknown

export type Kind = 'counter' | 'date' | 'priority' | 'labels' | 'groups'

/** Which kind draws a row, by the stock type the panel drew it as: the first listed wins. */
const KINDS_BY_TYPE: Record<string, Kind[]> = {
  number: ['counter'],
  text: ['counter', 'date', 'priority', 'labels', 'groups'],
  date: ['date'],
  datetime: ['date'],
  multitext: ['labels', 'groups'],
}

const KIND_READS: Record<Kind, (value: unknown) => boolean> = {
  counter: (v) => counterValue(v) !== null,
  date: isDateValue,
  priority: (v) => priorityLevel(v) !== null,
  labels: isLabelsValue,
  groups: isGroupsValue,
}

const KIND_DRAWS: Record<Kind, Draw> = {
  counter: renderCounter,
  date: renderDate,
  priority: renderPriority,
  labels: renderLabels,
  groups: renderGroups,
}

/** The row that draws a property, or null when Obsidian's own should. */
export function pickKind(lists: KindLists, key: string, value: unknown, type: string): Draw | null {
  const listed: Record<Kind, KindLists[keyof KindLists]> = {
    counter: lists.counterKeys,
    date: lists.dateKeys,
    priority: lists.priorityKeys,
    labels: lists.labelKeys,
    groups: lists.groupKeys,
  }
  for (const kind of KINDS_BY_TYPE[type] ?? []) {
    const names = listed[kind]?.() ?? []
    if (!names.length || !isCounterKey(key, counterKeys(names))) continue
    return KIND_READS[kind](value) ? KIND_DRAWS[kind] : null
  }
  return null
}
