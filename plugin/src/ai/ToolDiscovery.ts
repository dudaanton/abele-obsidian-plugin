import type { AgentTool } from './client/types'
import {
  ALWAYS_LOADED_GROUPS,
  SECTION_TOOL_PREFIX,
  TOOL_SECTIONS,
  genericSectionDescription,
  sectionIdOfGroup,
  sectionToolName,
} from './toolSections'

export interface ToolGroupInfo {
  name: string
  label: string
  category: string
}

/** One section as this conversation may use it: only the tools its modes allow. */
export interface ToolSection {
  id: string
  /** `open_<id>`. */
  toolName: string
  group: string
  description: string
  howTo: string
  tools: AgentTool[]
}

/**
 * What a conversation offers, before a provider decides how to send it. `loaded` goes with every
 * request; `deferred` is what a provider with native deferred loading would send unloaded. The
 * plugin's `/chat/completions` clients cannot defer, so `emulatedTools` sends `loaded` alone and
 * an open section's tools are part of it from the request after the open call.
 */
export interface ToolOffer {
  loaded: AgentTool[]
  deferred: ToolSection[]
  sections: ToolSection[]
}

export interface SectionOfferInput {
  /** Already filtered by the agent's and chat's modes: Off never reaches here. */
  allowed: AgentTool[]
  metadata: readonly ToolGroupInfo[]
  /** Tools the conversation's context brings, always loaded whatever their group. */
  context: ReadonlySet<string>
  /** Section ids open on this branch, in the order they were opened. */
  open: readonly string[]
  /** Whether a call to this tool asks the person first. */
  asks?: (tool: AgentTool) => boolean
  /** What the section's tools work on right now, when the section has any such thing. */
  live?: (id: string) => string | undefined
  /** The person's own words for a section tool, by tool name. */
  overrides?: Readonly<Record<string, string>>
}

/** The first sentence of a tool's description, for the one-line list an open call returns. */
function firstLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?]\s/)
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence
}

/** Sections from the allowed tools: one per settings group outside the always-loaded ones. */
export function buildSections(input: SectionOfferInput): {
  loaded: AgentTool[]
  sections: ToolSection[]
} {
  const info = new Map(input.metadata.map((t) => [t.name, t]))
  const byGroup = new Map<string, AgentTool[]>()
  const loaded: AgentTool[] = []
  for (const tool of input.allowed) {
    const group = info.get(tool.name)?.category ?? tool.category ?? 'Other'
    if (input.context.has(tool.name) || ALWAYS_LOADED_GROUPS.has(group)) {
      loaded.push(tool)
      continue
    }
    const list = byGroup.get(group) ?? []
    list.push(tool)
    byGroup.set(group, list)
  }
  const byName = new Map(input.allowed.map((t) => [t.name, t]))
  const defined = TOOL_SECTIONS.map((s) => s.group)
  const groups = [
    ...defined.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !defined.includes(g)).sort((a, b) => a.localeCompare(b)),
  ]
  const sections: ToolSection[] = []
  const taken = new Set<string>()
  for (const group of groups) {
    const def = TOOL_SECTIONS.find((s) => s.group === group)
    const tools = [...(byGroup.get(group) ?? [])]
    for (const name of def?.also ?? []) {
      const extra = byName.get(name)
      if (extra && !tools.includes(extra)) tools.push(extra)
    }
    let id = def?.id ?? sectionIdOfGroup(group)
    for (let n = 2; taken.has(id); n++) id = `${sectionIdOfGroup(group)}_${n}`
    taken.add(id)
    const labels = tools.map((t) => info.get(t.name)?.label ?? t.label ?? t.name)
    const toolName = sectionToolName(id)
    sections.push({
      id,
      toolName,
      group,
      description:
        input.overrides?.[toolName] || def?.description || genericSectionDescription(group, labels),
      howTo: def?.howTo ?? '',
      tools,
    })
  }
  return { loaded, sections }
}

