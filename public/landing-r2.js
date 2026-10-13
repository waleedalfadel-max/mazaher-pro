(() => {
  'use strict';
  const button=document.querySelector('.menu-toggle'),menu=document.querySelector('#mobile-menu');
  const closeMenu=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','فتح القائمة');};
  button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';menu.hidden=!open;button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'إغلاق القائمة':'فتح القائمة');});
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){closeMenu();button.focus();}});
  document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!button.contains(e.target))closeMenu();});
  document.querySelector('#yr').textContent=new Date().getFullYear();
  const status=document.querySelector('.pricing-status'),periods=document.querySelector('.periods'),summary=document.querySelector('.price-summary'),order=document.querySelector('.order-link');
  const labels={3:'٣ أشهر',6:'٦ أشهر',12:'سنة'};
  const price=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
  const money=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const set=(selector,value)=>{document.querySelector(selector).textContent=value;};
  let program;
  const update=()=>{
    const selected=document.querySelector('[name="period"]:checked');
    if(!selected||!program)return;
    const months=Number(selected.value),setup=Number(program.setup_fee),fee=Number(program['price_'+months+'_months']);
    set('[data-period-label]',labels[months]);set('[data-summary-setup]',money(setup)+' ريال');set('[data-summary-subscription]',money(fee)+' ريال');set('[data-total]',money(Math.round((setup+fee)*100)/100)+' ريال');
    order.href='https://store.safahat.app/program-tahseeb.html?months='+months;order.textContent='اطلب تحسيب — '+labels[months]+' ←';
    summary.hidden=false;
  };
  periods.addEventListener('change',update);
  async function loadPrices(){
    if(!window.TAHSEEB_LIVE){status.textContent='هذه معاينة للتصميم. الأسعار المعتمدة متاحة في متجر صفحات.';return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('https://store.safahat.app/api/programs',{cache:'no-store',credentials:'omit',signal:controller.signal});
      if(!response.ok)throw Error('pricing unavailable');
      const rows=await response.json();
      if(!Array.isArray(rows))throw Error('invalid catalog');
      program=rows.find(p=>p.slug==='tahseeb'&&p.status==='published');
      if(!program||!price(program.setup_fee))throw Error('unavailable');
      const available=[3,6,12].filter(m=>price(program['price_'+m+'_months']));
      if(!available.length)throw Error('no plans');
      set('[data-setup]',money(program.setup_fee));
      document.querySelectorAll('[name="period"]').forEach(input=>{
        const m=Number(input.value),valid=available.includes(m);input.disabled=!valid;
        set('[data-price="'+m+'"]',valid?money(program['price_'+m+'_months']):'غير متاح');
        input.checked=m===available[0];
      });
      periods.disabled=false;status.textContent='';update();
    }catch{status.textContent='تعذر عرض الأسعار الآن. راجع الأسعار المعتمدة في المتجر.';summary.hidden=true;periods.disabled=true;}
    finally{clearTimeout(timer);}
  }
  loadPrices();
})();
