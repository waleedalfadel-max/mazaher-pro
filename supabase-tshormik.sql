-- =====================================================
-- إضافة عميل تشورميك — شغّل هذا الـ SQL في Supabase SQL Editor
-- =====================================================

-- الخطوة 1: إضافة عمود الفرع للجداول (آمن — IF NOT EXISTS)
ALTER TABLE app_users      ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE documents      ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE sales          ADD COLUMN IF NOT EXISTS branch TEXT;

-- الخطوة 2: إضافة تشورميك بجميع بياناته دفعة واحدة
DO $$
DECLARE
  pid UUID;
BEGIN

  -- إنشاء المشروع
  INSERT INTO projects (name)
  VALUES ('تشورميك')
  RETURNING id INTO pid;

  -- إعدادات المشروع (أنواع المعاملات + قائمة الفروع)
  INSERT INTO project_settings (project_id, active, settings)
  VALUES (
    pid,
    true,
    '{
      "branches": ["فرع البكيرية 1", "فرع البكيرية 2", "فرع بريدة"],
      "transaction_types": [
        {"label": "💵 مبيعات كاش"},
        {"label": "🏦 مبيعات شبكة"},
        {"label": "📱 مبيعات هنقر ستيشن"},
        {"label": "🍽️ مبيعات جاهز"},
        {"label": "🥗 مبيعات كيتا"},
        {"label": "🥩 لحم نعيمي"},
        {"label": "🥩 لحم عجل"},
        {"label": "🍗 دجاج الشاورما"},
        {"label": "🍗 دجاج المشاوي"},
        {"label": "🛒 مشتريات متنوعة"},
        {"label": "👷 رواتب وأجور (20 موظف)"},
        {"label": "🏢 إيجار فرع البكيرية 1"},
        {"label": "🏢 إيجار فرع البكيرية 2"},
        {"label": "🏢 إيجار فرع بريدة"},
        {"label": "🏠 إيجار سكن عمال البكيرية"},
        {"label": "🏠 إيجار سكن عمال بريدة"},
        {"label": "🏦 قرض بنكي"},
        {"label": "🚗 قرض سيارة"},
        {"label": "💼 مسحوبات شريك 1"},
        {"label": "💼 مسحوبات شريك 2"},
        {"label": "📶 اشتراك نت"},
        {"label": "💻 اشتراك برنامج رتم"}
      ]
    }'::jsonb
  );

  -- المستخدمون (6 مستخدمين)
  INSERT INTO app_users (project_id, name, role, pin, branch) VALUES
    (pid, 'مالك تشورميك',          'owner',      '11113', NULL),
    (pid, 'محاسب تشورميك',          'accountant', '22224', NULL),
    (pid, 'مسؤول مشتريات تشورميك', 'purchasing', '33333', NULL),
    (pid, 'كاشير البكيرية 1',       'cashier',    '44444', 'فرع البكيرية 1'),
    (pid, 'كاشير البكيرية 2',       'cashier',    '44445', 'فرع البكيرية 2'),
    (pid, 'كاشير بريدة',            'cashier',    '44446', 'فرع بريدة');

  RAISE NOTICE 'تم إنشاء تشورميك بنجاح — Project ID: %', pid;
END $$;
