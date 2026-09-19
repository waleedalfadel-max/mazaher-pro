export function createAmbiguousRequestCache(randomUUID = () => crypto.randomUUID()) {
  const requestIds = new Map()
  return {
    requestId(key) {
      if (!requestIds.has(key)) requestIds.set(key, randomUUID())
      return requestIds.get(key)
    },
    settle(key, errorCode) {
      if (errorCode !== 'AUTH_UNAVAILABLE') requestIds.delete(key)
    },
  }
}
