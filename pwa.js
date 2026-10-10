const install=document.getElementById('install-app'),update=document.getElementById('update-app'),status=document.getElementById('connection-status');
let promptEvent,registration;
let offlineReady=false;
function connection(){status.textContent=navigator.onLine?(offlineReady?'จดได้ทุกวัน · พร้อมใช้แบบออฟไลน์':'จดได้ทุกวัน · กำลังเตรียมโหมดออฟไลน์…'):'ออฟไลน์ · จดในเครื่องได้ ซิงค์และ AI ต้องใช้อินเทอร์เน็ต';}
connection();window.addEventListener('online',connection);window.addEventListener('offline',connection);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;install.hidden=false;});
if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)install.hidden=true;
document.getElementById('install-close').onclick=()=>document.getElementById('install-dialog').close();
install.onclick=async()=>{if(!promptEvent){document.getElementById('install-dialog').showModal();return;}await promptEvent.prompt();await promptEvent.userChoice;promptEvent=null;};
window.addEventListener('appinstalled',()=>{install.hidden=true;});
if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches){document.getElementById('ios-install').hidden=false;}
if('serviceWorker' in navigator){
  let requestedUpdate=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(requestedUpdate)location.reload();});
  navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>{
    registration=reg;
    navigator.serviceWorker.ready.then(()=>{offlineReady=true;connection();});
    const show=()=>{if(reg.waiting&&navigator.serviceWorker.controller)update.hidden=false;};
    show();reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',show);});
    update.onclick=()=>{if(!registration.waiting)return;if(!confirm('อัปเดตแอปตอนนี้? ข้อความที่ยังไม่ได้บันทึกจะหาย กรุณาบันทึกก่อนอัปเดต'))return;requestedUpdate=true;registration.waiting.postMessage('ACTIVATE_UPDATE');};
  }).catch(()=>{status.textContent='จดได้ตามปกติ · ยังเตรียมโหมดออฟไลน์ไม่สำเร็จ';});
}else{status.textContent='จดได้ตามปกติ · เบราว์เซอร์นี้ยังไม่รองรับโหมดออฟไลน์';}
