import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { uploadToStorage, getSignedUrl } from '../lib/storage'
import { compressImage } from '../lib/imageCompress'
import { analyzeDocument } from '../lib/claude'
import { savedDocumentWarning } from '../lib/analysisFeedback'
import { Ban, Camera, CircleAlert, CircleCheck, FileText, LoaderCircle, Plus, RotateCcw, Upload, X } from 'lucide-react'
import { Button, IconButton, Note, Panel, Segment, Status } from '../ui/components.jsx'
import { DropZone, MyUploads, fileIcon } from '../components/UploadKit.jsx'
import InvoicePagesComposer from '../components/InvoicePagesComposer.jsx'
import { getProjectSettings, getTransactionTypes } from '../lib/projectSettings.js'
import { activeCategories } from '../lib/categorySettings'

const MAX_SIZE_MB = 10
const ROLE_AR = { purchasing: 'مسؤول المشتريات', accountant: 'المحاسب', owner: 'المالك' }

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader()
  r.onload  = e => res(e.target.result.split(',')[1])
  r.onerror = rej
  r.readAsDataURL(file)
})

const ALLOWED = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']

const STATUS_LABEL = {
  pending:   'في الانتظار',
  uploading: 'جارٍ الرفع...',
  analyzing: 'جارٍ التحليل...',
  done:      'تم التحليل',
  review:    'محفوظ للمراجعة',
  error:     'خطأ',
}