/** The text an open call returns: the tools now open, how to use them, and what is live. */
export function sectionGuide(section: ToolSection, input: SectionOfferInput): string {
  const lines = section.tools.map(
    (t) =>
      `- ${t.name}${input.asks?.(t) ? ' (asks the person first)' : ''}: ${firstLine(t.description)}`
  )
  const parts = [
    `${section.group} is open. These tools are available from your next step:\n${lines.join('\n')}`,
  ]
  if (section.howTo) parts.push(`How to use them:\n${section.howTo}`)
  const live = input.live?.(section.id)
  if (live) parts.push(`Right now:\n${live}`)
  parts.push('Permissions are unchanged: a tool that asks still asks.')
  return parts.join('\n\n')
}

const sectionOpeners = new WeakSet<AgentTool>()
/** Identity belongs to this factory; a remote tool cannot claim to be a discovery helper. */
export const isSectionOpener = (tool: AgentTool): boolean => sectionOpeners.has(tool)

function sectionTool(section: ToolSection, input: SectionOfferInput): AgentTool {
  const names = section.tools.map((t) => t.name).join(', ')
  const tool: AgentTool = {
    name: section.toolName,
    label: `Open ${section.group}`,
    category: section.group,
    description: `${section.description}\n\nOpens: ${names}.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: [{ type: 'text', text: sectionGuide(section, input) }] }),
  }
  sectionOpeners.add(tool)
  return tool
}

/**
 * The tools of a conversation in section mode. Order is what keeps a provider's prompt cache:
 * the always-loaded tools, then every section tool, then the open sections' tools in the order
 * they were opened — so opening a section only ever appends.
 */
export function offerSections(input: SectionOfferInput): ToolOffer {
  const { loaded, sections } = buildSections(input)
  const out = [...loaded, ...sections.map((s) => sectionTool(s, input))]
  const seen = new Set(out.map((t) => t.name))
  const openIds = new Set<string>()
  for (const id of input.open) {
    const section = sections.find((s) => s.id === id)
    if (!section || openIds.has(id)) continue
    openIds.add(id)
    for (const tool of section.tools) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)
      out.push(tool)
    }
  }
  return { loaded: out, deferred: sections.filter((s) => !openIds.has(s.id)), sections }
}

/** What a `/chat/completions` request carries: everything loaded, nothing deferred. */
export function emulatedTools(offer: ToolOffer): AgentTool[] {
  return offer.loaded
}

/** Why a tool the agent called is not there, when it is only waiting for its section. */
export function closedSectionHint(name: string, offer: ToolOffer): string | undefined {
  const section = offer.deferred.find((s) => s.tools.some((t) => t.name === name))
  if (!section) return undefined
  return `"${name}" is in the ${section.group} section, which is not open in this chat. Call ${section.toolName} first; its tools are available from your next step.`
}

/** A record of a tool call on the conversation's active branch, as far as sections care. */
export interface SectionCallRecord {
  role: string
  toolName?: string
  toolStatus?: string
  toolResult?: string
}

/**
 * The sections opened on a branch, in order: every open call on the path from the root to the
 * active message that ran and returned. A sibling branch that never opened one does not have it,
 * and rewinding past the call closes it again.
 */
export function openSectionsOnPath(path: readonly SectionCallRecord[]): string[] {
  const out: string[] = []
  for (const m of path) {
    if (m.role !== 'tool-call' || !m.toolName?.startsWith(SECTION_TOOL_PREFIX)) continue
    if (m.toolStatus !== 'approved' || m.toolResult === undefined) continue
    const id = m.toolName.slice(SECTION_TOOL_PREFIX.length)
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** Several sources of open sections, in order, without repeats. */
export function mergeOpen(...lists: (readonly string[])[]): string[] {
  const out: string[] = []
  for (const list of lists) for (const id of list) if (!out.includes(id)) out.push(id)
  return out
}
