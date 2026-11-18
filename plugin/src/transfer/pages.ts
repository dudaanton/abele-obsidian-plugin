import { t } from '@/i18n'
import type { SectionId } from './types'

/**
 * The settings' own left column, as the groups Abele's sections sit under. Transfer and Sync
 * both list sections by it, so a person finds a section where the settings keep it. Functions,
 * not constants: the titles are read in the language chosen when they are drawn.
 */
export const pageOf = (section: SectionId): string => PAGE_OF()[section]

const PAGE_OF = (): Record<SectionId, string> => ({
  tasks: t('settings.TransferSettings.notes.8a7525b1'),
  journals: t('settings.TransferSettings.notes.8a7525b1'),
  calendars: t('settings.TransferSettings.notes.8a7525b1'),
  links: t('settings.TransferSettings.notes.8a7525b1'),
  linter: t('settings.TransferSettings.notes.8a7525b1'),
  reader: t('settings.TransferSettings.notes.8a7525b1'),
  maps: t('settings.TransferSettings.notes.8a7525b1'),
  finance: t('settings.TransferSettings.money_and_time.ebb5a49d'),
  'time-tracking': t('settings.TransferSettings.money_and_time.ebb5a49d'),
  'ai-general': t('settings.TransferSettings.agents.279b44d2'),
  'ai-providers': t('settings.TransferSettings.agents.279b44d2'),
  'ai-image-providers': t('settings.TransferSettings.agents.279b44d2'),
  'ai-agents': t('settings.TransferSettings.agents.279b44d2'),
  'ai-secrets': t('settings.TransferSettings.agents.279b44d2'),
  'ai-prompts': t('settings.TransferSettings.agents.279b44d2'),
  'ai-voice': t('settings.TransferSettings.agents.279b44d2'),
  'ai-mcp-servers': t('settings.TransferSettings.agents.279b44d2'),
  scripts: t('settings.TransferSettings.agents.279b44d2'),
  'script-files': t('settings.TransferSettings.agents.279b44d2'),
  'skill-notes': t('settings.TransferSettings.agents.279b44d2'),
  'prompt-notes': t('settings.TransferSettings.agents.279b44d2'),
  'chat-folder-access': t('settings.TransferSettings.agents.279b44d2'),
  github: t('settings.TransferSettings.agents.279b44d2'),
  'github-connections': t('settings.TransferSettings.agents.279b44d2'),
  'quick-button': t('settings.TransferSettings.buttons.d452583a'),
  'header-buttons': t('settings.TransferSettings.buttons.d452583a'),
  automations: t('settings.TransferSettings.buttons.d452583a'),
  sync: t('settings.TransferSettings.data.cec3a9b8'),
  connection: t('settings.TransferSettings.data.cec3a9b8'),
  other: t('settings.TransferSettings.data.cec3a9b8'),
})

export const pageTitles = (): string[] => [
  t('settings.TransferSettings.notes.8a7525b1'),
  t('settings.TransferSettings.money_and_time.ebb5a49d'),
  t('settings.TransferSettings.agents.279b44d2'),
  t('settings.TransferSettings.buttons.d452583a'),
  t('settings.TransferSettings.data.cec3a9b8'),
]

