import { GlobalStore } from '@/stores/GlobalStore'
import { SettingsEdits, settingsSnapshot } from './settingsEdits'
import { savedKeysWithIds } from '@/ai/savedKeyIds'
import { nanoid } from 'nanoid'
import { migrateMcpPermissions } from '@/ai/mcp/permissions'
import { notifyMcpPermissionReset } from '@/ai/mcp/settings'
import { Notice } from 'obsidian'
import { Journal, JournalDTO } from '@/entities/Journal'
import {
  AiSettings,
  DEFAULT_AI_SETTINGS,
  ImageProvider,
  migrateOldPermissions,
  type AiChatHistoryEntry,
} from '@/ai/types'
import { chatIndexDiskOf, mergeChatIndex } from '@/ai/chatIndexFile'
import { migrateAgents } from '@/ai/agents/migration'
import { pruneToolDescriptions } from '@/ai/tools/toolDescriptionOverrides'
import {
  DEFAULT_ACCOUNTS_LIST,
  normalizeAccountsList,
  type AccountsListSettings,
} from '@/helpers/accountRows'
import { defaultSyncSettings, migrateSyncSettings, type SyncSettings } from '@/sync/settings'
import AbelePlugin from '@/main'
import { isKitColor } from '@/constants/colors'
import { DEFAULT_LABEL_PROPERTY, type LabelColor } from '@/helpers/taskMeta'
import { DEFAULT_GITHUB_SETTINGS, githubSettingsFrom, type GithubSettings } from '@/github/settings'
import { projectLegacy } from '@/github/connections'
import { migrateLegacyConnectionAccess } from '@/github/agentAccess'
import {
  DEFAULT_CALENDAR_SETTINGS,
  calendarSettingsFrom,
  type CalendarSettings,
} from '@/calendars/settings'
import { completionMarksFrom, type CompletionMarks } from '@/calendars/completion'
import { DEFAULT_READER_SETTINGS, readerSettingsFrom, type ReaderSettings } from '@/reader/settings'
import { selectionMenuScriptsFrom } from '@/scripting/selectionMenuScripts'
import {
  DEFAULT_QUICK_BUTTON,
  quickButtonSettingsFrom,
  type QuickButtonSettings,
} from '@/quickButton/settings'
import { normalizeRule, type AutomationRule } from '@/automations/types'
import { moveLegacySecrets, notePlainSecrets } from '@/secrets/legacy'
import { DEFAULT_LIFE_YEARS, isBirthDate, lifeYears } from '@/bases/lifeWeeks'
import { DEFAULT_LINTER_SETTINGS, linterSettingsFrom, type LinterSettings } from '@/linter/settings'
import { isStoreFile } from '@/secrets/storeFile'
import {
  canonicalJson,
  isSettingsObject,
  localChanges,
  pause,
  reapply,
  settingsStampOf,
  UNREADABLE_RETRY_MS,
} from './settingsFile'

import type { AbeleConfig } from './AbeleConfig'
import { DEFAULT_SETTINGS, normalizeConditions, normalizeLink, normalizeHeaderButton, type AbeleSettings } from './settingsShape'

