import {localDate,validDate,parseMoney,tripTotals} from './model.js';
import {showView} from './views.js';

export function createTripsUI({getState,commit,notify,money,thaiDate,editEntry,getKey,isEditing,hasDraft,prepareExpense}){
  const $=id=>document.getElementById(id);
  let selected='',editing=null,original=null,page=1,listPage=1,remembered='';
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function remember(id){remembered=id;try{localStorage.setItem(getKey()+':active-trip',id);}catch{notify('จำทริปในเครื่องไม่ได้ แต่รายการยังบันทึกได้');}}
  function reset(){selected='';page=1;listPage=1;editing=null;original=null;remembered='';try{remembered=localStorage.getItem(getKey()+':active-trip')||'';}catch{}$('entry-trip').value='';$('trip-filter').value='';if($('trip-dialog').open)$('trip-dialog').close();render();$('entry-trip').value=getState().trips.some(t=>t.id===remembered&&!t.archived)?remembered:'';hint();}
  function options(select,initial,includeArchived){
    const current=select.value;select.replaceChildren(new Option(initial,''));
    for(const trip of getState().trips){if(!includeArchived&&trip.archived&&trip.id!==current)continue;select.add(new Option(trip.name+(trip.archived?' · จบทริปแล้ว':''),trip.id));}
    select.value=getState().trips.some(t=>t.id===current)?current:'';
  }
  function hint(){
    const trip=getState().trips.find(t=>t.id===$('entry-trip').value),date=$('date').value;
    $('trip-hint').textContent=trip?(date&&(date<trip.startDate||date>trip.endDate)?'วันที่จ่ายอยู่นอกวันเดินทางได้ เช่น ค่าตั๋วล่วงหน้า':'รายการนี้นับในทริปและยอดประจำเดือนครั้งเดียว'):'';
  }
  function categories(container,categories,total){
    container.replaceChildren();
    for(const [name,cents] of categories.slice(0,3)){
      const line=document.createElement('div');line.className='category-line';const label=document.createElement('span');label.textContent=name;
      const amount=document.createElement('strong');amount.textContent='฿'+money(cents);const bar=document.createElement('progress');bar.max=100;bar.value=total?cents/total*100:0;bar.setAttribute('aria-label',name+' '+Math.round(bar.value)+'%');line.append(label,amount,bar);container.append(line);
    }
    if(!categories.length){const text=document.createElement('p');text.textContent='ยังไม่มีรายจ่าย';container.append(text);}
  }
  function render(){
    const state=getState();options($('entry-trip'),'ไม่ผูกกับทริป',false);options($('trip-filter'),'ทุกทริป / รายการทั่วไป',true);hint();
    $('trips-empty').hidden=state.trips.length>0;$('trips-empty').textContent='ยังไม่มีทริป เพิ่มชื่อทริปแล้วเริ่มจดค่าใช้จ่ายได้เลย';
    const sorted=[...state.trips].sort((a,b)=>Number(a.archived)-Number(b.archived)||b.startDate.localeCompare(a.startDate)),listPages=Math.max(1,Math.ceil(sorted.length/6));listPage=Math.max(1,Math.min(listPage,listPages));
    $('trip-list-pagination').hidden=listPages===1;$('trip-list-prev').disabled=listPage===1;$('trip-list-next').disabled=listPage===listPages;$('trip-list-page').textContent=`หน้า ${listPage} / ${listPages} · ${sorted.length} ทริป`;
    $('trips-list').innerHTML=sorted.slice((listPage-1)*6,listPage*6).map(trip=>{
      const sums=tripTotals(state,trip.id),remaining=trip.budgetCents-sums.expense;
      return `<button type="button" class="trip-card${trip.id===selected?' selected':''}" data-trip="${escape(trip.id)}" aria-pressed="${trip.id===selected}"><strong>${escape(trip.name)}</strong><span>${thaiDate(trip.startDate)} – ${thaiDate(trip.endDate)}${trip.archived?' · จบทริปแล้ว':''}</span><span>ใช้ไป ฿${money(sums.expense)}${trip.budgetCents?' · '+(remaining<0?'เกินงบ ฿'+money(-remaining):'เหลือ ฿'+money(remaining)):' · ยังไม่ตั้งงบ'}</span></button>`;
    }).join('');
    const trip=state.trips.find(t=>t.id===selected);$('trip-detail').hidden=!trip;if(!trip)return;
    const sums=tripTotals(state,trip.id),remaining=trip.budgetCents-sums.expense;
    $('trip-detail-title').textContent=trip.name;$('trip-detail-dates').textContent=thaiDate(trip.startDate)+' – '+thaiDate(trip.endDate);
    $('trip-detail-spent').textContent='฿'+money(sums.expense);$('trip-detail-budget').textContent=trip.budgetCents?'฿'+money(trip.budgetCents):'ไม่ตั้งงบ';
    $('trip-detail-remaining').textContent=trip.budgetCents?(remaining<0?'เกิน ฿'+money(-remaining):'฿'+money(remaining)):'—';
    $('trip-detail-progress').hidden=!trip.budgetCents;$('trip-detail-progress').value=trip.budgetCents?Math.min(100,sums.expense/trip.budgetCents*100):0;
    $('trip-detail-progress').setAttribute('aria-label','ใช้ไป '+Math.round(trip.budgetCents?sums.expense/trip.budgetCents*100:0)+'% ของงบ');
    $('trip-budget-note').textContent=(trip.archived?'จบทริปแล้ว · ':'')+'รวมรายจ่ายทุกวันที่ผูกกับทริป ไม่จำกัดเดือน · รายรับไม่หักจากยอดใช้ไป';
    $('trip-archive').textContent=trip.archived?'เปิดทริปอีกครั้ง':'จบทริป';$('trip-add-expense').hidden=trip.archived;
    categories($('trip-detail-categories'),sums.categories,sums.expense);
    const rows=[...sums.entries].reverse().sort((a,b)=>b.date.localeCompare(a.date)),pages=Math.max(1,Math.ceil(rows.length/10));page=Math.max(1,Math.min(page,pages));
    $('trip-detail-entries').innerHTML=rows.slice((page-1)*10,page*10).map(row=>`<button type="button" class="trip-entry" data-entry="${escape(row.id)}"><span><strong>${escape(row.description)}</strong><small>${thaiDate(row.date)}${row.category?' · '+escape(row.category):''}</small></span><strong>${row.type==='expense'?'−':'+'}${money(row.amountCents)}</strong></button>`).join('')||'<p>ยังไม่มีรายการในทริปนี้</p>';
    $('trip-entry-prev').disabled=page===1;$('trip-entry-next').disabled=page===pages;$('trip-entry-page').textContent=`หน้า ${page} / ${pages} · ${rows.length} รายการ`;
  }
  function open(trip=null){
    editing=trip?.id||null;original=trip?JSON.stringify(trip):null;$('trip-form').reset();$('trip-heading').textContent=trip?'แก้ไขทริป':'สร้างทริป';$('trip-error').textContent='';
    $('trip-name').value=trip?.name||'';$('trip-start').value=trip?.startDate||localDate();$('trip-end').value=trip?.endDate||localDate();$('trip-budget').value=trip?.budgetCents?(trip.budgetCents/100).toFixed(2):'';$('trip-dialog').showModal();
  }
  $('trips-new').onclick=()=>open();$('trip-cancel').onclick=()=>$('trip-dialog').close();
  $('trip-form').onsubmit=event=>{
    event.preventDefault();$('trip-error').textContent='';
    try{
      const state=getState(),name=$('trip-name').value.trim(),startDate=$('trip-start').value,endDate=$('trip-end').value,budget=$('trip-budget').value.trim();
      if(!name||name.length>80||!validDate(startDate)||!validDate(endDate)||startDate>endDate)throw new Error('กรอกชื่อทริปและเลือกช่วงวันที่ให้ถูกต้อง');
      const old=state.trips.find(t=>t.id===editing);if(editing&&JSON.stringify(old)!==original)throw new Error('ทริปนี้เปลี่ยนแล้ว กรุณาปิดและเปิดแก้ไขใหม่');
      const trip={id:editing||crypto.randomUUID(),name,startDate,endDate,budgetCents:budget&&!/^0+(?:\.0{1,2})?$/.test(budget)?parseMoney(budget):0,archived:old?.archived||false};
      if(!editing&&state.trips.length>=200)throw new Error('รองรับได้ไม่เกิน 200 ทริป');
      commit({...state,trips:editing?state.trips.map(t=>t.id===editing?trip:t):[...state.trips,trip]});selected=trip.id;page=1;
      if(!trip.archived&&!isEditing()){remember(trip.id);if(!hasDraft())$('entry-trip').value=trip.id;}
      render();$('trip-dialog').close();$('trip-detail').scrollIntoView({block:'start',behavior:'instant'});notify('บันทึกทริป '+name+' แล้ว');
    }catch(error){$('trip-error').textContent=error.message;}
  };
  $('trips-list').onclick=event=>{const button=event.target.closest('[data-trip]');if(!button)return;selected=button.dataset.trip;page=1;render();$('trip-detail').scrollIntoView({block:'start',behavior:'instant'});};
  $('trip-edit').onclick=()=>open(getState().trips.find(t=>t.id===selected));
  $('trip-archive').onclick=()=>{try{const state=getState(),trip=state.trips.find(t=>t.id===selected);if(!trip)return;commit({...state,trips:state.trips.map(t=>t.id===selected?{...t,archived:!t.archived}:t)});if(!trip.archived&&remembered===trip.id){remember('');if(!isEditing()&&!hasDraft())$('entry-trip').value='';}render();notify(trip.archived?'เปิดทริปอีกครั้งแล้ว':'จบทริปแล้ว · รายการยังอยู่ครบ');}catch(error){notify(error.message);}};
  $('trip-add-expense').onclick=()=>{const trip=getState().trips.find(t=>t.id===selected&&!t.archived);if(!trip)return;if(isEditing()||hasDraft()){notify('มีรายการที่ยังไม่ได้บันทึก กรุณาบันทึกหรือแก้รายการนั้นก่อนเปลี่ยนทริป');showView('entry-panel',{focus:true});return;}remember(trip.id);prepareExpense();$('entry-trip').value=trip.id;hint();showView('entry-panel',{focus:true});};
  $('trip-detail-entries').onclick=event=>{const button=event.target.closest('[data-entry]');if(button)editEntry(button.dataset.entry);};
  $('trip-entry-prev').onclick=()=>{page--;render();};$('trip-entry-next').onclick=()=>{page++;render();};
  $('trip-list-prev').onclick=()=>{listPage--;render();};$('trip-list-next').onclick=()=>{listPage++;render();};
  $('entry-trip').onchange=()=>{if(!isEditing())remember($('entry-trip').value);hint();};$('date').addEventListener('change',hint);
  return {render,reset,hint,categories,defaultTrip(){return getState().trips.some(t=>t.id===remembered&&!t.archived)?remembered:'';}};
}
