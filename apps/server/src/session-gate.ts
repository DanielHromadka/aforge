// A snapshot reserves one execution synchronously before checking busy jobs or copying files.
const readers = new Map<string, number>()
const frozen = new Set<string>()
const conflict = () => Object.assign(new Error('Session se právě ukládá nebo mění. Zkuste akci znovu.'), { statusCode: 409 })
export const enterMutation = (id: string) => {
  if (frozen.has(id)) throw conflict()
  readers.set(id, (readers.get(id) ?? 0) + 1)
  let released = false
  return () => { if (!released) { released = true; const n = (readers.get(id) ?? 1) - 1; if (n) readers.set(id, n); else readers.delete(id) } }
}
export const exclusiveSession = async <T>(id: string, job: () => Promise<T>): Promise<T> => {
  if (frozen.has(id) || readers.has(id)) throw conflict()
  frozen.add(id)
  try { return await job() } finally { frozen.delete(id) }
}
