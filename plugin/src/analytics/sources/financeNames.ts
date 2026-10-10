import { getNameFromPath } from '@/helpers/pathsHelpers'

/** The display label shared by transaction, flow and balance tables. */
export const name = (path: string | null): string => (path ? getNameFromPath(path) : '')
