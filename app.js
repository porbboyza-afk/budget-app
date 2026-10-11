import {STORAGE_KEY,localDate,validDate,parseMoney,validateState,totals,expenseCategories} from './model.js';
import {requestAI} from './ai-client.js';
import './auth.js';
import {createCloudSync} from './cloud-sync.js';
import {showView,activeView} from './views.js';
import {createTripsUI} from './trips.js';
await window.budgetAuth.ready;
let owner=window.budgetAuth.getUser()?.uid||'anonymous';
let storageKey=STORAGE_KEY+':owner:'+encodeURIComponent(owner),cloudSync=null;
const $=id=>document.getElementById(id);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=cents=>new Intl.NumberFormat('th-TH',{minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2}).format(cents/100);
const thaiDate=date=>new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00'));
const monthName=month=>new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00'));
let state,storageFault=false,editingId=null,editingOriginal=null,entryType='expense',deleted=null,toastTimer,lastStoredRaw=null;
const PAGE_SIZE=10;
let currentPage=1;
let shownSyncConflict=false;
let tripsUI=null,lastSave=null,legacyConflict=false;
const emptyState=()=>({version:2,openingCents:0,demo:false,entries:[],trips:[]});
function loadState(){
  lastStoredRaw=localStorage.getItem(storageKey);const input=lastStoredRaw?JSON.parse(lastStoredRaw):null;
  state=input?validateState(input):emptyState();
  const recovery=input?.version===1?localStorage.getItem(storageKey+':trip-recovery'):null;
  if(recovery){state=validateState(JSON.parse(recovery));legacyConflict=true;}
}
try {loadState();}
catch {state=emptyState();storageFault=true;}
$('month').value=localDate().slice(0,7);
function notify(text,undo=false){clearTimeout(toastTimer);$('toast-text').textContent=text;$('undo').hidden=!deleted;$('toast').hidden=false;if(!deleted&&!undo)toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function commit(next){
  if(storageFault)throw new Error('อ่านข้อมูลเดิมไม่สำเร็จ โปรดกู้คืนจากไฟล์สำรองก่อนบันทึก');
  if(legacyConflict)throw new Error('พบแท็บรุ่นเก่า กรุณากู้คืนไฟล์สำรองหรือเลือกชุดข้อมูลในหน้า “ข้อมูล” ก่อนบันทึก');
  if(localStorage.getItem(storageKey)!==lastStoredRaw)throw new Error('ข้อมูลเปลี่ยนจากแท็บอื่น กรุณาโหลดหน้าใหม่ก่อนบันทึก');
  const checked=validateState(next);
  const raw=JSON.stringify(checked);
  try{if(lastStoredRaw&&JSON.parse(lastStoredRaw).version===1&&!localStorage.getItem(storageKey+':before-version2'))localStorage.setItem(storageKey+':before-version2',lastStoredRaw);localStorage.setItem(storageKey,raw);lastStoredRaw=raw;}catch{throw new Error('บันทึกไม่สำเร็จ พื้นที่อาจเต็มหรือเบราว์เซอร์ปิดการเก็บข้อมูล');}
  state=checked;render();cloudSync?.changed();
}
function setType(type){entryType=type;for(const t of ['income','expense']){$('type-'+t).classList.toggle('selected',t===type);$('type-'+t).setAttribute('aria-pressed',String(t===type));}$('submit-entry').innerHTML=(editingId?'บันทึกการแก้ไข':type==='income'?'บันทึกรายรับ':'บันทึกรายจ่าย')+' <span>↗</span>';}
function resetForm(){editingId=null;editingOriginal=null;$('entry-form').reset();$('form-heading').textContent='เพิ่มรายการ';$('cancel-edit').hidden=true;$('form-error').textContent='';$('date').value=localDate();$('entry-trip').value=tripsUI?.defaultTrip()||'';tripsUI?.hint();setType('expense');}
function hasEntryDraft(){return Boolean($('amount').value.trim()||$('description').value.trim()||$('category').value.trim()||($('date').value&&$('date').value!==localDate()));}
function editEntry(id){
  const row=state.entries.find(r=>r.id===id);if(!row)return;
  if(editingId===id){showView('entry-panel');$('amount').focus({preventScroll:true});return;}
  if(editingId!==id&&(editingId||hasEntryDraft())&&!confirm('มีรายการที่ยังไม่ได้บันทึก ทิ้งข้อความที่กรอกไว้แล้วเปิดแก้ไขรายการนี้?'))return;
  editingId=row.id;editingOriginal=JSON.stringify(row);setType(row.type);$('form-heading').textContent='แก้ไขรายการ';$('amount').value=(row.amountCents/100).toFixed(2);$('description').value=row.description;$('date').value=row.date;$('category').value=row.category;
  if(row.tripId&&!Array.from($('entry-trip').options).some(option=>option.value===row.tripId))$('entry-trip').add(new Option(state.trips.find(t=>t.id===row.tripId)?.name||'ทริป',row.tripId));
  $('entry-trip').value=row.tripId;tripsUI?.hint();$('cancel-edit').hidden=false;$('form-error').textContent='';showView('entry-panel');$('amount').focus({preventScroll:true});
}
function renderLastSave(){
  $('last-saved').hidden=!lastSave;if(!lastSave)return;
  const valid=lastSave.rows.every(({after})=>JSON.stringify(state.entries.find(row=>row.id===after.id))===JSON.stringify(after));
  $('last-saved-text').textContent=lastSave.label+(valid?'':' · รายการเปลี่ยนแล้ว');$('last-saved-undo').disabled=!valid;$('last-saved-edit').hidden=lastSave.rows.length!==1;$('last-saved-edit').disabled=!valid;
}
function rememberSave(rows,label){lastSave={rows,label};renderLastSave();}
function previousMonth(month){const [year,number]=month.split('-').map(Number);return localDate(new Date(year,number-2,1)).slice(0,7);}
function render(){
  const month=$('month').value,all=state.entries.filter(r=>r.date.startsWith(month+'-'));
  const sums=totals(state,month);
  for(const key of ['balance','income','expense'])$(key).innerHTML='<span class="currency">฿</span>'+money(sums[key]);
  $('balance-caption').textContent='ยอดตั้งต้น + รายรับ − รายจ่าย ถึงสิ้น '+monthName(month);
  $('income-count').textContent=all.filter(r=>r.type==='income').length+' รายการเงินเข้า';
  $('expense-count').textContent=all.filter(r=>r.type==='expense').length+' รายการเงินออก';
  $('period-label').textContent=monthName(month);
  $('demo-banner').hidden=!state.demo&&!storageFault;
  if(!storageFault){$('demo-banner').querySelector('strong').textContent='ลองดูภาพด้วยข้อมูลตัวอย่าง';$('demo-banner').querySelector('span').textContent='รายการเหล่านี้เป็นตัวอย่างสำหรับดราฟแรก';}
  if(storageFault){$('demo-banner').querySelector('strong').textContent='อ่านข้อมูลเดิมไม่ได้ — ยังไม่แสดงยอดจริง';$('demo-banner').querySelector('span').textContent='สำรองข้อมูลดิบไว้ก่อน หรือกู้คืนจากไฟล์';$('start-empty').hidden=true;for(const key of ['balance','income','expense'])$(key).textContent='—';}
  $('save-status').textContent=storageFault?'● อ่านข้อมูลเดิมไม่สำเร็จ':'● '+(state.demo?'ข้อมูลตัวอย่าง · ':'')+'บันทึกในเครื่องแล้ว';
  tripsUI?.render();renderLastSave();
  const categories=expenseCategories(all);$('category-overview').replaceChildren();
  if(storageFault){$('expense-insight').textContent='กู้คืนข้อมูลก่อนดูสรุป';$('expense-compare-open').disabled=true;}
  else{
    tripsUI?.categories($('category-overview'),categories,sums.expense);$('expense-compare-open').disabled=false;
    const prior=state.entries.filter(row=>row.date.startsWith(previousMonth(month)+'-'));
    const priorExpense=prior.filter(row=>row.type==='expense').reduce((sum,row)=>sum+row.amountCents,0),difference=sums.expense-priorExpense;
    $('expense-insight').textContent=!prior.length?'ยังไม่มีรายการเดือนก่อนให้เทียบ':difference===0?'รายจ่ายที่จดเท่ากับเดือนก่อน':`รายจ่ายที่จด${difference>0?'เพิ่ม':'ลด'}จากเดือนก่อน ฿${money(Math.abs(difference))}`;
  }
  const search=$('search').value.trim().toLocaleLowerCase(),type=$('filter-type').value,trip=$('trip-filter').value;
  const rows=[...all].reverse().filter(r=>(type==='all'||r.type===type)&&(!trip||r.tripId===trip)&&`${r.description} ${r.category} ${state.trips.find(t=>t.id===r.tripId)?.name||''}`.toLocaleLowerCase().includes(search)).sort((a,b)=>b.date.localeCompare(a.date));
  const pageCount=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  currentPage=Math.max(1,Math.min(currentPage,pageCount));
  const offset=(currentPage-1)*PAGE_SIZE,pageRows=rows.slice(offset,offset+PAGE_SIZE);
  $('pagination').hidden=!rows.length;
  $('page-range').textContent=rows.length?`แสดง ${offset+1}–${offset+pageRows.length} จาก ${rows.length} รายการ`:'';
  $('page-status').textContent=`หน้า ${currentPage} จาก ${pageCount}`;
  $('page-prev').disabled=currentPage===1;$('page-next').disabled=currentPage===pageCount;
  $('entry-count').textContent=rows.length+' รายการ';
  $('entries').innerHTML=rows.length?pageRows.map(r=>`<article class="entry-row"><div class="entry-description"><span class="entry-symbol ${r.type==='income'?'income':'expense'}">${r.type==='income'?'↙':'↗'}</span><div><div class="entry-name">${escape(r.description)}</div><div class="entry-meta">${thaiDate(r.date)}${r.category?' · '+escape(r.category):''}</div></div></div><div class="entry-amount ${r.type==='income'?'income-text':'expense-text'}">${r.type==='income'?'+':'−'}${money(r.amountCents)}</div><div class="entry-actions"><button data-action="edit" data-id="${escape(r.id)}" aria-label="แก้ไข ${escape(r.description)}">แก้ไข</button><button class="delete" data-action="delete" data-id="${escape(r.id)}" aria-label="ลบ ${escape(r.description)}">ลบ</button></div></article>`).join(''):`<div class="empty-state">${all.length?'ไม่พบรายการที่ตรงกับตัวกรอง':'ยังไม่มีรายการในเดือนนี้'}<br><small>${all.length?'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง':'เริ่มจดด้วยปุ่มรายรับหรือรายจ่ายได้เลย'}</small></div>`;
}
$('type-income').onclick=()=>{setType('income');$('amount').focus({preventScroll:true});};$('type-expense').onclick=()=>{setType('expense');$('amount').focus({preventScroll:true});};
$('entry-form').onsubmit=event=>{
  event.preventDefault();$('form-error').textContent='';
  try{
    const amountCents=parseMoney($('amount').value),description=$('description').value.trim()||(entryType==='income'?'รายรับ':'รายจ่าย'),date=$('date').value;
    if(!validDate(date))throw new Error('เลือกวันที่ให้ถูกต้อง');
    const row={id:editingId||crypto.randomUUID(),date,type:entryType,amountCents,description,category:$('category').value.trim(),tripId:$('entry-trip').value};
    if(editingId && JSON.stringify(state.entries.find(r=>r.id===editingId))!==editingOriginal)throw new Error('รายการนี้เปลี่ยนจากแท็บอื่น โปรดยกเลิกแล้วเปิดแก้ไขใหม่');
    const entries=editingId?state.entries.map(r=>r.id===editingId?row:r):[...state.entries,row];
    const wasEditing=Boolean(editingId),before=editingId?state.entries.find(r=>r.id===editingId):null;commit({...state,entries});rememberSave([{after:row,before}],(wasEditing?'แก้ไข':'บันทึก')+' '+description+' ฿'+money(amountCents));currentPage=1;$('month').value=date.slice(0,7);$('search').value='';$('filter-type').value='all';$('trip-filter').value='';render();resetForm();notify((wasEditing?'แก้ไข':'บันทึก')+' '+description+' '+money(amountCents)+' บาทแล้ว');$('amount').focus({preventScroll:true});
  }catch(error){$('form-error').textContent=error.message;}
};
$('cancel-edit').onclick=resetForm;
$('entries').onclick=event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const row=state.entries.find(r=>r.id===button.dataset.id);if(!row)return;
  if(button.dataset.action==='edit'){
    editEntry(row.id);
  }else{
    try{commit({...state,entries:state.entries.filter(r=>r.id!==row.id)});deleted=row;if(editingId===row.id)resetForm();notify('ลบ “'+row.description+'” แล้ว',true);}catch(error){notify(error.message);}
  }
};
$('undo').onclick=()=>{if(!deleted)return;try{commit({...state,entries:[...state.entries,deleted]});deleted=null;notify('คืนรายการและบันทึกแล้ว');}catch(error){notify(error.message,true);}};
$('dismiss-toast').onclick=()=>{$('toast').hidden=true;};
$('last-saved-edit').onclick=()=>{if(lastSave?.rows.length===1)editEntry(lastSave.rows[0].after.id);};
$('last-saved-undo').onclick=()=>{
  try{
    if(!lastSave||lastSave.rows.some(({after})=>JSON.stringify(state.entries.find(row=>row.id===after.id))!==JSON.stringify(after)))throw new Error('รายการเปลี่ยนแล้ว กรุณาตรวจรายการก่อนแก้ไข');
    const changes=new Map(lastSave.rows.map(change=>[change.after.id,change]));
    const entries=state.entries.flatMap(row=>{const change=changes.get(row.id);return change?(change.before?[change.before]:[]):[row];});
    commit({...state,entries});lastSave=null;renderLastSave();if(editingId&&changes.has(editingId))resetForm();notify('ย้อนกลับการบันทึกล่าสุดแล้ว');
  }catch(error){notify(error.message);}
};
$('category-chips').onclick=event=>{const button=event.target.closest('[data-category]');if(button)$('category').value=button.dataset.category;};
function changeMonth(offset){const [year,month]=$('month').value.split('-').map(Number);const date=new Date(year,month-1+offset,1);if(date.getFullYear()<1900||date.getFullYear()>2200)return;currentPage=1;$('month').value=localDate(date).slice(0,7);render();}
$('prev-month').onclick=()=>changeMonth(-1);$('next-month').onclick=()=>changeMonth(1);
$('month').min='1900-01';$('month').max='2200-12';
$('month').onchange=()=>{currentPage=1;if(!/^\d{4}-\d{2}$/.test($('month').value)||!validDate($('month').value+'-01')){$('month').value=localDate().slice(0,7);}render();};
function resetPage(){currentPage=1;render();}
$('search').oninput=resetPage;$('filter-type').onchange=resetPage;$('trip-filter').onchange=resetPage;
$('clear-filter').onclick=()=>{$('search').value='';$('filter-type').value='all';$('trip-filter').value='';resetPage();};
function turnPage(delta){currentPage+=delta;render();$('transactions').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
$('page-prev').onclick=()=>turnPage(-1);$('page-next').onclick=()=>turnPage(1);
$('start-empty').onclick=()=>{
  if(!confirm('เริ่มจดใหม่โดยนำข้อมูลตัวอย่างทั้งหมดออก? หากเพิ่มรายการไว้ในชุดตัวอย่างแล้ว ให้สำรองข้อมูลก่อน'))return;
  try{commit(emptyState());deleted=null;lastSave=null;tripsUI?.reset();resetForm();render();notify('พร้อมจดข้อมูลของคุณแล้ว');}catch(error){notify(error.message);}
};
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('backup').onclick=()=>{if(storageFault){if(lastStoredRaw!==null)download(lastStoredRaw,'budget-unreadable-original-'+localDate()+'.json','application/json');else notify('ไม่สามารถอ่านข้อมูลเดิมเพื่อสำรองได้');}else download(JSON.stringify(state,null,2),'budget-backup-'+localDate()+'.json','application/json');};
function csvCell(value){let s=String(value);if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
$('export-csv').onclick=()=>{
  if(storageFault){notify('อ่านข้อมูลเดิมไม่ได้ โปรดสำรองข้อมูลดิบหรือกู้คืนก่อน');return;}
  const rows=state.entries.filter(r=>r.date.startsWith($('month').value+'-')).sort((a,b)=>a.date.localeCompare(b.date));
  const text='\ufeff'+[['วันที่','ประเภท','รายละเอียด','หมวด','จำนวนเงิน (บาท)','ทริป'],...rows.map(r=>[r.date,r.type==='income'?'รายรับ':'รายจ่าย',r.description,r.category,(r.amountCents/100).toFixed(2),state.trips.find(t=>t.id===r.tripId)?.name||''])].map(row=>row.map(csvCell).join(',')).join('\r\n');
  download(text,'budget-'+$('month').value+'.csv','text/csv;charset=utf-8');notify('ส่งออก CSV ของเดือนที่เลือกแล้ว');
};
$('restore').onclick=()=>$('restore-file').click();
$('restore-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  const restoreKey=storageKey,restoreRaw=lastStoredRaw;
  try{
    if(file.size>20000000)throw new Error('ไฟล์ใหญ่เกินขนาดที่รองรับ');
    const next=validateState(JSON.parse(await file.text()));
    if(storageKey!==restoreKey||lastStoredRaw!==restoreRaw)throw new Error('บัญชีหรือข้อมูลเปลี่ยนระหว่างอ่านไฟล์ กรุณาเลือกไฟล์สำรองใหม่');
    if(!confirm(`กู้คืน ${next.entries.length} รายการ และ ${next.trips.length} ทริป แทนชุดปัจจุบัน (${state.entries.length} รายการ / ${state.trips.length} ทริป)? ควรสำรองชุดปัจจุบันก่อน`))return;
    const oldFault=storageFault,oldLegacy=legacyConflict;storageFault=false;legacyConflict=false;
    try{commit(next);currentPage=1;render();}catch(error){storageFault=oldFault;legacyConflict=oldLegacy;throw error;}
    deleted=null;lastSave=null;tripsUI?.reset();$('start-empty').hidden=false;resetForm();render();configureSync();notify('กู้คืนข้อมูลและบันทึกแล้ว');
  }catch(error){notify(error instanceof SyntaxError?'ไฟล์ JSON อ่านไม่ได้':error.message);}finally{event.target.value='';}
};
$('summary-nav').onclick=()=>{
  if(storageFault){notify('อ่านข้อมูลเดิมไม่ได้ โปรดกู้คืนก่อนดูสรุป');return;}
  const month=$('month').value,sums=totals(state,month),categories=new Map();
  for(const row of state.entries.filter(r=>r.date.startsWith(month+'-')&&r.type==='expense')){const key=row.category||'ไม่ระบุหมวด';categories.set(key,(categories.get(key)||0)+row.amountCents);}
  $('summary-period').textContent=monthName(month);
  $('summary-content').innerHTML=`<div class="summary-row"><span>รายรับ</span><strong>฿${money(sums.income)}</strong></div><div class="summary-row"><span>รายจ่าย</span><strong>฿${money(sums.expense)}</strong></div><div class="summary-row"><span>รับ − จ่าย เดือนนี้</span><strong>฿${money(sums.income-sums.expense)}</strong></div><p>รายจ่ายแยกหมวด</p>`+[...categories].sort((a,b)=>b[1]-a[1]).map(([key,cents])=>`<div class="summary-row"><span>${escape(key)}</span><strong>฿${money(cents)}</strong></div>`).join('');
  $('summary-dialog').showModal();
};
$('close-summary').onclick=()=>$('summary-dialog').close();
$('summary-done').onclick=()=>{$('summary-dialog').close();showView('entry-panel',{focus:true});};
tripsUI=createTripsUI({getState:()=>state,commit,notify,money,thaiDate,editEntry,getKey:()=>storageKey,isEditing:()=>Boolean(editingId),hasDraft:hasEntryDraft,prepareExpense:()=>setType('expense')});tripsUI.reset();$('trips-new').disabled=false;
resetForm();render();$('entry-fields').disabled=false;$('entry-loading').hidden=true;if(activeView()==='entry-panel'&&matchMedia('(pointer: fine)').matches&&!storageFault)$('amount').focus({preventScroll:true});if(storageFault)notify('อ่านข้อมูลเดิมไม่สำเร็จ ยังไม่ได้เขียนทับ โปรดกู้คืนจากไฟล์สำรอง');

window.addEventListener('storage',event=>{
  if(event.key!==storageKey&&event.key!==null)return;
  if(event.newValue===null){lastStoredRaw=null;cloudSync?.pause();notify('ข้อมูลในเครื่องถูกล้าง ระบบพักซิงค์ไว้ กรุณาเลือกกู้คืนจากคลาวด์หรือโหลดหน้าใหม่');return;}
  try{
    const input=JSON.parse(event.newValue);
    if(input.version===1&&state.trips.length){
      const recovery=JSON.stringify(state);try{localStorage.setItem(storageKey+':trip-recovery',recovery);}catch{}
      download(recovery,'jodngern-trips-recovery-'+localDate()+'.json','application/json');lastStoredRaw=event.newValue;legacyConflict=true;cloudSync?.pause('พบแท็บรุ่นเก่า · เลือกชุดข้อมูลเพื่อรักษาทริป');
      notify('พบแท็บแอปรุ่นเก่า พักซิงค์และสำรองชุดที่มีทริปแล้ว กรุณาปิดแท็บเก่าและกู้คืนไฟล์สำรอง หรือเลือกชุดข้อมูลในหน้า “ข้อมูล”');return;
    }
    const wasLegacy=legacyConflict,next=validateState(input);state=next;lastStoredRaw=event.newValue;storageFault=false;legacyConflict=false;$('start-empty').hidden=false;render();if(wasLegacy)configureSync();else cloudSync?.changed();notify('อัปเดตข้อมูลจากแท็บอื่นแล้ว');
  }catch{storageFault=true;lastStoredRaw=event.newValue;render();notify('ข้อมูลจากแท็บอื่นอ่านไม่ได้ กรุณากู้คืนจากไฟล์');}
});

// AI proposes data only. Every write goes through the same validated local commit.
let aiAction='extract',aiImage=null,aiPreviewURL=null,aiBusy=false,aiGeneration=0,aiReviewedRaw=null,aiTripDefault='';
function clearAIImage(){aiImage=null;if(aiPreviewURL)URL.revokeObjectURL(aiPreviewURL);aiPreviewURL=null;$('ai-image').value='';$('ai-image-preview').removeAttribute('src');$('ai-image-preview').hidden=true;$('ai-image-remove').hidden=true;}
function clearAIResult(){$('ai-review').hidden=true;$('ai-answer').hidden=true;$('ai-answer').textContent='';$('ai-candidates').replaceChildren();$('ai-warnings').replaceChildren();aiReviewedRaw=null;}
function setAIBusy(busy){aiBusy=busy;for(const id of ['ai-submit','ai-text','ai-image','ai-image-remove','ai-save-reviewed'])$(id).disabled=busy;$('ai-close').disabled=busy;if(busy)$('ai-status').textContent='กำลังอ่านและเตรียมคำตอบ…';else if($('ai-status').textContent==='กำลังอ่านและเตรียมคำตอบ…')$('ai-status').textContent='';}
function openAI(action,image=false,question=''){
  if(storageFault){notify('อ่านข้อมูลเดิมไม่ได้ โปรดกู้คืนก่อนใช้ AI');return;}
  if(state.demo){notify('กด “เริ่มจดข้อมูลของฉัน” ก่อนใช้ AI เพื่อไม่ปะปนกับข้อมูลตัวอย่าง');return;}
  aiAction=action;aiTripDefault=$('entry-trip').value;aiGeneration++;clearAIResult();clearAIImage();$('ai-error').textContent='';$('ai-status').textContent='';$('ai-text').value=question;
  $('ai-heading').textContent=action==='extract'?'ช่วยจดด้วย AI':'ถามเรื่องเงิน';
  $('ai-guidance').textContent=action==='extract'?'ตรวจรายการและทริปก่อนยืนยัน ถ้าสลิปไม่บอกว่าซื้ออะไร ให้เติมรายละเอียด':'ตอบจากรายการเดือน '+monthName($('month').value)+' และเดือนก่อนเพื่อเทียบ อาจไม่ครบเงินจริงของคุณ AI ไม่แก้ไขรายการ';
  $('ai-text-label').textContent=action==='extract'?'เล่าให้ฟังว่ารับหรือจ่ายอะไร':'อยากรู้เรื่องอะไร';
  $('ai-text').placeholder=action==='extract'?'วันนี้ข้าว 65 กาแฟ 50 เมื่อวานเติมน้ำมัน 800':'เดือนนี้จ่ายกับอะไรเยอะที่สุด';
  $('ai-submit').textContent=action==='extract'?'ให้ AI เตรียมรายการ':'ถาม AI';$('ai-image-tools').hidden=action!=='extract';
  $('ai-dialog').showModal();if(image)$('ai-image').click();else $('ai-text').focus();
}
$('ai-extract-open').onclick=()=>openAI('extract');$('ai-ask-open').onclick=()=>openAI('ask',false,'สรุปว่ารายจ่ายเดือนที่เลือกไปกับอะไรเป็นหลัก ชี้รายการสำคัญจากข้อมูลที่จด และบอกข้อจำกัดของข้อมูล');
$('ai-image-open').onclick=()=>openAI('extract',true);
$('expense-compare-open').onclick=()=>openAI('ask',false,'เทียบรายจ่ายเดือนที่เลือกกับเดือนก่อน หมวดไหนเพิ่มขึ้นมากที่สุด และเพิ่มจากรายการอะไรบ้าง ถ้าข้อมูลไม่พอให้บอกตรง ๆ');
$('ai-close').onclick=()=>$('ai-dialog').close();
$('ai-dialog').addEventListener('cancel',event=>{if(aiBusy)event.preventDefault();});
$('ai-dialog').addEventListener('close',()=>{aiGeneration++;clearAIImage();clearAIResult();$('ai-text').value='';});
$('ai-image-remove').onclick=()=>{clearAIImage();clearAIResult();};
$('ai-text').oninput=()=>{clearAIResult();$('ai-error').textContent='';$('ai-status').textContent='';};
$('ai-image').onchange=async event=>{
  const file=event.target.files[0];clearAIImage();clearAIResult();$('ai-error').textContent='';if(!file)return;
  const generation=aiGeneration;
  setAIBusy(true);
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024||file.size===0)throw new Error('ใช้ภาพ JPG, PNG หรือ WebP ไม่เกิน 5 MB');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if(!({ 'image/jpeg':jpeg,'image/png':png,'image/webp':webp })[file.type])throw new Error('ไฟล์นี้ไม่ใช่ภาพที่รองรับ');
    const bitmap=await createImageBitmap(file);
    let upload;
    try{
      if(bitmap.width*bitmap.height>40000000||bitmap.width>16000||bitmap.height>16000)throw new Error('ภาพมีขนาดใหญ่เกินไป กรุณาครอปหรือย่อภาพก่อน');
      const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      upload=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
      if(!upload||upload.size>5*1024*1024)throw new Error('ภาพยังใหญ่เกินไป กรุณาครอปภาพก่อน');
    }finally{bitmap.close();}
    const uploadBytes=new Uint8Array(await upload.arrayBuffer());
    let binary='';for(let i=0;i<uploadBytes.length;i+=8192)binary+=String.fromCharCode(...uploadBytes.subarray(i,i+8192));
    if(generation!==aiGeneration||!$('ai-dialog').open)return;
    aiImage={data:btoa(binary),mimeType:'image/jpeg'};aiPreviewURL=URL.createObjectURL(upload);$('ai-image-preview').src=aiPreviewURL;$('ai-image-preview').hidden=false;$('ai-image-remove').hidden=false;
  }catch(error){$('ai-error').textContent=error.message;}finally{setAIBusy(false);$('ai-save-reviewed').disabled=true;}
};
function aiContext(){
  const month=$('month').value,entries=state.entries.filter(row=>row.date.startsWith(month+'-')).map(({date,type,amountCents,description,category})=>({date,type,amountCents,description,category}));
  const priorMonth=previousMonth(month),previousEntries=state.entries.filter(row=>row.date.startsWith(priorMonth+'-')).map(({date,type,amountCents,description,category})=>({date,type,amountCents,description,category}));
  if(entries.length+previousEntries.length>500)throw new Error('สองเดือนนี้รวมเกิน 500 รายการ จึงยังส่งให้ AI วิเคราะห์ไม่ได้ ดูสรุปหมวดในแอปได้โดยไม่ใช้ AI');
  const sums=totals(state,month);
  return {month,entries,previous:validDate(priorMonth+'-01')?{month:priorMonth,entries:previousEntries}:null,totals:{income:sums.income,expense:sums.expense,net:sums.income-sums.expense}};
}
function validatedAICandidates(response){
  if(!Array.isArray(response.entries)||response.entries.length>50||!Array.isArray(response.warnings)||response.warnings.length>30)throw new Error('รูปแบบรายการจาก AI ไม่ถูกต้อง กรุณาลองใหม่');
  const entries=response.entries.map(row=>{
    if(!row||!['income','expense'].includes(row.type)||typeof row.amount!=='string'||!validDate(row.date)||typeof row.description!=='string'||!row.description.trim()||row.description.length>160||typeof row.category!=='string'||row.category.length>60)throw new Error('AI อ่านบางช่องไม่ครบหรือไม่ถูกต้อง กรุณาเพิ่มรายละเอียดแล้วลองใหม่');
    parseMoney(row.amount);return {...row,description:row.description.trim(),category:row.category.trim()};
  });
  if(response.warnings.some(text=>typeof text!=='string'||text.length>1000))throw new Error('คำเตือนจาก AI อ่านไม่ได้');
  return {entries,warnings:response.warnings};
}
function candidateField(label,value,kind,maxLength){
  const wrap=document.createElement('label');wrap.className='field';wrap.textContent=label;
  const control=document.createElement(kind==='type'||kind==='tripId'?'select':'input');control.dataset.field=kind;
  if(kind==='type'){for(const [v,t] of [['expense','รายจ่าย'],['income','รายรับ']]){const option=document.createElement('option');option.value=v;option.textContent=t;control.append(option);}}
  else if(kind==='tripId'){control.add(new Option('ไม่ผูกกับทริป',''));for(const trip of state.trips){if(!trip.archived||trip.id===value)control.add(new Option(trip.name,trip.id));}}
  else{control.type=kind==='date'?'date':'text';if(kind==='amount')control.inputMode='decimal';if(maxLength)control.maxLength=maxLength;}
  control.value=value;wrap.append(control);return wrap;
}
function displayAICandidates(result){
  for(const warning of result.warnings){const li=document.createElement('li');li.textContent=warning;$('ai-warnings').append(li);}
  result.entries.forEach((row,index)=>{
    const item=document.createElement('article');item.className='ai-candidate';
    const selection=document.createElement('label');selection.className='ai-candidate-select';const check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.field='include';selection.append(check,document.createTextNode(' บันทึกรายการที่ '+(index+1)));item.append(selection);
    item.append(candidateField('ประเภท',row.type,'type'),candidateField('จำนวนเงิน (บาท)',row.amount,'amount',24),candidateField('วันที่',row.date,'date'),candidateField('รายละเอียด',row.description,'description',160),candidateField('หมวด',row.category,'category',60),candidateField('ทริป',aiTripDefault,'tripId'));
    const amount=parseMoney(row.amount),existing=state.entries.some(old=>old.date===row.date&&old.type===row.type&&old.amountCents===amount&&old.description===row.description);
    const earlier=result.entries.slice(0,index).some(old=>old.date===row.date&&old.type===row.type&&parseMoney(old.amount)===amount&&old.description===row.description);
    if(existing||earlier){check.checked=false;const warning=document.createElement('p');warning.className='ai-duplicate';warning.textContent='อาจซ้ำกับรายการที่มีอยู่หรือรายการด้านบน จึงยังไม่เลือกบันทึก';item.append(warning);}
    $('ai-candidates').append(item);
  });
  aiReviewedRaw=lastStoredRaw;$('ai-review').hidden=false;$('ai-save-reviewed').disabled=!result.entries.length;
  $('ai-status').textContent=result.entries.length?'เตรียม '+result.entries.length+' รายการแล้ว ยังไม่ได้บันทึก':'ไม่พบรายการที่อ่านได้ กรุณาเติมรายละเอียด';
}
$('ai-form').onsubmit=async event=>{
  event.preventDefault();if(aiBusy)return;clearAIResult();$('ai-error').textContent='';
  const generation=aiGeneration,sourceRaw=lastStoredRaw;
  try{
    if(storageFault||state.demo)throw new Error('กรุณาใช้ข้อมูลจริงที่อ่านได้ก่อนใช้ AI');
    const text=$('ai-text').value.trim();if(!text&&(aiAction==='ask'||!aiImage))throw new Error('พิมพ์ข้อความหรือแนบภาพก่อนส่ง');
    const payload={action:aiAction,text};
    if(aiAction==='extract'){if(aiImage)payload.image=aiImage;payload.date=localDate();}
    else payload.context=aiContext();
    setAIBusy(true);const response=await requestAI(payload);
    if(generation!==aiGeneration)return;
    if(lastStoredRaw!==sourceRaw||storageFault||state.demo)throw new Error('ข้อมูลเปลี่ยนระหว่างรอ AI กรุณาตรวจข้อมูลแล้วส่งใหม่');
    if(aiAction==='extract')displayAICandidates(validatedAICandidates(response));
    else{
      if(typeof response.answer!=='string'||!response.answer.trim()||response.answer.length>20000)throw new Error('คำตอบจาก AI ไม่ถูกต้อง');
      $('ai-answer').textContent=response.answer;$('ai-answer').hidden=false;
    }
  }catch(error){$('ai-error').textContent=error.message;}finally{setAIBusy(false);if(!$('ai-candidates').childElementCount)$('ai-save-reviewed').disabled=true;}
};
$('ai-save-reviewed').onclick=()=>{
  $('ai-error').textContent='';
  try{
    if(aiBusy||storageFault||state.demo||aiReviewedRaw!==lastStoredRaw)throw new Error('ข้อมูลเปลี่ยนไป กรุณาให้ AI เตรียมรายการใหม่ก่อนบันทึก');
    const rows=[];
    for(const item of $('ai-candidates').children){
      const field=name=>item.querySelector('[data-field="'+name+'"]');if(!field('include').checked)continue;
      const type=field('type').value,date=field('date').value,description=field('description').value.trim(),category=field('category').value.trim();
      if(!['income','expense'].includes(type)||!validDate(date)||!description||description.length>160||category.length>60)throw new Error('ตรวจประเภท วันที่ และรายละเอียดของรายการที่เลือกให้ครบ');
      rows.push({id:crypto.randomUUID(),type,date,amountCents:parseMoney(field('amount').value),description,category,tripId:field('tripId').value});
    }
    if(!rows.length)throw new Error('เลือกรายการที่ต้องการบันทึกอย่างน้อยหนึ่งรายการ');
    commit({...state,entries:[...state.entries,...rows]});rememberSave(rows.map(after=>({after,before:null})),'บันทึก '+rows.length+' รายการจาก AI');currentPage=1;$('month').value=rows[0].date.slice(0,7);$('search').value='';$('filter-type').value='all';$('trip-filter').value='';render();$('ai-dialog').close();showView('entry-panel',{focus:true});notify('ตรวจและบันทึก '+rows.length+' รายการจาก AI แล้ว');
  }catch(error){$('ai-error').textContent=error.message;}
};

