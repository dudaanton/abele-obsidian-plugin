/** Full native-input regression matrix, including emulated phone touch input. */
import { targets } from './helpers/target'
import { chatScrollMatrixSuite } from './helpers/chatScrollMatrixSuite'

targets('desktop')
chatScrollMatrixSuite(process.env.ABELE_SCROLL_MATRIX_FILTER)
