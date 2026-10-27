export function restartModes(controlRestarts = 3) {
  if (!Number.isInteger(controlRestarts) || controlRestarts < 1)
    throw new Error('At least one control restart is required')
  return [...Array(controlRestarts).fill('control'), 'profile-only']
}
