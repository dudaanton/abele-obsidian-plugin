import { t, currentLocale } from './index'
/** Host language changes reload the plugin; each mounted tree uses that instance's locale. */
export const useI18n = () => ({ t, locale: currentLocale() })
