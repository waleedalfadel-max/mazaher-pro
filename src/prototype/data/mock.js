// بيانات مصطنعة بالكامل لنموذج التصميم: لا تأتي من أي قاعدة، ولا تشبه بيانات منشأة حقيقية.
// المولّد حتمي (بذرة ثابتة)، فتتكرر الأرقام نفسها في كل تشغيل وفي كل صورة مراجعة.
import { addDays, toISO } from '../../ui/format.js'
import { TODAY, USERS, docTotals, round2 } from '../model.js'
import { createSettings } from '../settings.js'

export const BUSINESS = { name: 'مطعم تجريبي', branch: 'الفرع الرئيسي' }

function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SUPPLIERS = [
  { party: 'مورد الخضار والفواكه', category: 'خضار وفواكه', prefix: 'A-', start: 2201, every: 2, by: 'purchasing', payment: 'cash',
    items: [['طماطم (كرتون)', 38, 45], ['بصل (كيس)', 30, 36], ['خس (كرتون)', 42, 50], ['ليمون (كرتون)', 55, 65], ['بطاطس (كيس 10 كجم)', 28, 34]] },
  { party: 'مورد اللحوم والدواجن', category: 'لحوم ودواجن', prefix: '', start: 4402, every: 3.5, by: 'purchasing', payment: 'credit',
    items: [['دجاج مبرد (كرتون 10 كجم)', 150, 175], ['لحم بقري مفروم (كجم)', 42, 48], ['صدور دجاج (كجم)', 26, 30]] },
  { party: 'المخبز المركزي', category: 'مخبوزات', prefix: 'B-', start: 710, every: 2.3, by: 'cashier', payment: 'cash',
    items: [['خبز برجر (كيس 12)', 9, 11], ['خبز صامولي (كيس 10)', 7, 8], ['تورتيلا (كيس)', 12, 14]] },
  { party: 'مورد الألبان والأجبان', category: 'ألبان وأجبان', prefix: 'D', start: 3310, every: 7, by: 'purchasing', payment: 'bank',
    items: [['جبن شرائح (كجم)', 34, 38], ['حليب (كرتون)', 55, 60], ['زبدة (كجم)', 36, 40]] },
  { party: 'مورد المواد الجافة', category: 'مواد جافة وبهارات', prefix: 'S-', start: 1180, every: 7, by: 'purchasing', payment: 'bank',
    items: [['زيت قلي (تنكة 17 لتر)', 115, 130], ['أرز (كيس 10 كجم)', 70, 80], ['بهارات مشكلة (كجم)', 45, 55], ['صلصات (كرتون)', 85, 95]] },
  { party: 'مورد التغليف', category: 'تغليف وأدوات تقديم', prefix: 'P-', start: 560, every: 14, by: 'purchasing', payment: 'bank',
    items: [['علب برجر (كرتون 500)', 160, 180], ['أكياس ورقية (كرتون)', 120, 140], ['أكواب مشروبات (كرتون)', 95, 110]] },
  { party: 'مورد المشروبات', category: 'مشروبات', prefix: 'W', start: 9020, every: 7, by: 'purchasing', payment: 'cash',
    items: [['مياه (كرتون)', 14, 16], ['مشروبات غازية (كرتون)', 38, 44], ['عصائر (كرتون)', 48, 55]] },
]

