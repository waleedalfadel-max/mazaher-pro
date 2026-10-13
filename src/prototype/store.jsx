// حالة النموذج في ذاكرة المتصفح فقط: تعود كما كانت عند إعادة التحميل أو «إعادة البيانات».
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { createMockState, demoUpload } from './data/mock.js'
import { CURRENT_USER, NOW, applyApproval, applyRejection, applySave } from './model.js'
import { addEmployee, setEmployeeActive, updateEmployee } from './settings.js'

const StoreContext = createContext(null)

/** وقت الإجراء في النموذج: اليوم الثابت، مع دقائق تتقدم مع كل إجراء ليبقى السجل مرتبًا. */
function clock() {
  let minutes = 0
  return () => {
    minutes += 1
    const [date, time] = NOW.split('T')
    const [h, m] = time.split(':').map(Number)
    const total = h * 60 + m + minutes
    return `${date}T${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
}

// «?stress» في العنوان يبدأ ببيانات قاسية (أسماء طويلة ومبالغ كبيرة) لاختبار العرض
const startStressed = () => typeof location !== 'undefined' && /[?&]stress\b/.test(location.search)

export function StoreProvider({ children }) {
  const [state, setState] = useState(() => createMockState({ stress: startStressed() }))
  const ref = useRef(state)
  ref.current = state
  const tick = useRef(clock())

  const commit = useCallback(result => {
    if (!result.error) {
      ref.current = result.state
      setState(result.state)
    }
    return result
  }, [])
  const withSettings = useCallback(result => {
    if (!result.error) commit({ state: { ...ref.current, settings: result.settings }, error: null })
    return result
  }, [commit])

  const actions = useMemo(() => ({
    approve: (id, options) => commit(applyApproval(ref.current, id, { ...options, at: tick.current() })),
    reject: (id, options) => commit(applyRejection(ref.current, id, { ...options, at: tick.current() })),
    save: (id, patch) => commit(applySave(ref.current, id, patch, { at: tick.current() })),
    upload: () => {
      const seq = Math.max(...ref.current.documents.map(d => d.seq)) + 1
      const who = `${CURRENT_USER.name} (${CURRENT_USER.role})`
      const at = tick.current()
      const { reading, read } = demoUpload(seq, at, who)
      commit({ state: { ...ref.current, documents: [reading, ...ref.current.documents] }, error: null })
      // محاكاة القراءة الآلية: لا يُرسل شيء إلى أي مزوّد
      setTimeout(() => {
        const doc = ref.current.documents.find(d => d.id === reading.id)
        if (!doc || doc.status !== 'reading') return
        const done = { ...doc, ...read, history: [...doc.history, { at: tick.current(), by: 'القراءة الآلية (محاكاة)', text: 'عُبّئت الحقول آليًا' }] }
        commit({ state: { ...ref.current, documents: ref.current.documents.map(d => (d.id === doc.id ? done : d)) }, error: null })
      }, 2600)
      return reading.id
    },
    reset: (stress = ref.current.stress) => commit({ state: createMockState({ stress }), error: null }),
    // الإعدادات: حفظ قسم كامل، وإجراءات الموظفين
    saveSettings: (section, value) => withSettings({ settings: { ...ref.current.settings, [section]: value }, error: null }),
    addEmployee: data => withSettings(addEmployee(ref.current.settings, data)),
    updateEmployee: (id, patch) => withSettings(updateEmployee(ref.current.settings, id, patch)),
    setEmployeeActive: (id, active) => withSettings(setEmployeeActive(ref.current.settings, id, active, tick.current())),
  }), [commit, withSettings])

  return <StoreContext.Provider value={{ state, ...actions }}>{children}</StoreContext.Provider>
}

export const useStore = () => useContext(StoreContext)
