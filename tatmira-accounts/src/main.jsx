import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./style.css";

const url = import.meta.env.TATMIRA_PUBLIC_SUPABASE_URL;
const key = import.meta.env.TATMIRA_PUBLIC_SUPABASE_KEY;
const tenant = import.meta.env.TATMIRA_PUBLIC_TENANT || "tatmira";
const auth =
  url && key
    ? createClient(url, key, {
        auth: { storageKey: "tatmira-owner-auth", detectSessionInUrl: true },
      })
    : null;
const TOKEN_KEY = `tatmira-employee:${tenant}`;
const GRANTS = {
  upload_sale: "رفع فواتير البيع",
  upload_payment: "رفع إثبات السداد",
  upload_expense: "رفع مستندات المصروفات",
  review: "المراجعة والاعتماد",
  view_reports: "مشاهدة التقارير",
  manage_customers: "إدارة العملاء",
};
const ERRORS = {
  AUTH_REQUIRED: "سجّل الدخول أولاً",
  INVALID_SESSION: "انتهت الجلسة أو تغيرت صلاحياتك. سجّل الدخول مجددًا",
  INVALID_LOGIN: "رمز الدخول غير صحيح أو الحساب معطّل",
  OWNER_ONLY: "هذا الإجراء للمالك فقط",
  PIN_FORMAT: "اكتب رمزًا من 6 أرقام",
  PIN_IN_USE: "الرمز مستخدم لموظف آخر؛ اختر رمزًا مختلفًا",
  RATE_LIMITED: "محاولات دخول كثيرة؛ حاول لاحقًا",
  AUTH_UNAVAILABLE: "تعذر الاتصال، حاول مرة أخرى",
  TENANT_UNAVAILABLE: "المنشأة غير مفعّلة بعد",
  ORIGIN_DENIED: "لم يُفعّل رابط الدخول على الخادم بعد",
  INVALID_REQUEST: "راجع الحقول المطلوبة",
  EMPLOYEE_NOT_FOUND: "حساب الموظف غير موجود",
};
function employeeToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function pinDigits(value) {
  return value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
}
async function api(action, payload = {}, tokenOverride) {
  const token =
    tokenOverride ||
    employeeToken() ||
    (await auth.auth.getSession()).data.session?.access_token;
  const response = await fetch(`${url}/functions/v1/tatmira-accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, tenant, ...payload }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(ERRORS[result.error] || "تعذر إكمال العملية");
    error.code = result.error;
    throw error;
  }
  return result;
}
function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
function Login({ onLogin, recovery, setRecovery }) {
  const [mode, setMode] = useState("employee"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [pin, setPin] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (recovery) {
        const { error } = await auth.auth.updateUser({ password });
        if (error) throw error;
        sessionStorage.removeItem(TOKEN_KEY);
        setRecovery(false);
        setPassword("");
      } else if (mode === "owner") {
        const { error } = await auth.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw new Error("البريد أو كلمة المرور غير صحيحة");
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        await auth.auth.signOut({ scope: "local" });
        const result = await api("pin_login", { pin: pinDigits(pin) });
        sessionStorage.setItem(TOKEN_KEY, result.token);
        setPin("");
      }
      await onLogin();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login card">
      <div className="brand">تتميرا</div>
      <h1>{recovery ? "إعداد كلمة المرور" : "أهلًا بك"}</h1>
      {!recovery && (
        <div className="tabs">
          <button
            type="button"
            aria-pressed={mode === "employee"}
            onClick={() => setMode("employee")}
          >
            دخول الموظف
          </button>
          <button
            type="button"
            aria-pressed={mode === "owner"}
            onClick={() => setMode("owner")}
          >
            دخول المالك
          </button>
        </div>
      )}
      <form onSubmit={submit}>
        {mode === "owner" && !recovery && (
          <Field
            label="البريد الإلكتروني"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {mode === "owner" || recovery ? (
          <Field
            label="كلمة المرور"
            type="password"
            autoComplete={recovery ? "new-password" : "current-password"}
            required
            minLength={recovery ? 12 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        ) : (
          <Field
            label="رمز الدخول — 6 أرقام"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "جارٍ التحقق…" : recovery ? "حفظ كلمة المرور" : "دخول"}
        </button>
      </form>
    </main>
  );
}
function Employees() {
  const [employees, setEmployees] = useState([]),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function load() {
    const r = await api("employees");
    setEmployees(r.employees);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function perform(action, payload, success) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(action, payload);
      await load();
      setDraft(null);
      setMessage(success);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function save(event) {
    event.preventDefault();
    const payload =
      draft.mode === "pin"
        ? { id: draft.id, pin: pinDigits(draft.pin) }
        : {
            id: draft.id,
            name: draft.name,
            grants: draft.grants,
            ...(!draft.id ? { pin: pinDigits(draft.pin) } : {}),
          };
    return perform(
      draft.mode === "pin" ? "set_pin" : "save_employee",
      payload,
      "تم الحفظ",
    );
  }
  return (
    <>
      <div className="title-row">
        <h2>الموظفون والصلاحيات</h2>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setDraft({
              name: "",
              pin: "",
              grants: ["upload_expense"],
              mode: "edit",
            });
          }}
        >
          + موظف
        </button>
      </div>
      <p>أضف الموظف، اختر ما يستطيع عمله، ثم أعطه رمز الدخول ورابط المنشأة.</p>
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {draft && (
        <form className="card editor" onSubmit={save}>
          <h3>
            {draft.mode === "pin"
              ? "تغيير رمز الدخول"
              : draft.id
                ? "تعديل الموظف"
                : "موظف جديد"}
          </h3>
          {draft.mode !== "pin" && (
            <>
              <Field
                label="اسم الموظف"
                value={draft.name}
                required
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <fieldset>
                <legend>الصلاحيات</legend>
                {Object.entries(GRANTS).map(([id, label]) => (
                  <label className="check" key={id}>
                    <input
                      type="checkbox"
                      checked={draft.grants.includes(id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          grants: e.target.checked
                            ? [...draft.grants, id]
                            : draft.grants.filter((g) => g !== id),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {(!draft.id || draft.mode === "pin") && (
            <Field
              label="رمز جديد من 6 أرقام"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={draft.pin}
              required
              maxLength={6}
              onChange={(e) => setDraft({ ...draft, pin: e.target.value })}
            />
          )}
          {draft.id && (
            <p>تغيير الرمز أو الصلاحيات ينهي جلسات الموظف الحالية.</p>
          )}
          <div className="actions">
            <button disabled={busy} className="primary">
              حفظ
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
      <div className="list">
        {employees.map((e) => (
          <article className="card" key={e.id}>
            <h3>
              {e.name}{" "}
              <span className={e.active ? "badge" : "badge off"}>
                {e.active ? "نشط" : "معطّل"}
              </span>
            </h3>
            <p>
              {e.grants.map((g) => GRANTS[g]).join(" · ") ||
                "لا توجد صلاحيات تشغيل"}
            </p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => setDraft({ ...e, mode: "edit", pin: "" })}
              >
                الصلاحيات
              </button>
              <button
                disabled={busy}
                onClick={() => setDraft({ ...e, mode: "pin", pin: "" })}
              >
                تغيير الرمز
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  perform(
                    "set_active",
                    { id: e.id, active: !e.active },
                    e.active
                      ? "تم تعطيل الموظف وإنهاء جلساته"
                      : "تم تفعيل الموظف",
                  )
                }
              >
                {e.active ? "تعطيل" : "تفعيل"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!employees.length && (
        <div className="card">
          لا يوجد موظفون بعد. أضف أول موظف من الزر أعلاه.
        </div>
      )}
    </>
  );
}
function App() {
  const [identity, setIdentity] = useState(null),
    [loading, setLoading] = useState(true),
    [recovery, setRecovery] = useState(() =>
      /type=(recovery|invite)/.test(location.hash),
    ),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load() {
    const current = ++generation.current;
    const result = await api("me");
    if (current === generation.current) {
      setIdentity(result);
      setError("");
    }
  }
  async function logout() {
    generation.current++;
    try {
      if (employeeToken()) await api("logout");
      else await auth.auth.signOut({ scope: "local" });
    } catch {
      setError(
        "تعذر تأكيد إنهاء الجلسة على الخادم. أُغلق الدخول على هذا الجهاز.",
      );
    } finally {
      generation.current++;
      sessionStorage.removeItem(TOKEN_KEY);
      setIdentity(null);
    }
  }
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const { data } = auth.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    load()
      .catch((e) => {
        if (
          !["AUTH_REQUIRED", "INVALID_SESSION", "OWNER_ONLY"].includes(e.code)
        )
          setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!identity) return;
    const check = () =>
      load().catch((e) => {
        setIdentity(null);
        setError(e.message);
        if (
          ["INVALID_SESSION", "OWNER_ONLY", "TENANT_UNAVAILABLE"].includes(
            e.code,
          )
        )
          sessionStorage.removeItem(TOKEN_KEY);
      });
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [identity?.actor?.id]);
  if (!auth)
    return (
      <main className="card login">
        <h1>تجهيز الحسابات</h1>
        <p>يلزم إكمال ربط إعدادات الدخول قبل تشغيل هذه الصفحة.</p>
      </main>
    );
  if (loading) return <main className="login card">جارٍ التحميل…</main>;
  if (!identity || recovery)
    return (
      <>
        {error && (
          <p className="error global" role="alert">
            {error}
          </p>
        )}
        <Login onLogin={load} recovery={recovery} setRecovery={setRecovery} />
      </>
    );
  return (
    <div className="container">
      <header>
        <div>
          <strong>{identity.organization.name}</strong>
          <p>{identity.actor.name}</p>
        </div>
        <button onClick={logout}>خروج</button>
      </header>
      <div className="notice">
        مرحلة تجهيز الحسابات — المستندات والتقارير ما زالت في النموذج التجريبي،
        ولم تُربط بهذه الحسابات بعد.
      </div>
      {identity.actor.role === "owner" ? (
        <Employees />
      ) : (
        <main className="card">
          <h1>تم تسجيل الدخول</h1>
          <p>
            صلاحياتك:{" "}
            {(identity.actor.grants || []).map((g) => GRANTS[g]).join(" · ") ||
              "لا توجد صلاحيات تشغيل"}
          </p>
          <p>سيتاح العمل بالمستندات بعد إكمال الربط.</p>
        </main>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