function configureSync(){
  cloudSync?.dispose();cloudSync=null;
  shownSyncConflict=false;$('data-nav-link').classList.remove('sync-warning');$('data-nav-link').setAttribute('aria-label','ข้อมูล');
  $('sync-conflict').hidden=true;
  if(owner==='anonymous'){$('sync-status').textContent='บันทึกในเครื่อง · เข้าสู่ระบบเพื่อซิงค์';$('sync-retry').hidden=true;return;}
  $('sync-retry').hidden=false;
  cloudSync=createCloudSync({key:storageKey,getRaw:()=>lastStoredRaw,getState:()=>{if(storageFault)throw new Error('อ่านข้อมูลในเครื่องไม่ได้');return state;},
    applyState:next=>{if(storageFault)throw new Error('อ่านข้อมูลในเครื่องไม่ได้ โปรดสำรองและกู้คืนก่อน');if(localStorage.getItem(storageKey)!==lastStoredRaw)throw new Error('ข้อมูลเปลี่ยนจากแท็บอื่น กรุณาโหลดใหม่');const checked=validateState(next),raw=JSON.stringify(checked);localStorage.setItem(storageKey,raw);lastStoredRaw=raw;state=checked;legacyConflict=false;deleted=null;if($('ai-dialog').open)$('ai-dialog').close();render();},
    status:(text,conflict)=>{$('sync-status').textContent=text;$('sync-conflict').hidden=!conflict;$('data-nav-link').classList.toggle('sync-warning',conflict);$('data-nav-link').setAttribute('aria-label',conflict?'ข้อมูล · ต้องเลือกชุดข้อมูลสำหรับซิงค์':'ข้อมูล');if(conflict&&!shownSyncConflict)notify('ซิงค์ต้องการให้เลือกชุดข้อมูล กรุณาเปิดหน้า “ข้อมูล”');shownSyncConflict=conflict;},notify,
    backup:(data,label)=>download(JSON.stringify(data,null,2),'budget-'+label+'-'+localDate()+'.json','application/json')});
  if(legacyConflict)cloudSync.pause('พบแท็บรุ่นเก่า · เลือกชุดข้อมูลเพื่อรักษาทริป');else if(!storageFault)cloudSync.start();
}
$('sync-retry').onclick=()=>cloudSync?.retry();$('sync-use-cloud').onclick=()=>cloudSync?.useCloud();$('sync-use-local').onclick=()=>cloudSync?.useLocal();
window.addEventListener('budget-auth-changed',()=>{
  const nextOwner=window.budgetAuth.getUser()?.uid||'anonymous';if(nextOwner===owner)return;
  cloudSync?.dispose();cloudSync=null;owner=nextOwner;storageKey=STORAGE_KEY+':owner:'+encodeURIComponent(owner);
  currentPage=1;deleted=null;lastSave=null;storageFault=false;legacyConflict=false;editingId=null;editingOriginal=null;lastStoredRaw=null;
  try{loadState();}catch{state=emptyState();storageFault=true;}
  aiGeneration++;if($('ai-dialog').open)$('ai-dialog').close();clearAIImage();clearAIResult();tripsUI.reset();resetForm();render();configureSync();notify('เปลี่ยนบัญชีแล้ว · แสดงเฉพาะข้อมูลของบัญชีนี้');
});
configureSync();
