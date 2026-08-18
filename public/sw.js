// يطابق مسار الشعار بعد نقله إلى bucket public-assets العام
// (كان سابقاً '__app__/logo.png' داخل bucket documents)
const LOGO_PATH = 'public-assets/logo.png'

// عند التفعيل: احذف كل الـ cache القديم
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const url = event.request.url

  // اللوقو دائماً من الشبكة بدون cache
  if (url.includes(LOGO_PATH)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
    return
  }

  // الـ manifest دائماً من الشبكة
  if (url.endsWith('/manifest.json')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
    return
  }
})
