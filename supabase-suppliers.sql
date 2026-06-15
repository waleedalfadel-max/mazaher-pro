-- =====================================================
-- جداول الموردين — شغّل هذا الـ SQL في Supabase SQL Editor
-- =====================================================

-- الخطوة 1: إنشاء جدول الموردين
CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  phone            TEXT,
  opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_project ON suppliers(project_id);

-- الخطوة 2: إنشاء جدول حركات الموردين
CREATE TABLE IF NOT EXISTS supplier_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('invoice','payment')),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  date            DATE NOT NULL,
  notes           TEXT,
  journal_number  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_txns_supplier ON supplier_transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_txns_project  ON supplier_transactions(project_id);

-- الخطوة 3: إضافة عمود modules لـ project_settings (إن لم يكن موجوداً)
ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS modules TEXT[] DEFAULT '{}';

-- الخطوة 4: تفعيل module الموردين لمشروع محمصة كون
UPDATE project_settings
SET modules = array_append(modules, 'suppliers')
WHERE project_id = 'ab1c819e-441f-46ce-919b-db9f0711910b'
  AND NOT ('suppliers' = ANY(COALESCE(modules, '{}')));
