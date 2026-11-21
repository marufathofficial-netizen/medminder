self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { title: 'MedMinder', body: '' }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body }))
})
