/** Focused reproductions for iterating before the full matrix qualification. */
import { targets } from './helpers/target'
import { chatScrollMatrixSuite } from './helpers/chatScrollMatrixSuite'

targets('desktop')
chatScrollMatrixSuite(
  process.env.ABELE_SCROLL_MATRIX_FILTER ||
    'wheel/medium/(text|finished-tool)|wheel/long/idle|touch/long/finished-reply'
)
