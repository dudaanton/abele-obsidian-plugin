import {
  isTokenPath,
  tokenView,
  validTokenPath,
  tokenValue,
  writeToken,
  tokenNext,
  tokenFailure,
} from './settingsTokenConnection'
import { isPrototypeName } from '@/helpers/prototypeNames'
export const reachesPrototype = (path: string) => path.split('.').some(isPrototypeName)
export const invalidPath = (path: string) => `"${path}" is not a valid field path.`
export const ownKey = (object: unknown, key: string) =>
  typeof object === 'object' && object !== null && Object.prototype.hasOwnProperty.call(object, key)
export const isDevicePath = isTokenPath
export const isValidDevicePath = (path: string) => !reachesPrototype(path) && validTokenPath(path)
export const deviceView = (): Record<string, unknown> => ({ connections: tokenView() })
export const deviceValue = (path: string): unknown =>
  isValidDevicePath(path) ? tokenValue(path) : undefined
export const writeDevice = (path: string, next: unknown): Promise<string | null> =>
  isValidDevicePath(path) ? writeToken(path, next) : Promise.resolve(invalidPath(path))
export const deviceTypes = (_path: string): readonly string[] | null => null
export const deviceNext = tokenNext
export const startFailure = tokenFailure
export const deviceWarning = (path: string, _next: unknown): string | null =>
  path.endsWith('.address')
    ? 'A connected token stays with its original server. Use a new token for another server.'
    : null