// المصروفات التشغيلية المعتمدة: [اليوم من الشهر، الجهة، التصنيف، البند، المبلغ، نسبة الضريبة، طريقة الدفع]
const MONTHLY = [
  [1, 'مالك العقار', 'إيجار', 'إيجار المحل — شهري', 12500, 0.15, 'bank'],
  [5, 'اشتراك نظام نقاط البيع', 'اشتراكات وأنظمة', 'اشتراك شهري', 299, 0.15, 'bank'],
  [9, 'مورد الغاز', 'غاز', 'تعبئة خزان الغاز', 410, 0.15, 'cash'],
  [12, 'فاتورة المياه', 'كهرباء وماء', 'استهلاك المياه', 455, 0.15, 'bank'],
  [16, 'شركة الصيانة والنظافة', 'صيانة ونظافة', 'صيانة المكيفات والشفاط', 950, 0.15, 'bank'],
  [23, 'مورد الغاز', 'غاز', 'تعبئة خزان الغاز', 395, 0.15, 'cash'],
]
const AUGUST_ONLY = [
  [10, 'فاتورة الكهرباء', 'كهرباء وماء', 'استهلاك الكهرباء — يوليو', 3380, 0.15, 'bank'],
  [27, 'مسير رواتب أغسطس', 'رواتب وأجور', 'رواتب 9 موظفين', 28400, 0, 'bank'],
  [31, 'جاهز', 'عمولات تطبيقات التوصيل', 'عمولات طلبات أغسطس', 4120, 0.15, 'bank'],
  [31, 'هنقر ستيشن', 'عمولات تطبيقات التوصيل', 'عمولات طلبات أغسطس', 3560, 0.15, 'bank'],
  [31, 'كيتا', 'عمولات تطبيقات التوصيل', 'عمولات طلبات أغسطس', 2210, 0.15, 'bank'],
  [31, 'مرسول', 'عمولات تطبيقات التوصيل', 'عمولات طلبات أغسطس', 1340, 0.15, 'bank'],
  [20, 'مطبعة الإعلانات', 'تسويق وإعلان', 'قوائم طعام مطبوعة', 780, 0.15, 'cash'],
]
const SEPTEMBER_ONLY = [
  [8, 'حملة إعلانية', 'تسويق وإعلان', 'إعلانات ممولة — سبتمبر', 1500, 0.15, 'bank'],
  [19, 'شركة الصيانة والنظافة', 'صيانة ونظافة', 'تنظيف المطبخ العميق', 1300, 0.15, 'bank'],
]

const CHANNEL_BASE = { 'نقدي': [700, 1300], 'شبكة (مدى)': [1600, 2800], 'هنقر ستيشن': [500, 900], 'جاهز': [600, 1100], 'كيتا': [250, 550], 'مرسول': [150, 380] }

/** ما هو مطبوع على الورقة: نسخة مستقلة عن الحقول القابلة للتعديل. */
export const paperOf = doc => ({
  kind: doc.kind, party: doc.party, invoiceNo: doc.invoiceNo, invoiceDate: doc.invoiceDate,
  lines: (doc.lines || []).map(l => ({ ...l })), printedTotal: doc.printedTotal, vatRate: doc.vatRate ?? 0.15,
})

