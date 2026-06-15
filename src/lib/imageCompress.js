// للاستخدام عندما عندنا base64 string بدل File object (مثل PendingDocuments)
export async function compressImageBase64(base64, mime, maxSizeMB = 3, maxWidth = 1400) {
  if (!mime || !mime.startsWith('image/')) return base64
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: mime })
  const file = new File([blob], 'image', { type: mime })
  const compressed = await compressImage(file, maxSizeMB, maxWidth)
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result.split(',')[1])
    reader.readAsDataURL(compressed)
  })
}

export async function compressImage(file, maxSizeMB = 3, maxWidth = 1400) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let width = img.width
        let height = img.height
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        let quality = 0.85
        canvas.toBlob(
          (blob) => {
            if (blob.size > maxSizeMB * 1024 * 1024) {
              quality = 0.7
              canvas.toBlob(
                (blob2) => resolve(new File([blob2], file.name, { type: 'image/jpeg' })),
                'image/jpeg', quality
              )
            } else {
              resolve(new File([blob], file.name, { type: 'image/jpeg' }))
            }
          },
          'image/jpeg', quality
        )
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}