export interface Applied { migrated: boolean; indexInSettings: boolean }
export function applySettingsTo(config: AbeleConfig, settings: AbeleSettings | undefined, toolDefaults: Record<string,string>, index: AiChatHistoryEntry[]): Applied {
    config.refreshDelay = settings?.refreshDelay ?? DEFAULT_SETTINGS.refreshDelay
    config.tasksFolder = settings?.tasksFolder ?? DEFAULT_SETTINGS.tasksFolder
    config.logsNotesTypes = settings?.logsNotesTypes || [...DEFAULT_SETTINGS.logsNotesTypes]
    config.tasksTimeChoices = settings?.tasksTimeChoices || [...DEFAULT_SETTINGS.tasksTimeChoices]
    config.tasksDateChoices = settings?.tasksDateChoices || [...DEFAULT_SETTINGS.tasksDateChoices]
    config.tasksRecurrenceChoices = settings?.tasksRecurrenceChoices || [
      ...DEFAULT_SETTINGS.tasksRecurrenceChoices,
    ]
    config.weekStartsOnMonday = settings?.weekStartsOnMonday ?? DEFAULT_SETTINGS.weekStartsOnMonday
    // Both can be edited by hand; anything that is not a day or a life is left unset.
    config.birthDate = isBirthDate(settings?.birthDate) ? settings.birthDate : ''
    config.lifeExpectancy = lifeYears(settings?.lifeExpectancy, DEFAULT_LIFE_YEARS)
    config.taskLabelProperty =
      settings?.taskLabelProperty?.trim() || DEFAULT_SETTINGS.taskLabelProperty
    config.taskPriorityProperty =
      typeof settings?.taskPriorityProperty === 'string'
        ? settings.taskPriorityProperty.trim() || DEFAULT_SETTINGS.taskPriorityProperty
        : DEFAULT_SETTINGS.taskPriorityProperty
    // Cleaned on the way in: the file can be edited by hand, and a colour the kit has no class
    // for would render as nothing. Grey is the absence of a colour, so it is not stored.
    config.taskLabelColors = (settings?.taskLabelColors ?? [])
      .filter((c) => typeof c?.value === 'string' && c.value.trim() && isKitColor(c.color))
      .filter((c) => c.color !== 'grey')
      .map((c) => ({ value: c.value.trim(), color: c.color }))
    config.journals = (settings?.journals || [...DEFAULT_SETTINGS.journals]).map(
      (j) => new Journal(j)
    )
    config.busyDayThreshold = settings?.busyDayThreshold ?? DEFAULT_SETTINGS.busyDayThreshold
    config.excludedPathsForDefaultTemplate = settings?.excludedPathsForDefaultTemplate || [
      ...DEFAULT_SETTINGS.excludedPathsForDefaultTemplate,
    ]
    config.ai = settings?.ai ? { ...DEFAULT_AI_SETTINGS, ...settings.ai } : { ...DEFAULT_AI_SETTINGS }
    config.ai.chatSelectionScripts = selectionMenuScriptsFrom(config.ai.chatSelectionScripts)
    // The chat index is this device's, in a file of its own (`ai/chatIndexFile.ts`); settings
    // replace everything else but only add to it. One in the settings is an older build's, or
    // this device's own from before the move, and its chats are folded in, never dropped.
    const carried: unknown = (settings?.ai as { chatHistory?: unknown } | undefined)?.chatHistory
    const indexInSettings = Array.isArray(carried)
    config.ai.chatHistory = mergeChatIndex(index, Array.isArray(carried) ? carried : [])
    // Runs before the legacy migrations below, so a settings file predating both is folded
    // into an agent using the values it actually had on disk.
    let migrated = migrateAgents(config.ai)
    const savedKeys = savedKeysWithIds(config.ai.secrets ?? [])
    if (savedKeys.some((key, index) => key.id !== config.ai.secrets[index].id)) migrated = true
    config.ai.secrets = savedKeys
    // Settings used to save every default tool description, and a saved one replaces the
    // tool's own — so a vault stayed on the descriptions of the version that first saved it.
    // Only the ones the person changed are kept; the rest go, once, and the file is rewritten.
    const descriptions = pruneToolDescriptions(config.ai.prompts?.toolDescriptions, toolDefaults)
    if (descriptions.dropped > 0 && config.ai.prompts) {
      config.ai = {
        ...config.ai,
        prompts: { ...config.ai.prompts, toolDescriptions: descriptions.kept },
      }
      migrated = true
    }
    // Migrate old boolean permissions to toolModes
    if (
      settings?.ai &&
      !settings.ai.toolModes &&
      (settings.ai as any).allowWebSearch !== undefined
    ) {
      config.ai.toolModes = migrateOldPermissions(null, settings.ai as any)
    }
    const mcpPermissions = migrateMcpPermissions(config.ai)
    config.ai = mcpPermissions.ai
    migrated ||= mcpPermissions.changed
    notifyMcpPermissionReset(mcpPermissions.reset)
    // Migrate image generation settings to imageProviders
    if (settings?.ai && !settings.ai.imageProviders) {
      const old = settings.ai as any
      // Check for v2 format (single imageGeneration object)
      const ig = old.imageGeneration
      // Check for v1 format (openRouterApiKey + imageModel)
      const legacyKey = old.openRouterApiKey || ''
      const legacyModel = old.imageModel || ''

      if (ig) {
        // Migrate v2 → v3
        const provider: ImageProvider = {
          id: 'migrated-img',
          name: ig.apiType === 'openai' ? 'OpenAI' : 'OpenRouter',
          apiType: ig.apiType || 'openrouter',
          endpoint: ig.endpoint || '',
          apiKeyId: ig.apiKeyId || '',
          models: [
            {
              id: ig.model || 'gpt-image-1',
              name: ig.model || 'gpt-image-1',
              size: ig.size || '1024x1024',
              outputFormat: ig.outputFormat || 'png',
              quality: ig.quality || 'medium',
            },
          ],
        }
        config.ai.imageProviders = [provider]
        config.ai.defaultImageModel = `${provider.id}::${provider.models[0].id}`
      } else if (legacyKey || legacyModel) {
        // Migrate v1 → v3
        const modelId = legacyModel || 'google/gemini-2.5-flash-preview:thinking'
        const provider: ImageProvider = {
          id: 'migrated-img',
          name: 'OpenRouter',
          apiType: 'openrouter',
          endpoint: '',
          apiKeyId: legacyKey,
          models: [
            {
              id: modelId,
              name: modelId,
              size: '1024x1024',
              outputFormat: 'png',
              quality: 'medium',
            },
          ],
        }
        config.ai.imageProviders = [provider]
        config.ai.defaultImageModel = `${provider.id}::${modelId}`
      }
    }
    // Every field is checked on the way in, and a connection an older build wrote here is
    // dropped: it is this device's alone and lives in local storage now.
    config.sync = migrateSyncSettings(settings?.sync)
    config.transactionPathTemplate =
      settings?.transactionPathTemplate ?? DEFAULT_SETTINGS.transactionPathTemplate
    config.transactionTemplatePath =
      settings?.transactionTemplatePath ?? DEFAULT_SETTINGS.transactionTemplatePath
    config.accountsFolder = settings?.accountsFolder ?? DEFAULT_SETTINGS.accountsFolder
    config.financeCategoriesFolder =
      settings?.financeCategoriesFolder ?? DEFAULT_SETTINGS.financeCategoriesFolder
    config.defaultCurrency = settings?.defaultCurrency ?? DEFAULT_SETTINGS.defaultCurrency
    config.pinnedCurrencies = settings?.pinnedCurrencies ?? DEFAULT_SETTINGS.pinnedCurrencies
    config.fireflyBaseUrl = settings?.fireflyBaseUrl ?? DEFAULT_SETTINGS.fireflyBaseUrl
    config.fireflyToken = settings?.fireflyToken ?? DEFAULT_SETTINGS.fireflyToken ?? ''
    notePlainSecrets(this)
    config.accountsList = normalizeAccountsList(settings?.accountsList)
    config.timeEntryPathTemplate =
      settings?.timeEntryPathTemplate ?? DEFAULT_SETTINGS.timeEntryPathTemplate
    config.timeTrackableNoteTypes = settings?.timeTrackableNoteTypes || [
      ...DEFAULT_SETTINGS.timeTrackableNoteTypes,
    ]
    config.timeTrackAllNotes = settings?.timeTrackAllNotes ?? DEFAULT_SETTINGS.timeTrackAllNotes
    config.links = (settings?.links || []).map(normalizeLink)
    config.headerButtons = (settings?.headerButtons || []).map(normalizeHeaderButton)
    config.automations = (Array.isArray(settings?.automations) ? settings.automations : []).map(
      (rule) => normalizeRule(rule)
    )
    config.mapCoordinatesProperty =
      settings?.mapCoordinatesProperty ?? DEFAULT_SETTINGS.mapCoordinatesProperty
    config.mapStyleUrl = settings?.mapStyleUrl ?? DEFAULT_SETTINGS.mapStyleUrl
    config.snippetsFolder = settings?.snippetsFolder ?? DEFAULT_SETTINGS.snippetsFolder
    config.fullWidthSidebars = settings?.fullWidthSidebars ?? DEFAULT_SETTINGS.fullWidthSidebars
    config.halfWidthSidebarsOnTablet =
      settings?.halfWidthSidebarsOnTablet ?? DEFAULT_SETTINGS.halfWidthSidebarsOnTablet
    config.mermaidViewer = settings?.mermaidViewer ?? DEFAULT_SETTINGS.mermaidViewer ?? true
    config.canvasViewer = settings?.canvasViewer ?? DEFAULT_SETTINGS.canvasViewer ?? true
    config.editorSyntaxHighlight =
      settings?.editorSyntaxHighlight ?? DEFAULT_SETTINGS.editorSyntaxHighlight ?? true
    config.propertyWidgets = settings?.propertyWidgets ?? DEFAULT_SETTINGS.propertyWidgets ?? true
    config.rememberNotePlaces =
      settings?.rememberNotePlaces ?? DEFAULT_SETTINGS.rememberNotePlaces ?? true
    config.counterProperties = Array.isArray(settings?.counterProperties)
      ? settings.counterProperties.filter((name): name is string => typeof name === 'string')
      : []
    // A list never saved takes the default; one emptied by hand stays empty.
    const names = (list: unknown, fallback: string[] = []) =>
      Array.isArray(list)
        ? list.filter((name): name is string => typeof name === 'string')
        : [...fallback]
    config.dateProperties = names(settings?.dateProperties, DEFAULT_SETTINGS.dateProperties)
    config.priorityProperties = names(
      settings?.priorityProperties,
      DEFAULT_SETTINGS.priorityProperties
    )
    config.labelProperties = names(settings?.labelProperties, DEFAULT_SETTINGS.labelProperties)
    config.groupProperties = names(settings?.groupProperties, DEFAULT_SETTINGS.groupProperties)
    config.keyboardDiagnostics = settings?.keyboardDiagnostics ?? false
    config.github = githubSettingsFrom(settings?.github)
    if (migrateLegacyConnectionAccess(config.ai.agents ?? [], config.github.connections))
      migrated = true
    if (
      settings?.github &&
      (!Array.isArray(settings.github.connections) ||
        settings.github.keyId !== config.github.keyId ||
        settings.github.server !== config.github.server ||
        settings.github.legacyServer !== config.github.legacyServer ||
        settings.github.defaultRepo !== config.github.defaultRepo ||
        JSON.stringify(settings.github.connections) !== JSON.stringify(config.github.connections))
    )
      migrated = true
    config.reader = readerSettingsFrom(settings?.reader)
    config.calendars = calendarSettingsFrom(settings?.calendars)
    config.calendarCompletion = completionMarksFrom(settings?.calendarCompletion)
    config.quickButton = quickButtonSettingsFrom(settings?.quickButton)
    config.linter = linterSettingsFrom(settings?.linter)
    config.secretStore = settings?.secretStore

    return { migrated, indexInSettings }
}

