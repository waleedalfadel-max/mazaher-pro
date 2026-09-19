const signatureFor = (command, file) => JSON.stringify(command) + (file ? `|${file.name}|${file.size}|${file.lastModified}` : '')

/**
 * Serializes optimistic-revision writes and gives identical concurrent UI
 * submissions one promise/request id. Ambiguous network failures retain the
 * descriptor so the next user retry is idempotent at the server receipt layer.
 */
export function createMutationCoordinator({
  getRevision,
  setRevision,
  send,
  refresh,
  onStart = () => {},
  onFinish = () => {},
  onSuccess = () => {},
  onError = () => {},
  randomUUID = () => crypto.randomUUID(),
}) {
  let tail = Promise.resolve()
  const pending = new Map()
  const retryable = new Map()

  function dispatch(command, file = null) {
    const signature = signatureFor(command, file)
    if (pending.has(signature)) return pending.get(signature)
    const descriptor = retryable.get(signature) || { command, file, requestId: randomUUID(), revision: getRevision() }

    const task = tail.then(async () => {
      descriptor.revision = getRevision()
      onStart(command)
      try {
        const saved = await send(descriptor)
        retryable.delete(signature)
        setRevision(saved.revision)
        await refresh('success')
        onSuccess(command, saved)
        return { state: null, code: saved.duplicate ? 'ALREADY_SAVED' : undefined, documentId: saved.documentId, revision: saved.revision }
      } catch (error) {
        if (error.code === 'FINANCE_UNAVAILABLE') retryable.set(signature, descriptor)
        else retryable.delete(signature)
        if (error.code === 'CONFLICT') await refresh('conflict').catch(() => {})
        onError(error)
        return { state: null, code: error.code, error: error.message }
      } finally {
        pending.delete(signature)
        onFinish(command)
      }
    })

    tail = task.then(() => undefined)
    pending.set(signature, task)
    return task
  }

  return {
    dispatch,
    pendingCount: () => pending.size,
    retryRequestId: command => retryable.get(signatureFor(command, null))?.requestId || null,
  }
}
