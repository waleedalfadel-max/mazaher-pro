// UI integration checks with synthetic users and a simulated RPC service; no production requests.
// Run from the repository: node tests/browser/admin-access.mjs
// Requires Playwright; CHROMIUM_EXECUTABLE_PATH may point at an installed browser.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright to run this browser check.')
  playwright = createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, '../package.json'))('playwright')
}
const temp = await mkdtemp(path.join(tmpdir(), 'admin-access-'))
const fixture = path.join(temp, 'fixture.js')
await build({
  stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import AdminBusinessUsers from './src/pages/AdminBusinessUsers';
    import Settings from './src/pages/Settings';
    import Layout from './src/components/Layout';
    import Ledger from './src/pages/Ledger';
    import { AttachDialog } from './src/pages/JournalLedger';
    import { canEditLedger } from './src/lib/adminAccess';
    const root = createRoot(document.getElementById('root'));
    window.render = (kind = 'users', overrides = {}) => {
      window.auth = { role:'superadmin', projectId:'business-a', projectName:'Test business', viewState:'ok',
        isSuperAdmin:true, modules:[], userName:'Test admin', ...overrides };
      window.auth.canEdit = canEditLedger(window.auth.role, window.auth.projectId, window.auth.viewState);
      root.render(<MemoryRouter key={Math.random()}>
        {kind === 'ledger' ? <Ledger /> : kind === 'attachments' ? <AttachDialog entry={{journal_number:'TEST-1',date:'2026-01-01'}} projectId="business-a" role={window.auth.role} onClose={()=>{}} onChanged={()=>{}} />
          : kind === 'settings' ? <Settings /> : kind === 'layout' ? <Layout><p>Business content</p></Layout> : <AdminBusinessUsers />}
      </MemoryRouter>);
    };
    window.dbrows = {};
    window.calls = []; window.failList = false; window.denyWrite = false;
    window.rows = { 'business-a':[{id:'user-a',name:'Test owner',role:'owner',branch:null,is_active:true,created_at:'2026-01-01T00:00:00Z'}],
      'business-b':[{id:'user-b',name:'Other owner',role:'owner',branch:null,is_active:true,created_at:'2026-01-01T00:00:00Z'}] };
    window.rpc = async (name, args = {}) => {
      window.calls.push({name,args});
      if (name === 'category_settings') return {data:{ok:true,can_edit:true,categories:[],changes:[],review:[]}};
      if (name === 'admin_project_users') return window.failList ? {error:{message:'simulated failure'}} :
        {data:{ok:true,project_id:args.p_project_id,branches:['Test branch'],members:structuredClone(window.rows[args.p_project_id] || [])}};
      if (window.denyWrite) return {data:{ok:false,code:'forbidden'}};
      if (name === 'admin_staff_create') {
        window.rows[args.p_project_id].push({id:'new-user',name:args.p_name,role:args.p_role,branch:args.p_branch,is_active:true});
        return {data:{ok:true,id:'new-user'}};
      }
      const rows = Object.values(window.rows).find(rows => rows.some(r => r.id === args.p_user_id));
      const row = rows?.find(r => r.id === args.p_user_id);
      if (!row) return {data:{ok:false,code:'not_found'}};
      if (name === 'admin_staff_update') Object.assign(row,{name:args.p_name,role:args.p_role,branch:args.p_branch});
      if (name === 'admin_staff_set_active') row.is_active = args.p_active;
      if (name === 'admin_staff_remove') rows.splice(rows.indexOf(row),1);
      return {data:{ok:true,id:row.id,sessions:'revoked',result:'deleted'}};
    };
  `, resolveDir: process.cwd(), sourcefile:'admin-ui-fixture.jsx', loader:'jsx' },
  bundle:true, outfile:fixture, platform:'browser', format:'iife', jsx:'automatic',
  define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},
  plugins:[{name:'synthetic-session-and-rpc',setup(b){
    b.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:'export const useAuth = () => window.auth;',loader:'js'}));
    b.onLoad({filter:/[\\/]lib[\\/]supabase\.js$/},()=>({contents:`
      const chain = table => { const q = new Proxy({}, { get:(_,k) => k === 'then' ? (resolve) => Promise.resolve({data:window.dbrows[table] || [],count:0,error:null}).then(resolve) : () => q }); return q; };
      export const supabase = {rpc:(...a)=>window.rpc(...a),from:table=>chain(table)};
      export const fetchAllRows = async () => ({data:[],error:null});
    `,loader:'js'}));
    b.onLoad({filter:/[\\/]components[\\/]VersionNotice\.jsx$/},()=>({contents:'export default function VersionNotice(){return null}',loader:'jsx'}));
    b.onLoad({filter:/[\\/]pages[\\/]JournalLedger\.jsx$/},async args=>({contents:(await readFile(args.path,'utf8'))+'\nexport { AttachDialog };',loader:'jsx'}));
  }}],logLevel:'warning'
})
const browser = await playwright.chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args:['--no-sandbox','--disable-dev-shm-usage']})
const page = await browser.newPage()
page.setDefaultTimeout(8000)
const errors=[], network=[], passed=[]
page.on('pageerror',e=>errors.push(String(e)))
page.on('dialog',d=>d.accept())
await page.route('**/*',r=>{network.push(r.request().url());return r.abort()})
const check = (name) => { passed.push(name); console.log('PASS '+name) }
const render = async (kind='users',overrides={}) => {
  await page.evaluate(({kind,overrides})=>window.render(kind,overrides),{kind,overrides})
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
}
const open = async (id='user-a') => page.locator('[data-user-id="'+id+'"]').getByRole('button').click()
try {
  await page.setContent('<html dir="rtl"><body><div id="root"></div></body></html>')
  await page.addScriptTag({path:fixture})
  await render()
  await page.locator('[data-user-id="user-a"]').waitFor()
  assert.equal(await page.locator('[data-user-id="user-b"]').count(),0)
  check('selected business users only')
  await open()
  await page.locator('[data-user-edit] [data-k="name"]').fill('Renamed owner')
  await page.locator('[data-user-edit]').getByRole('button',{name:'حفظ',exact:true}).click()
  await page.getByText('Renamed owner',{exact:true}).waitFor()
  check('owner name edit uses admin RPC')
  await open()
  await page.locator('[data-user-edit] [data-k="pin"]').fill('58316')
  await page.getByRole('button',{name:'تعيين الرمز',exact:true}).click()
  await page.locator('[data-users-info]').filter({hasText:'عُيّن الرمز الجديد'}).waitFor()
  check('reset PIN uses admin RPC and shows session revocation')
  await open()
  await page.locator('[data-user-edit]').getByRole('button',{name:'تعطيل',exact:true}).click()
  await page.locator('[data-user-id="user-a"]').getByText('معطّل',{exact:true}).waitFor()
  await open()
  await page.getByRole('button',{name:'إعادة التفعيل',exact:true}).click()
  await page.locator('[data-users-info]').filter({hasText:'أُعيد تفعيل'}).waitFor()
  check('disable and enable owner use admin RPCs')
  await page.locator('[data-add-user] [data-k="name"]').fill('New cashier')
  await page.locator('[data-add-user] [data-k="role"]').selectOption('cashier')
  await page.locator('[data-add-user] [data-k="branch"]').selectOption('Test branch')
  await page.locator('[data-add-user] [data-k="pin"]').fill('59273')
  await page.getByRole('button',{name:'+ إضافة',exact:true}).click()
  await page.locator('[data-user-id="new-user"]').waitFor()
  check('add user sends selected business, role and branch')
  await open('new-user')
  await page.locator('[data-user-edit]').getByRole('button',{name:'حذف',exact:true}).click()
  await page.locator('[data-users-info]').filter({hasText:'حُذف الحساب'}).waitFor()
  assert.equal(await page.locator('[data-user-id="new-user"]').count(),0)
  check('delete returns confirmed result and reloads list')
  await page.evaluate(()=>window.denyWrite=true)
  await open()
  await page.locator('[data-user-edit] [data-k="name"]').fill('Must not save')
  await page.locator('[data-user-edit]').getByRole('button',{name:'حفظ',exact:true}).click()
  await page.locator('[data-users-notice]').filter({hasText:'لم يُحفظ'}).waitFor()
  assert.equal(await page.evaluate(()=>window.rows['business-a'][0].name),'Renamed owner')
  check('server refusal is visible and does not claim success')
  await page.evaluate(()=>{window.denyWrite=false;window.failList=true})
  await render()
  await page.locator('[data-users-state="error"]').waitFor()
  assert.equal(await page.locator('[data-add-user]').count(),0)
  await page.evaluate(()=>window.failList=false)
  await page.getByRole('button',{name:'إعادة المحاولة',exact:true}).click()
  await page.locator('[data-user-id="user-a"]').waitFor()
  check('load failure prevents edits; retry restores list')
  await render('users',{projectId:'business-b'})
  await page.locator('[data-user-id="user-b"]').waitFor()
  assert.equal(await page.locator('[data-user-id="user-a"]').count(),0)
  check('switch business clears prior user form')
  for (const overrides of [{role:'accountant'},{role:'owner'},{projectId:null},{viewState:'checking'}]) {
    await render('users',overrides)
    assert.equal(await page.locator('[data-admin-project-users]').count(),0)
  }
  check('admin manager rejects other roles and unverified context')
  await render('settings')
  await page.getByRole('tab',{name:'الموظفون',exact:true}).click()
  await page.locator('[data-user-id="user-a"]').waitFor()
  check('settings employees tab uses full admin manager')
  await render('layout')
  // Sidebar is an aside; inspect its navigation links directly.
  for (const href of ['/','/users','/suppliers','/app-reconciliation','/settings']) {
    assert.equal(await page.locator('aside .ts-nav a[href="'+href+'"]').count(),1,href)
  }
  check('admin navigation includes dashboard, users and modules')
  await render('ledger')
  await page.getByRole('button',{name:'إضافة قيد',exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'))
  assert.equal(await page.getByRole('button',{name:'إضافة قيد',exact:true}).isEnabled(),true)
  check('ledger add action is enabled for the verified platform admin')
  await render('ledger',{role:'owner',isSuperAdmin:false})
  assert.equal(await page.getByRole('button',{name:'إضافة قيد',exact:true}).count(),0)
  check('ledger keeps owner read-only access unchanged')
  await page.evaluate(()=>window.dbrows.attachments=[{id:'test-file',file_name:'test.pdf',file_url:'synthetic',uploaded_by:'superadmin',uploaded_at:'2026-01-01T00:00:00Z'}])
  await render('attachments')
  await page.getByRole('button',{name:'حذف',exact:true}).waitFor()
  check('platform admin sees attachment delete action')
  await render('attachments',{role:'cashier',isSuperAdmin:false})
  await page.getByText('test.pdf',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'حذف',exact:true}).count(),0)
  check('attachment deletion is not granted to cashier')
  const calls=await page.evaluate(()=>window.calls)
  assert(calls.some(c=>c.name==='admin_staff_create' && c.args.p_project_id==='business-a' && c.args.p_branch==='Test branch'))
  assert(calls.filter(c=>c.name.startsWith('admin_staff_')).every(c=>!('actor_id' in c.args) && !('actor_name' in c.args)))
  assert.deepEqual(errors,[]); assert.deepEqual(network,[])
  check('real actor is resolved on server; no production traffic or page errors')
  console.log(passed.length+' UI checks passed (simulated RPC; not database authorization verification).')
} finally { await browser.close(); await rm(temp,{recursive:true,force:true}) }
