import { en } from './locales/en/pilot'
import { t } from './index'
import type { MessageKey } from './types'
import { SECTIONS } from '../transfer/entries'
import { TOOL_SECTIONS, sectionToolName, sectionLabel } from '../ai/toolSections'
import { isMcpToolName } from '../ai/mcp/names'

// Only plugin-owned display metadata is looked up here; user names and wire labels stay raw.
const metadata = new Map<string, MessageKey>(
  Object.entries(en)
    .filter(([key, value]) => key.startsWith('settings.metadata.') && typeof value === 'string')
    .map(([key, value]) => [value as string, key as MessageKey])
)
// Older transfer payloads and tool metadata retain their stable labels on the wire.
metadata.set('GitHub', 'settings.GithubSettings.git_hosting.a3002011')
metadata.set('GitHub connections', 'settings.git.repositoryConnections')
metadata.set('GitHub tabs', 'settings.metadata.b9227122bad532e6')
metadata.set('Chat folder access', 'chatTree.transferLabel')
const blockSections = new Set<string>(
  SECTIONS.filter((section) => section.kind === 'block').map((section) => section.id)
)
const toolSections = new Map(
  TOOL_SECTIONS.map((section) => [sectionToolName(section.id), section.group])
)

export function settingsLabel(english: string): string {
  const key = metadata.get(english)
  // Metadata is complete display copy, including any literal property-template examples.
  return key ? (t as (key: MessageKey) => string)(key) : english
}

export function settingsToolLabel(tool: { name: string; label: string }): string {
  if (
    isMcpToolName(tool.name) ||
    (tool.name.startsWith('script_') && tool.name !== 'script_api_docs')
  )
    return tool.label
  const section = toolSections.get(tool.name)
  if (section)
    return t('settings.tools.openSection', { section: settingsLabel(sectionLabel(section)) })
  return settingsLabel(tool.label)
}

export function settingsOptions<T extends { display: string }>(options: readonly T[]): T[] {
  return options.map((option) => ({ ...option, display: settingsLabel(option.display) }))
}

/** Serialized transfer entries retain their original labels, including custom list names. */
export function transferLabel(entry: { id: string; section: string; label: string }): string {
  return blockSections.has(entry.section) && entry.id === entry.section
    ? settingsLabel(entry.label)
    : entry.label
}
