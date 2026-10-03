import { AbeleConfig } from '@/services/AbeleConfig'
import { ReaderSettingsCache } from './settingsCache'

const settings = new ReaderSettingsCache()

/** Borrow the current normalized settings for reading, not for editing a draft. */
export const currentReaderSettings = () => settings.read(AbeleConfig.getInstance().reader)
