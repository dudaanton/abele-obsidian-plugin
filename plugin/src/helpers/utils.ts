export const uniqueArray = <T>(array: T[]): T[] => {
  return Array.from(new Set(array))
}

export const arraify = <T>(value: T | T[]): T[] => {
  if (Array.isArray(value)) {
    return value
  } else {
    return [value]
  }
}

export const arraifyOrEmpty = <T>(value: T | T[] | undefined): T[] => {
  if (Array.isArray(value)) {
    return value
  } else if (value === undefined || value === null) {
    return []
  } else {
    return [value]
  }
}