export function exportSettingsOf(config: AbeleConfig, outOfSettings: boolean): AbeleSettings {
    return {
      refreshDelay: config.refreshDelay,
      tasksFolder: config.tasksFolder,
      logsNotesTypes: [...config.logsNotesTypes],
      tasksTimeChoices: [...config.tasksTimeChoices],
      tasksDateChoices: [...config.tasksDateChoices],
      tasksRecurrenceChoices: [...config.tasksRecurrenceChoices],
      weekStartsOnMonday: config.weekStartsOnMonday,
      birthDate: config.birthDate,
      lifeExpectancy: config.lifeExpectancy,
      taskLabelProperty: config.taskLabelProperty,
      taskPriorityProperty: config.taskPriorityProperty,
      taskLabelColors: config.taskLabelColors.map((c) => ({ ...c })),
      journals: config.journals.map((j) => j.toDTO()),
      busyDayThreshold: config.busyDayThreshold,
      excludedPathsForDefaultTemplate: [...config.excludedPathsForDefaultTemplate],
      // The chat index is not a setting: it is in a file of its own once that file holds it.
      ai: outOfSettings || false ? withoutChatIndex(config.ai) : { ...config.ai },
      // A copy all the way down rather than a spread: the migration already knows how to build
      // one field by field.
      sync: migrateSyncSettings(config.sync),
      transactionPathTemplate: config.transactionPathTemplate,
      transactionTemplatePath: config.transactionTemplatePath,
      accountsFolder: config.accountsFolder,
      financeCategoriesFolder: config.financeCategoriesFolder,
      defaultCurrency: config.defaultCurrency,
      pinnedCurrencies: config.pinnedCurrencies,
      fireflyBaseUrl: config.fireflyBaseUrl,
      ...(config.fireflyToken ? { fireflyToken: config.fireflyToken } : {}),
      accountsList: { ...config.accountsList, types: [...config.accountsList.types] },
      timeEntryPathTemplate: config.timeEntryPathTemplate,
      timeTrackableNoteTypes: [...config.timeTrackableNoteTypes],
      timeTrackAllNotes: config.timeTrackAllNotes,
      links: [...config.links],
      headerButtons: [...config.headerButtons],
      automations: config.automations.map((rule) => ({
        ...rule,
        noteTypes: [...rule.noteTypes],
        folders: [...rule.folders],
        params: { ...rule.params },
      })),
      mapCoordinatesProperty: config.mapCoordinatesProperty,
      mapStyleUrl: config.mapStyleUrl,
      snippetsFolder: config.snippetsFolder,
      fullWidthSidebars: config.fullWidthSidebars,
      halfWidthSidebarsOnTablet: config.halfWidthSidebarsOnTablet,
      mermaidViewer: config.mermaidViewer,
      canvasViewer: config.canvasViewer,
      editorSyntaxHighlight: config.editorSyntaxHighlight,
      propertyWidgets: config.propertyWidgets,
      rememberNotePlaces: config.rememberNotePlaces,
      counterProperties: [...config.counterProperties],
      dateProperties: [...config.dateProperties],
      priorityProperties: [...config.priorityProperties],
      labelProperties: [...config.labelProperties],
      groupProperties: [...config.groupProperties],
      keyboardDiagnostics: config.keyboardDiagnostics,
      github: projectLegacy(config.github),
      reader: { ...config.reader },
      calendars: {
        ...config.calendars,
        feeds: config.calendars.feeds.map((feed) => ({ ...feed })),
      },
      calendarCompletion: completionMarksFrom(config.calendarCompletion),
      quickButton: {
        ...config.quickButton,
        actions: config.quickButton.actions.map((action) => ({ ...action })),
      },
      // Through JSON: every rule's parameters are plain data, and nested lists stay unshared.
      linter: JSON.parse(JSON.stringify(config.linter)) as LinterSettings,
      // Falsy but present values are damaged stores, not a request to forget device keys.
      ...(config.secretStore !== undefined && config.secretStore !== null
        ? { secretStore: config.secretStore }
        : {}),
    }
  }
