import { getLanguage } from 'obsidian'
import { resolveLocale } from './core'
/** Public host API, read at the reload boundary before commands or views register. */
export const hostLocale = () => resolveLocale(getLanguage())
