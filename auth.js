let auth, sdk, local=false;
function getUser(){return local?{uid:'local-owner',email:''}:auth?.currentUser?{uid:auth.currentUser.uid,email:auth.currentUser.email||''}:null;}
function announce(){window.dispatchEvent(new CustomEvent('budget-auth-changed',{detail:getUser()}));}
const ready=(async()=>{
  const button=document.getElementById('ai-login'),status=document.getElementById('ai-account-status');
  try{
    const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)throw new Error();
    const config=await response.json();
    if(config.localPreview){local=true;if(button)button.hidden=true;if(status)status.textContent='AI พร้อมใช้ในเครื่องนี้';announce();return;}
    if(!config.firebase)throw new Error();
    const [{initializeApp},authSDK]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]);
    sdk=authSDK;auth=sdk.getAuth(initializeApp(config.firebase));
    await new Promise(resolve=>{const unsubscribe=sdk.onAuthStateChanged(auth,()=>{unsubscribe();resolve();});});
    sdk.onAuthStateChanged(auth,user=>{if(button)button.textContent=user?'ออกจากระบบ':'เข้าสู่ระบบ Google';if(status)status.textContent=user?'เข้าสู่ระบบแล้ว · ตรวจสิทธิ์โดยเซิร์ฟเวอร์':'เข้าสู่ระบบเพื่อซิงค์ข้อมูลและใช้ AI';announce();});
    if(button)button.onclick=async()=>{button.disabled=true;try{if(auth.currentUser)await sdk.signOut(auth);else await sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());}catch{if(status)status.textContent='เข้าสู่ระบบไม่สำเร็จ ลองใหม่และตรวจว่าป๊อปอัปถูกอนุญาต';}finally{button.disabled=false;}};
  }catch{if(status)status.textContent='AI ยังไม่พร้อม กรุณาเปิดผ่านเซิร์ฟเวอร์ของแอป';if(button)button.disabled=true;}
})();
window.budgetAuth={ready,getUser,async getToken(){await ready;if(local)return 'local-preview';if(!auth?.currentUser)throw new Error('กรุณาเข้าสู่ระบบ Google ก่อนใช้ AI');return auth.currentUser.getIdToken();}};