const person = key => `${USERS[key].name} (${USERS[key].role})`
const at = (date, hour, minute) => `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

/** أسماء طويلة لاختبار الواجهة (وضع «بيانات قاسية») */
const LONG_NAMES = {
  'مورد الخضار والفواكه': 'مؤسسة الحقل الأخضر لتوريد الخضار والفواكه الطازجة والمبردة',
  'مورد اللحوم والدواجن': 'شركة الوادي الخصيب لتوريد اللحوم الحمراء والدواجن المبردة المحدودة',
  'شركة الصيانة والنظافة': 'الشركة المتحدة لخدمات الصيانة والنظافة والتشغيل للمطاعم والمطابخ المركزية',
  'مورد التغليف': 'مصنع التغليف الحديث لمواد التعبئة والتغليف الورقية والبلاستيكية',
}
const STRESS = 97.37

/** يضخّم المبالغ ويطيل الأسماء، مع بقاء كل مستند متسقًا مع ورقته (الفرق المقصود يبقى فرقًا). */
function stressed(state) {
  const scale = lines => lines.map(l => ({ ...l, price: round2(l.price * STRESS) }))
  const documents = state.documents.map(d => {
    const matched = d.printedTotal != null && docTotals(d).difference === 0
    const lines = scale(d.lines)
    const image = { ...d.image, lines: scale(d.image.lines), party: LONG_NAMES[d.image.party] || d.image.party }
    const paper = docTotals({ lines: image.lines, vatRate: image.vatRate })
    const printedTotal = d.printedTotal == null ? null : matched ? docTotals({ lines, vatRate: d.vatRate }).total : paper.total
    image.printedTotal = d.image.printedTotal == null ? null : paper.total
    return { ...d, lines, image, printedTotal, party: LONG_NAMES[d.party] || d.party }
  })
  const sales = state.sales.map(x => ({ ...x, amount: round2(x.amount * STRESS) }))
  return { ...state, documents, sales }
}

export function createMockState({ stress = false } = {}) {
  const rnd = prng(2609)
  const between = (min, max) => min + (max - min) * rnd()
  const pick = list => list[Math.floor(rnd() * list.length)]
  const documents = []
  let seq = 1000

  // `image` لقطة من الورقة نفسها وقت الرفع: لا تتغير حين يُعدَّل المستند، فتبقى مرجع المطابقة.
  const push = doc => {
    seq += 1
    const full = { seq, vatRate: 0.15, machineFields: [], history: [], ...doc, id: `d${seq}` }
    full.image = { ...paperOf(full), ...(doc.image || {}) }
    documents.push(full)
    return full
  }

  const approvedDoc = ({ kind, party, category, invoiceNo, invoiceDate, lines, vatRate = 0.15, payment, by }) => {
    const uploadedAt = at(addDays(invoiceDate, rnd() < 0.6 ? 0 : 1), 9 + Math.floor(rnd() * 8), Math.floor(rnd() * 60))
    let approvedDay = addDays(uploadedAt.slice(0, 10), rnd() < 0.5 ? 0 : 1)
    if (approvedDay > '2026-09-25') approvedDay = '2026-09-25'
    const approvedAt = at(approvedDay, 17 + Math.floor(rnd() * 4), Math.floor(rnd() * 60))
    const approver = rnd() < 0.8 ? person('accountant') : person('owner')
    const doc = { kind, party, category, invoiceNo, invoiceDate, lines, vatRate, payment, uploadedAt, uploadedBy: person(by), status: 'approved', approvedAt, approvedBy: approver }
    doc.printedTotal = docTotals(doc).total
    doc.history = [
      { at: uploadedAt, by: person(by), text: 'رُفع المستند' },
      { at: uploadedAt, by: 'القراءة الآلية', text: 'عُبّئت الحقول آليًا' },
      { at: approvedAt, by: approver, text: 'اعتُمد' },
    ]
    return push(doc)
  }

  // ── مشتريات معتمدة: 1 أغسطس – 24 سبتمبر ──
  const counters = new Map()
  for (const s of SUPPLIERS) {
    counters.set(s.party, s.start)
    for (let dayOffset = Math.floor(rnd() * 2); ; dayOffset += s.every) {
      const date = addDays('2026-08-01', Math.round(dayOffset))
      if (date > '2026-09-24') break
      const count = 2 + Math.floor(rnd() * Math.min(3, s.items.length - 1))
      const chosen = [...s.items].sort(() => rnd() - 0.5).slice(0, count)
      const lines = chosen.map(([name, min, max]) => ({ name, qty: 3 + Math.floor(rnd() * 10), price: round2(between(min, max)) }))
      const number = counters.get(s.party)
      counters.set(s.party, number + 1)
      approvedDoc({ kind: 'purchase', party: s.party, category: s.category, invoiceNo: `${s.prefix}${number}`, invoiceDate: date, lines, payment: s.payment, by: s.by })
    }
  }

  // ── مصروفات تشغيلية معتمدة ──
  const expense = (month, [day, party, category, name, amount, vatRate, payment], i) => approvedDoc({
    kind: 'expense', party, category, invoiceNo: `E-${month}${String(day).padStart(2, '0')}${i}`, invoiceDate: toISO(2026, month, day),
    lines: [{ name, qty: 1, price: amount }], vatRate, payment, by: 'accountant',
  })
  MONTHLY.forEach((row, i) => expense(8, row, i))
  MONTHLY.filter(([day]) => day <= 24).forEach((row, i) => expense(9, row, i))
  AUGUST_ONLY.forEach((row, i) => expense(8, row, i + 10))
  SEPTEMBER_ONLY.forEach((row, i) => expense(9, row, i + 20))

  // ── مرفوضة ──
  const rejected = (doc, reason, byKey, whenAt) => push({
    ...doc, status: 'rejected', rejection: { reason, note: '', by: person(byKey), at: whenAt },
    history: [
      { at: doc.uploadedAt, by: doc.uploadedBy, text: 'رُفع المستند' },
      { at: whenAt, by: person(byKey), text: `رُفض: ${reason}` },
    ],
  })
  rejected({ kind: 'purchase', party: 'مورد الخضار والفواكه', category: 'خضار وفواكه', invoiceNo: '', invoiceDate: '2026-09-21', payment: 'cash',
    lines: [{ name: 'بند غير مقروء', qty: 1, price: 0 }], printedTotal: null, uploadedAt: '2026-09-21T08:40', uploadedBy: person('purchasing'),
    image: { blur: true, invoiceNo: 'A-2252', lines: [{ name: 'طماطم (كرتون)', qty: 5, price: 42 }, { name: 'بصل (كيس)', qty: 3, price: 33 }, { name: 'بطاطس (كيس 10 كجم)', qty: 4, price: 31 }], printedTotal: 497.95 } },
  'الصورة غير واضحة', 'accountant', '2026-09-21T13:05')
  rejected({ kind: 'expense', party: 'مورد الغاز', category: 'غاز', invoiceNo: 'E-9092', invoiceDate: '2026-09-09', payment: 'cash',
    lines: [{ name: 'تعبئة خزان الغاز', qty: 1, price: 410 }], printedTotal: 471.5, uploadedAt: '2026-09-14T12:10', uploadedBy: person('cashier') },
  'المستند مكرر', 'accountant', '2026-09-14T15:30')

  // ── بانتظار المراجعة: كل حالة تنبيه مرة واحدة ──
  const pending = (doc, machineFields) => push({
    ...doc, status: 'pending', machineFields,
    history: [
      { at: doc.uploadedAt, by: doc.uploadedBy, text: 'رُفع المستند' },
      { at: doc.uploadedAt, by: 'القراءة الآلية', text: 'عُبّئت الحقول آليًا' },
    ],
  })
  const AUTO = ['party', 'invoiceNo', 'invoiceDate', 'category', 'printedTotal']

  // 1) مستند سليم: قراءة آلية فقط
  const electricity = { kind: 'expense', party: 'فاتورة الكهرباء', category: 'كهرباء وماء', invoiceNo: '7730418', invoiceDate: '2026-09-21', payment: 'bank',
    lines: [{ name: 'استهلاك الكهرباء — أغسطس', qty: 1, price: 3615 }], uploadedAt: '2026-09-23T10:20', uploadedBy: person('accountant') }
  electricity.printedTotal = docTotals(electricity).total
  pending(electricity, AUTO)

  // 2) قد يكون مكررًا: نفس رقم فاتورة معتمدة من نفس المورد
  const meatOriginal = documents.find(d => d.party === 'مورد اللحوم والدواجن' && d.invoiceDate >= '2026-09-10' && d.status === 'approved')
  pending({ kind: 'purchase', party: meatOriginal.party, category: meatOriginal.category, invoiceNo: meatOriginal.invoiceNo, invoiceDate: meatOriginal.invoiceDate,
    payment: meatOriginal.payment, lines: meatOriginal.lines.map(l => ({ ...l })), printedTotal: meatOriginal.printedTotal,
    uploadedAt: '2026-09-25T16:10', uploadedBy: person('purchasing') }, AUTO)

  // 3) الإجمالي المطبوع أعلى من البنود: بند لم يُقرأ
  const vegLines = [{ name: 'طماطم (كرتون)', qty: 4, price: 41.5 }, { name: 'خس (كرتون)', qty: 2, price: 46 }, { name: 'ليمون (كرتون)', qty: 1, price: 58 }]
  const veg = { kind: 'purchase', party: 'مورد الخضار والفواكه', category: 'خضار وفواكه', invoiceNo: `A-${counters.get('مورد الخضار والفواكه')}`, invoiceDate: '2026-09-25',
    payment: 'cash', lines: vegLines, uploadedAt: '2026-09-25T09:35', uploadedBy: person('purchasing') }
  veg.printedTotal = round2(docTotals(veg).total + 36.8) // بند «بصل (كيس)» 32 + ضريبته، لم تلتقطه القراءة
  veg.image = { lines: [...vegLines, { name: 'بصل (كيس)', qty: 1, price: 32 }] }
  pending(veg, [...AUTO, 'lines'])

  // 4) تقرير إغلاق يوم 25 سبتمبر (الصندوق والشبكة)
  const zReport = { kind: 'sales', party: 'تقرير إغلاق نقاط البيع', category: 'تقرير إغلاق نقاط البيع', invoiceNo: 'Z-0925', invoiceDate: '2026-09-25', payment: '',
    lines: [{ name: 'نقدي', qty: 1, price: 1184.35 }, { name: 'شبكة (مدى)', qty: 1, price: 2436.5 }], uploadedAt: '2026-09-26T00:15', uploadedBy: person('cashier') }
  zReport.printedTotal = docTotals(zReport).total
  pending(zReport, ['invoiceDate', 'printedTotal', 'lines'])

  // 5) رقم الفاتورة لم يُقرأ
  const pack = { kind: 'purchase', party: 'مورد التغليف', category: 'تغليف وأدوات تقديم', invoiceNo: '', invoiceDate: '2026-09-25', payment: 'bank',
    lines: [{ name: 'علب برجر (كرتون 500)', qty: 2, price: 172 }, { name: 'أكياس ورقية (كرتون)', qty: 1, price: 128 }], uploadedAt: '2026-09-26T09:20', uploadedBy: person('purchasing') }
  pack.printedTotal = docTotals(pack).total
  pack.image = { invoiceNo: 'P-571', smudge: true }
  pending(pack, ['party', 'invoiceDate', 'category', 'printedTotal'])

  // 6) تاريخ قديم
  const late = { kind: 'expense', party: 'شركة الصيانة والنظافة', category: 'صيانة ونظافة', invoiceNo: 'M-0731', invoiceDate: '2026-07-30', payment: 'bank',
    lines: [{ name: 'إصلاح ثلاجة العرض', qty: 1, price: 740 }], uploadedAt: '2026-09-26T10:05', uploadedBy: person('accountant') }
  late.printedTotal = docTotals(late).total
  pending(late, AUTO)

  // ── قيد القراءة الآلية الآن ──
  push({ kind: 'purchase', party: '', category: '', invoiceNo: '', invoiceDate: '', payment: '', lines: [], printedTotal: null, status: 'reading',
    image: DRINKS_PAPER,
    uploadedAt: '2026-09-26T10:58', uploadedBy: person('purchasing'), history: [{ at: '2026-09-26T10:58', by: person('purchasing'), text: 'رُفع المستند' }] })

  // ── مبيعات مسجّلة يوميًا: 1 أغسطس – 25 سبتمبر (الصندوق والشبكة ليوم 25 في تقرير الإغلاق أعلاه) ──
  const sales = []
  for (let date = '2026-08-01'; date <= '2026-09-25'; date = addDays(date, 1)) {
    const weekend = [4, 5].includes(new Date(date + 'T00:00:00Z').getUTCDay())
    for (const [channel, [min, max]] of Object.entries(CHANNEL_BASE)) {
      if (date === '2026-09-25' && (channel === 'نقدي' || channel === 'شبكة (مدى)')) continue
      const amount = round2(between(min, max) * (weekend ? 1.35 : 1))
      sales.push({ date, channel, amount, enteredAt: at(addDays(date, 1), 0, 20 + Math.floor(rnd() * 30)), source: 'entry' })
    }
  }

  const settings = createSettings({ stress })
  const base = { business: { name: settings.business.name, branch: BUSINESS.branch }, documents, sales, settings, stress }
  return stress ? stressed(base) : base
}

export const INITIAL_TODAY = TODAY

/** ورقة المستند التجريبي الذي يُضاف من «رفع مستند» في النموذج. */
export const DRINKS_PAPER = {
  kind: 'purchase', party: 'مورد المشروبات', invoiceNo: 'W9031', invoiceDate: '2026-09-26', vatRate: 0.15,
  lines: [{ name: 'مياه (كرتون)', qty: 10, price: 15 }, { name: 'مشروبات غازية (كرتون)', qty: 6, price: 41 }, { name: 'عصائر (كرتون)', qty: 4, price: 52 }],
  printedTotal: 694.6,
}

/** مستند «قيد القراءة» جديد، ثم ما تعيده القراءة الآلية بعد لحظات (محاكاة). */
export function demoUpload(seq, uploadedAt, uploadedBy) {
  const reading = {
    id: `d${seq}`, seq, kind: 'purchase', party: '', category: '', invoiceNo: '', invoiceDate: '', payment: '', lines: [], printedTotal: null,
    vatRate: 0.15, status: 'reading', machineFields: [], uploadedAt, uploadedBy, image: { ...DRINKS_PAPER },
    history: [{ at: uploadedAt, by: uploadedBy, text: 'رُفع المستند (محاكاة)' }],
  }
  const read = {
    party: DRINKS_PAPER.party, category: 'مشروبات', invoiceNo: DRINKS_PAPER.invoiceNo, invoiceDate: DRINKS_PAPER.invoiceDate, payment: 'cash',
    lines: DRINKS_PAPER.lines.map(l => ({ ...l })), printedTotal: DRINKS_PAPER.printedTotal, status: 'pending',
    machineFields: ['party', 'invoiceNo', 'invoiceDate', 'category', 'printedTotal', 'lines'],
  }
  return { reading, read }
}
