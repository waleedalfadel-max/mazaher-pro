import { useState } from 'react'
import { Dialog } from '../ui/components.jsx'
import { compactEntryDescription } from '../lib/entryDescription.js'

export default function EntryDescription({ row }) {
  const [open, setOpen] = useState(false)
  const full = String(row?.description || row?.type || '—')
  const brief = compactEntryDescription(row)
  if (brief === full.replace(/\s+/g, ' ').trim()) return <span className="entry-description">{brief}</span>
  return <>
    <button type="button" className="entry-description entry-description--button" title="عرض البيان الكامل"
      aria-label={`عرض البيان الكامل: ${brief}`} onClick={() => setOpen(true)}>{brief}</button>
    <Dialog open={open} title="البيان الكامل" onClose={() => setOpen(false)}>
      <p className="entry-description-full" dir="auto">{full}</p>
    </Dialog>
  </>
}
