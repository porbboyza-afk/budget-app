let auth, sdk, local=false,offlineUser=null;
const OWNER_KEY='budget-last-owner-v1';
function getUser(){return local?{uid:'local-owner',email:''}:auth?.currentUser?{uid:auth.currentUser.uid,email:auth.currentUser.email||''}:offlineUser;}
function offline(button,status){
  try{const uid=localStorage.getItem(OWNER_KEY);if(uid&&/^[A-Za-z0-9_-]{1,128}$/.test(uid))offlineUser={uid,email:'',offline:true};}catch{}
  if(status)status.textContent=offlineUser?'ออฟไลน์ · ใช้ข้อมูลบัญชีล่าสุดในเครื่อง · เชื่อมต่อก่อนซิงค์หรือใช้ AI':'ออฟไลน์ · จดข้อมูลในเครื่องได้';
  if(button){button.textContent='เชื่อมต่ออีกครั้ง';button.disabled=false;button.onclick=()=>location.reload();}announce();
}
function announce(){window.dispatchEvent(new CustomEvent('budget-auth-changed',{detail:getUser()}));}
const ready=(async()=>{
  const button=document.getElementById('ai-login'),status=document.getElementById('ai-account-status');
  if(!navigator.onLine){offline(button,status);return;}
  try{
    const response=await fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();
    const config=await response.json();
    if(config.localPreview){local=true;if(button)button.hidden=true;if(status)status.textContent='AI พร้อมใช้ในเครื่องนี้';announce();return;}
    if(!config.firebase)throw new Error();
    const [{initializeApp},authSDK]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]);
    sdk=authSDK;auth=sdk.getAuth(initializeApp(config.firebase));
    await new Promise(resolve=>{const unsubscribe=sdk.onAuthStateChanged(auth,()=>{unsubscribe();resolve();});});
    sdk.onAuthStateChanged(auth,user=>{offlineUser=null;try{if(user)localStorage.setItem(OWNER_KEY,user.uid);else localStorage.removeItem(OWNER_KEY);}catch{}if(button)button.textContent=user?'ออกจากระบบ':'เข้าสู่ระบบ Google';if(status)status.textContent=user?'เข้าสู่ระบบแล้ว · ตรวจสิทธิ์โดยเซิร์ฟเวอร์':'เข้าสู่ระบบเพื่อซิงค์ข้อมูลและใช้ AI';announce();});
    if(button)button.onclick=async()=>{button.disabled=true;try{if(auth.currentUser)await sdk.signOut(auth);else await sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());}catch{if(status)status.textContent='เข้าสู่ระบบไม่สำเร็จ ลองใหม่และตรวจว่าป๊อปอัปถูกอนุญาต';}finally{button.disabled=false;}};
  }catch{offline(button,status);}
})();
window.budgetAuth={ready,getUser,async getToken(){await ready;if(local)return 'local-preview';if(!auth?.currentUser)throw new Error('กรุณาเข้าสู่ระบบ Google ก่อนใช้ AI');return auth.currentUser.getIdToken();}};