export default function InvoiceUpload() {
  const { role, userName, projectId, projectName, branch } = useAuth()
  const [files, setFiles]         = useState([])  // [{ file, status, error }]
  const [uploading, setUploading] = useState(false)
  const [allDone, setAllDone]     = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [myDocs, setMyDocs]             = useState([])
  const [myDocsLoading, setMyDocsLoading] = useState(true)
  const [deleteError, setDeleteError]   = useState('')
  // «files»: كل ملف مستند مستقل (الافتراضي). «pages»: صور صفحات فاتورة واحدة تُجمع في PDF واحد (InvoicePagesComposer)
  const [mode, setMode] = useState('files')
  const inputRef = useRef()

  const loadMyDocs = useCallback(async () => {
    if (!projectId || !userName) return
    setMyDocsLoading(true)
    const { data } = await supabase.from('documents')
      .select('id,file_name,file_type,status,uploaded_at,file_url')
      .eq('project_id', projectId)
      .eq('uploaded_by_name', userName)
      .order('uploaded_at', { ascending: false })
      .limit(10)
    setMyDocs(data || [])
    setMyDocsLoading(false)
  }, [projectId, userName])

  useEffect(() => { loadMyDocs() }, [loadMyDocs])

  async function deleteMyDoc(doc) {
    // التأكيد في حوار MyUploads قبل الوصول إلى هنا
    if (doc.status === 'approved') return
    setDeleteError('')
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) { setDeleteError(error.message); return }
    setMyDocs(ds => ds.filter(d => d.id !== doc.id))
  }

  function handleFiles(fileList) {
    const newEntries = []
    for (const f of fileList) {
      if (!ALLOWED.includes(f.type)) {
        newEntries.push({ file: f, status: 'error', error: 'صيغة غير مدعومة' })
        continue
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        newEntries.push({ file: f, status: 'error', error: `يتجاوز ${MAX_SIZE_MB}MB` })
        continue
      }
      newEntries.push({ file: f, status: 'pending', error: '' })
    }
    setFiles(prev => [...prev, ...newEntries])
    setAllDone(false)
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  function updateFile(index, patch) {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, ...patch } : f))
  }

  // القراءة الآلية تقترح من التصنيفات المتاحة للاستعمال الجديد فقط (المعطّل يبقى للقيود السابقة)
  async function readingContext() {
    const { data: allCats } = await supabase.from('categories')
      .select('id,name,parent_id,type,sort_order,is_active')
      .eq('project_id', projectId).order('sort_order')
    const cats = activeCategories(allCats)
    const [readingSettings, readingTypes] = await Promise.all([getProjectSettings(projectId),getTransactionTypes(projectId)])
    return { cats, readingSettings, readingTypes }
  }

  // حجم طلب القراءة الفعلي لصفحات فاتورة مجمّعة، بالتعليمات والتصنيفات نفسها، قبل رفعها (لا إرسال)
  async function measurePages(base64, name) {
    const { cats, readingSettings, readingTypes } = await readingContext()
    return analyzeDocument(base64, 'application/pdf', name, role, cats || [], projectName || '', readingTypes, false, readingSettings?.settings || {}, { measureOnly: true })
  }

  async function uploadPages(file, pageCount) {
    const list = [{ file, status: 'pending', error: '', group: true, pageCount }]
    setFiles(list)
    await upload(list)
  }

  async function upload(list = files) {
    if (!list.some(f => f.status === 'pending')) return
    setUploading(true)

    const { cats, readingSettings, readingTypes } = await readingContext()

    for (let i = 0; i < list.length; i++) {
      if (list[i].status !== 'pending') continue
      const files = list
      updateFile(i, { status: 'uploading', error: '' })
      try {
        // صفحات الفاتورة المجمّعة PDF جاهز (ضُغطت صوره عند التجهيز)
        const uploadFile = files[i].group ? files[i].file : files[i].file.type.startsWith('image/')
          ? await compressImage(files[i].file) : files[i].file
        const fileBase64 = await toBase64(uploadFile)

        const fileUrl = await uploadToStorage(uploadFile, projectId || 'shared')
        const { data: docData, error: err } = await supabase.from('documents').insert({
          project_id:  projectId,
          file_name:   files[i].file.name,
          file_type:   uploadFile.type,
          file_url:    fileUrl,
          status:      'uploaded',
          uploaded_by: role,
          uploaded_by_name: userName,
          // فرع الكاشير يُحفظ مع المستند كما كانت تفعل لوحة الكاشير الملغاة (يستعمله الاعتماد لتقرير المبيعات وقيوده)
          branch: role === 'cashier' ? (branch || null) : null,
        }).select('id').single()
        if (err) throw new Error(err.message)

        updateFile(i, { status: 'analyzing' })
        try {
          const result = await analyzeDocument(fileBase64, uploadFile.type, files[i].file.name, role, cats || [], projectName || '', readingTypes, false, readingSettings?.settings || {})

          const invoiceCount = result?.invoices?.length || 0
          if (!invoiceCount) throw new Error('EMPTY_ANALYSIS')
          if (invoiceCount > 1) {
            // صفحات فاتورة واحدة قُرئت كعدة فواتير: خطأ قراءة لا خطأ رفع؛ يبقى المستند للمراجعة مع تنبيه، ولا دمج تلقائي
            if (files[i].group) {
              updateFile(i, { multiInvoiceWarning: true, invoiceCount })
            } else if (role === 'purchasing' || role === 'cashier') {
              if (docData?.id) await supabase.from('documents').delete().eq('id', docData.id)
              updateFile(i, { status: 'error', error: '', multiInvoice: true, invoiceCount })
              continue
            }
            updateFile(i, { multiInvoiceWarning: true, invoiceCount })
          }
          if (result && docData?.id) {
            const { data: saved, error: saveError } = await supabase.from('documents')
              .update({ analysis_result: result, status: 'analyzed' }).eq('id', docData.id).select('id').single()
            if (saveError || !saved?.id) throw new Error('ANALYSIS_SAVE_UNCONFIRMED')
          }
        } catch (e) {
          updateFile(i, { status: 'review', error: savedDocumentWarning(e) })
          continue
        }

        updateFile(i, { status: 'done' })
      } catch (e) {
        updateFile(i, { status: 'error', error: e.message })
      }
    }

    setUploading(false)
    setAllDone(true)
    loadMyDocs()
  }

  function reset() { setFiles([]); setAllDone(false) }

  // يفتح نافذة فارغة فوراً (يتجنّب حاجب النوافذ المنبثقة) ثم يوجّهها لرابط موقَّت بعد جلبه
  async function openDoc(fileUrl) {
    const win = window.open('', '_blank')
    const url = await getSignedUrl(fileUrl)
    if (!win) return
    if (url) win.location.href = url
    else win.close()
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const doneCount    = files.filter(f => f.status === 'done').length
  const reviewCount  = files.filter(f => f.status === 'review').length
  const errorCount   = files.filter(f => f.status === 'error').length
  const savedCount   = doneCount + reviewCount

  const subtitle = role === 'purchasing' ? 'ارفع الفواتير — سيراجعها المحاسب ويعتمدها'
    : role === 'owner' ? 'ارفع إيصالات السداد أو الفواتير'
    : 'ارفع مستنداً وسيظهر في قائمة المراجعة'
  const FILE_STATUS = {
    pending:   { tone: 'neutral' },
    uploading: { tone: 'info', busy: true },
    analyzing: { tone: 'info', busy: true },
    done:      { tone: 'success' },
    review:    { tone: 'warning' },
    error:     { tone: 'danger' },
  }
  const summaryTone = errorCount && !savedCount ? 'error' : errorCount || reviewCount ? 'warning' : 'success'

  return (
    <div className="rp-upload">
      <div className="ts-heading">
        <div>
          <h1>رفع مستندات</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <Note tone="info" icon={Camera} title="قبل التصوير">
        <ul className="rp-tips">
          <li>صوّر كل فاتورة في صورة منفصلة.</li>
          <li>يمكنك رفع أكثر من صورة في الوقت نفسه.</li>
          <li><strong>لا تضع أكثر من فاتورة في صورة واحدة.</strong></li>
          <li>فاتورة طويلة من عدة صفحات: اختر «صور صفحات فاتورة واحدة» وصوّر كل صفحة.</li>
        </ul>
      </Note>

      {!uploading && !files.some(f => f.status !== 'pending') && (
        <Segment label="طريقة الرفع" value={mode} full
          onChange={v => { if (v !== mode) { setMode(v); setFiles([]); setAllDone(false) } }}
          options={[{ value: 'files', label: 'ملفات مستقلة — كل ملف فاتورة' }, { value: 'pages', label: 'صور صفحات فاتورة واحدة' }]} />
      )}

      {mode === 'pages' && !allDone && (
        <InvoicePagesComposer disabled={uploading} measure={measurePages} onSubmit={uploadPages} />
      )}

      {mode === 'files' && !uploading && (
        <DropZone inputRef={inputRef} dragOver={dragOver} setDragOver={setDragOver} onFiles={handleFiles}
          title={files.length ? 'أضف صورًا أخرى: اسحبها هنا أو اضغط للاختيار' : 'اسحب الصور هنا أو اضغط للاختيار'}
          hint="فاتورة واحدة لكل صورة — يمكن رفع عدة صور معًا"
          formats={`JPG · PNG · WEBP · HEIC · PDF — الحد ${MAX_SIZE_MB} ميجابايت`}
          inputProps={{ accept: 'image/*,.pdf', multiple: true }} />
      )}

      {files.some(f => !f.multiInvoice) && (
        <Panel title="الملفات المختارة" icon={FileText} clip>
          <ul className="rp-uploads">
            {files.map((entry, i) => {
              if (entry.multiInvoice) return null
              const Icon = fileIcon(entry.file.type)
              const st = FILE_STATUS[entry.status] || FILE_STATUS.pending
              return (
                <li key={i}>
                  <span className="rp-upload-open">
                    <span className="rp-doc-icon"><Icon className="ts-icon" aria-hidden="true" /></span>
                    <span className="rp-upload-name">
                      <strong>{entry.file.name}</strong>
                      <small className="ts-num">{entry.group ? `${entry.pageCount} صفحات في ملف واحد · ` : ''}{(entry.file.size / 1024).toFixed(0)} KB</small>
                      {entry.error && <small className={entry.status === 'review' ? 'rp-upload-warn' : 'ts-field-error'}>{entry.error}</small>}
                      {entry.multiInvoiceWarning && <small className="rp-upload-warn">{entry.group
                        ? `قُرئت صفحات الفاتورة كـ${entry.invoiceCount} فواتير — سيراجعها المحاسب مع الصفحات، ولن يُدمج شيء تلقائيًا`
                        : `اكتُشف ${entry.invoiceCount} فواتير — راجع القراءة`}</small>}
                    </span>
                  </span>
                  <Status tone={st.tone} busy={st.busy}>{STATUS_LABEL[entry.status]}</Status>
                  {entry.status === 'pending' && !uploading && (
                    <IconButton bare label={`إزالة ${entry.file.name}`} icon={X} onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} />
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      {files.map((entry, i) => entry.multiInvoice && (
        <Note key={`m${i}`} tone="error" icon={Ban} title={`رُفضت الصورة: فيها ${entry.invoiceCount} فواتير`}
          action={<Button variant="primary" icon={RotateCcw} onClick={reset}>حاول مرة ثانية</Button>}>
          <span className="rp-upload-file">{entry.file.name}</span>
          <ul className="rp-tips"><li>صوّر كل فاتورة في صورة منفصلة.</li><li>يمكنك رفع عدة صور في الوقت نفسه.</li></ul>
        </Note>
      ))}

      {allDone && !uploading && !files.every(f => f.multiInvoice) && (
        <Note tone={summaryTone} icon={summaryTone === 'success' ? CircleCheck : CircleAlert}
          title={savedCount > 0 ? `حُفظ ${savedCount} مستند للمراجعة` : 'تعذّر حفظ المستندات'}
          action={<Button icon={Plus} onClick={reset}>رفع مزيد من الفواتير</Button>}>
          {reviewCount > 0 && <p>تعذّر إكمال تحليل {reviewCount} مستند تلقائيًا. المستندات محفوظة ولا تحتاج إلى إعادة الرفع.</p>}
          {errorCount > 0 && savedCount > 0 && <p>لم يُحفظ {errorCount} مستند — تحقق من الأخطاء أعلاه.</p>}
        </Note>
      )}

      {!uploading && pendingCount > 0 && (
        <Button variant="primary" full icon={Upload} className="rp-upload-go" onClick={() => upload()}>
          رفع {pendingCount} {pendingCount === 1 ? 'مستند' : 'مستندات'}
        </Button>
      )}

      {uploading && (
        <Note tone="info" icon={LoaderCircle} title="جارٍ معالجة الملفات...">لا تغلق الصفحة حتى ينتهي الرفع والقراءة.</Note>
      )}

      {deleteError && <Note tone="error" icon={CircleAlert} title="فشل الحذف">{deleteError}</Note>}
      <MyUploads docs={myDocs} loading={myDocsLoading} onOpen={openDoc} onDelete={deleteMyDoc} />
    </div>
  )
}
