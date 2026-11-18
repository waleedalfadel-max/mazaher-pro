import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { originalTextReader, storagePath } from '../server/documentText.js'

test('original search reads a printed image and searchable multi-page PDF in batches', async () => {
  const reader = originalTextReader()
  try {
    const picture = createCanvas(850,180)
    const ctx = picture.getContext('2d')
    ctx.fillStyle='white'; ctx.fillRect(0,0,850,180); ctx.fillStyle='black'
    ctx.font='60px sans-serif'; ctx.fillText('Invoice 82095',30,110)
    const png = picture.toBuffer('image/png')
    assert.match((await reader.read(png,'image/png')).text,/82095/)
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let i=1;i<=3;i++) pdf.addPage().drawText('Supplier '+i,{x:20,y:100,font})
    const scan = await pdf.embedPng(png)
    pdf.addPage().drawImage(scan,{x:0,y:300,width:515,height:110})
    const bytes = Buffer.from(await pdf.save())
    const first=await reader.read(bytes,'application/pdf')
    assert.equal(first.next,4); assert.match(first.text,/Supplier 3/)
    const last=await reader.read(bytes,'application/pdf',first.next)
    assert.equal(last.next,null); assert.match(last.text,/82095/)
  } finally { await reader.close() }
})

test('original reader only downloads the selected tenant object in its own bucket', () => {
  const host='https://storage.test'
  const job={project_id:'project-A',source_url: host+'/storage/v1/object/public/documents/project-A/photo%201.jpg'}
  assert.equal(storagePath(job,host),'project-A/photo 1.jpg')
  assert.throws(()=>storagePath({...job,project_id:'project-B'},host))
  assert.throws(()=>storagePath(job,'https://another.test'))
})
