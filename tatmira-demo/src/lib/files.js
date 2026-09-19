// ملفات النموذج تُحفظ في IndexedDB على هذا الجهاز فقط — لا رفع لأي تخزين خارجي.
// إن تعذّر IndexedDB (تصفح خاص مثلاً) تبقى في الذاكرة حتى إغلاق الصفحة.

const DB_NAME = 'tatmira-demo-files'
const STORE = 'files'
const memory = new Map()
let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function withStore(mode, fn) {
  const db = await openDb()
  if (!db) return null
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result ?? true)
      tx.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function putFile(id, blob) {
  memory.set(id, blob)
  await withStore('readwrite', s => s.put(blob, id))
}

export async function getFile(id) {
  if (memory.has(id)) return memory.get(id)
  const blob = await withStore('readonly', s => s.get(id))
  if (blob instanceof Blob) memory.set(id, blob)
  return blob instanceof Blob ? blob : null
}

export async function clearFiles() {
  memory.clear()
  await withStore('readwrite', s => s.clear())
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
