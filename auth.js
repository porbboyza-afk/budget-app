let auth, sdk, local=false;
const ready=(async()=>{
  const button=document.getElementById('ai-login'),status=document.getElementById('ai-account-status');
  try{
    const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)throw new Error();
    const config=await response.json();
    if(config.localPreview){local=true;if(button)button.hidden=true;if(status)status.textContent='AI พร้อมใช้ในเครื่องนี้';return;}
    if(!config.firebase)throw new Error();
    const [{initializeApp},authSDK]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]);
    sdk=authSDK;auth=sdk.getAuth(initializeApp(config.firebase));
    await new Promise(resolve=>{const unsubscribe=sdk.onAuthStateChanged(auth,()=>{unsubscribe();resolve();});});
    sdk.onAuthStateChanged(auth,user=>{if(button)button.textContent=user?'ออกจากระบบ AI':'เข้าสู่ระบบ Google เพื่อใช้ AI';if(status)status.textContent=user?'เข้าสู่ระบบแล้ว · สิทธิ์ AI ตรวจโดยเซิร์ฟเวอร์':'ใช้ AI ได้เฉพาะบัญชีที่เจ้าของอนุญาต';});
    if(button)button.onclick=async()=>{button.disabled=true;try{if(auth.currentUser)await sdk.signOut(auth);else await sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());}catch{if(status)status.textContent='เข้าสู่ระบบไม่สำเร็จ ลองใหม่และตรวจว่าป๊อปอัปถูกอนุญาต';}finally{button.disabled=false;}};
  }catch{if(status)status.textContent='AI ยังไม่พร้อม กรุณาเปิดผ่านเซิร์ฟเวอร์ของแอป';if(button)button.disabled=true;}
})();
window.budgetAuth={ready,async getToken(){await ready;if(local)return 'local-preview';if(!auth?.currentUser)throw new Error('กรุณาเข้าสู่ระบบ Google ก่อนใช้ AI');return auth.currentUser.getIdToken();}};
