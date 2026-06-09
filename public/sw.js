const LOGO_PATH = '__app__/logo.png'

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
