let auth, sdk, local=false,offlineUser=null;
const OWNER_KEY='budget-last-owner-v1';
function getUser(){return local?{uid:'local-owner',email:''}:auth?.currentUser?{uid:auth.currentUser.uid,email:auth.currentUser.email||''}:offlineUser;}
function offline(button,status){
  try{const uid=localStorage.getItem(OWNER_KEY);if(uid&&/^[A-Za-z0-9_-]{1,128}$/.test(uid))offlineUser={uid,email:'',offline:true};}catch{}
  if(status)status.textContent=navigator.onLine?'เชื่อมต่อบัญชีไม่สำเร็จ · ตรวจอินเทอร์เน็ตแล้วลองเชื่อมต่ออีกครั้ง':offlineUser?'ออฟไลน์ · ใช้ข้อมูลบัญชีล่าสุดในเครื่อง · เชื่อมต่อก่อนซิงค์หรือใช้ AI':'ออฟไลน์ · จดข้อมูลในเครื่องได้';
  if(button){button.textContent='ลองเชื่อมต่ออีกครั้ง';button.disabled=false;button.onclick=()=>location.reload();}announce();
}
function announce(){window.dispatchEvent(new CustomEvent('budget-auth-changed',{detail:getUser()}));}
function bounded(promise,ms=12000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Auth timeout')),ms);})]).finally(()=>clearTimeout(timer));}
function loginError(error){
  switch(error?.code){
    case 'auth/popup-blocked':return 'เบราว์เซอร์บล็อกหน้าล็อกอิน · อนุญาตป๊อปอัปสำหรับเว็บนี้แล้วกดเข้าสู่ระบบอีกครั้ง หากเปิดจาก LINE / Facebook ให้เปิดลิงก์ใน Brave, Chrome หรือ Safari';
    case 'auth/popup-closed-by-user':case 'auth/cancelled-popup-request':return 'ยังไม่ได้เข้าสู่ระบบ · กดเข้าสู่ระบบ Google เพื่อเริ่มอีกครั้ง';
    case 'auth/network-request-failed':return 'เชื่อมต่อ Google ไม่สำเร็จ · ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
    case 'auth/unauthorized-domain':return 'โดเมนนี้ยังไม่ได้รับอนุญาตให้เข้าสู่ระบบ · เปิดผ่าน budget-app-porbboyza.pages.dev';
    case 'auth/web-storage-unsupported':return 'เบราว์เซอร์ไม่อนุญาตให้เก็บสถานะบัญชี · เปิดในโหมดปกติและอนุญาตข้อมูลเว็บไซต์';
    default:return 'เข้าสู่ระบบไม่สำเร็จ · ลองอีกครั้งผ่าน Brave, Chrome หรือ Safari';
  }
}
const ready=(async()=>{
  const button=document.getElementById('ai-login'),status=document.getElementById('ai-account-status');
  if(!navigator.onLine){offline(button,status);return;}
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    let config;try{const response=await fetch('/api/config',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error();config=await response.json();}finally{clearTimeout(timer);}
    if(config.localPreview){local=true;if(button)button.hidden=true;if(status)status.textContent='AI พร้อมใช้ในเครื่องนี้';announce();return;}
    if(!config.firebase)throw new Error();
    const [{initializeApp},authSDK]=await bounded(Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]));
    sdk=authSDK;auth=sdk.getAuth(initializeApp(config.firebase));
    await bounded(new Promise((resolve,reject)=>{const unsubscribe=sdk.onAuthStateChanged(auth,()=>{unsubscribe();resolve();},reject);}));
    sdk.onAuthStateChanged(auth,user=>{offlineUser=null;try{if(user)localStorage.setItem(OWNER_KEY,user.uid);else localStorage.removeItem(OWNER_KEY);}catch{}if(button)button.textContent=user?'ออกจากระบบ':'เข้าสู่ระบบ Google';if(status)status.textContent=user?'เข้าสู่ระบบแล้ว · ตรวจสิทธิ์โดยเซิร์ฟเวอร์':'เข้าสู่ระบบเพื่อซิงค์ข้อมูลและใช้ AI';announce();});
    if(button){button.disabled=false;button.onclick=async()=>{button.disabled=true;try{if(auth.currentUser)await sdk.signOut(auth);else{if(status)status.textContent='กำลังเปิดหน้าเข้าสู่ระบบ Google…';await sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());}}catch(error){if(status)status.textContent=loginError(error);}finally{button.disabled=false;}};}
  }catch{auth=null;sdk=null;local=false;offline(button,status);}
})();
window.budgetAuth={ready,getUser,async getToken(){await ready;if(local)return 'local-preview';if(!auth?.currentUser)throw new Error('กรุณาเข้าสู่ระบบ Google ก่อนใช้ AI');return auth.currentUser.getIdToken();}};
