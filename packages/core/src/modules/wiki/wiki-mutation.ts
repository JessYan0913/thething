import path from 'node:path'

const wikiMutationQueues = new Map<string, Promise<unknown>>()

export async function withWikiMutationLock<T>(wikiDir: string, mutation: () => Promise<T>): Promise<T> {
  const key = path.resolve(wikiDir)
  const previous = wikiMutationQueues.get(key) ?? Promise.resolve()
  const next = previous
    .then(mutation, mutation)
    .finally(() => {
      if (wikiMutationQueues.get(key) === next) wikiMutationQueues.delete(key)
    })
  wikiMutationQueues.set(key, next)
  return next
}

export function clearWikiMutationLocks(): void {
  wikiMutationQueues.clear()
}
