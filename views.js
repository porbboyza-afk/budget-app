const pages={overview:['ภาพรวม','ยอดเงินของเดือนที่เลือก'], 'entry-panel':['จดรายการ','จดเอง หรือให้ AI ช่วยเตรียมรายการ'],transactions:['รายการ','ค้นหาและจัดการรายการของเดือนที่เลือก'],'data-tools':['ข้อมูล','ซิงค์ สำรอง และจัดการข้อมูลของคุณ']};
let current='overview';
export function activeView(){return current;}
export function showView(id,{push=true,focus=false}={}){
  if(!Object.hasOwn(pages,id))id='overview';
  const changed=current!==id;current=id;
  for(const name of Object.keys(pages))document.getElementById(name).hidden=name!==id;
  document.getElementById('period-bar').hidden=id==='entry-panel';
  const [title,caption]=pages[id];
  const heading=document.getElementById('page-title');heading.textContent=title;
  document.getElementById('page-caption').textContent=caption;
  document.title='จดเงิน — '+title;
  for(const link of document.querySelectorAll('.sidebar nav a')){
    const selected=link.hash==='#'+id;link.classList.toggle('active',selected);
    if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  if(push&&location.hash!=='#'+id)history.pushState(null,'','#'+id);
  if(changed)window.scrollTo(0,0);
  if(focus)heading.focus({preventScroll:true});
}
function fromLocation(){showView(location.hash.slice(1),{push:false});}
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const id=link.hash.slice(1);if(!Object.hasOwn(pages,id))return;
  event.preventDefault();showView(id,{focus:true});
});
window.addEventListener('popstate',fromLocation);window.addEventListener('hashchange',fromLocation);
fromLocation();
