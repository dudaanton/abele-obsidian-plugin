import { t } from '../../src/i18n'

t('kit.cancel')
t('kit.showMore', { count: 2 })
t('kit.noIcon', { query: 'sample' })
// @ts-expect-error unknown key
t('kit.notAKey')
// @ts-expect-error missing placeholder
t('kit.noIcon')
// @ts-expect-error count must be numeric
t('kit.showMore', { count: '2' })
// @ts-expect-error extra placeholder
t('kit.noIcon', { query: 'sample', extra: 1 })
// @ts-expect-error parameterless keys do not accept arguments
t('kit.cancel', {})
