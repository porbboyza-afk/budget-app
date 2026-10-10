import {validateState} from './model.js';
export function createCloudSync({key,getRaw,getState,applyState,status,backup,notify}){
  let active=true,busy=false,conflict=false,timer,revision=0,syncedRaw=null,known=false;
  try{const meta=JSON.parse(localStorage.getItem(key+':sync')||'null');if(meta&&Number.isSafeInteger(meta.revision)&&meta.revision>=0){revision=meta.revision;syncedRaw=meta.raw;known=true;}}catch{}
  const dirty=()=>getRaw()!==syncedRaw;
  function show(text){if(active)status(text,conflict);}
  function record(raw){localStorage.setItem(key+':sync',JSON.stringify({revision,raw}));syncedRaw=raw;known=true;}
  async function request(method,payload){
    const token=await window.budgetAuth.getToken();if(!active)throw new Error('บัญชีเปลี่ยนแล้ว');
    const response=await fetch('/api/ledger',{method,cache:'no-store',headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(20000)});
    const data=await response.json();if(!response.ok){const error=new Error(data.error||'ซิงค์ไม่สำเร็จ');error.status=response.status;throw error;}
    if(!Number.isSafeInteger(data.revision)||data.revision<0)throw new Error('ข้อมูลคลาวด์ไม่ถูกต้อง');return data;
  }
  async function sync(){
    if(!active||busy||conflict)return;busy=true;show('กำลังซิงค์');
    try{
      const remote=await request('GET');if(!active||conflict)return;
      const remoteState=remote.state===null?null:validateState(remote.state);
      if(!known){
        if(remoteState&&getRaw()!==null){conflict=true;show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');return;}
        revision=remote.revision;
        if(remoteState){applyState(remoteState);record(getRaw());}
        else{known=true;record(null);}
      }else if(remote.revision!==revision){
        if(dirty()){conflict=true;show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');return;}
        if(remoteState){applyState(remoteState);revision=remote.revision;record(getRaw());}
        else throw new Error('ข้อมูลคลาวด์หายไป กรุณาตรวจสอบก่อนซิงค์');
      }
      if(dirty()){
        const raw=getRaw(),result=await request('PUT',{state:getState(),revision});if(!active)return;revision=result.revision;record(raw);
      }
      show(dirty()?'บันทึกในเครื่อง · รอซิงค์':'ซิงค์แล้ว');
      if(dirty())timer=setTimeout(sync,300);
    }catch(error){if(!active)return;if(error.status===409){conflict=true;show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');}else{show('บันทึกในเครื่อง · ซิงค์ไม่สำเร็จ');notify(error.message);}}
    finally{busy=false;}
  }
  async function resolve(useLocal){
    if(!active||busy)return;busy=true;show('กำลังตรวจข้อมูล');
    try{
      const remote=await request('GET');if(!active)return;
      const localRaw=getRaw(),cloud=remote.state===null?null:validateState(remote.state);
      if(!confirm(useLocal?'ใช้ข้อมูลในเครื่องแทนคลาวด์? จะดาวน์โหลดสำรองทั้งสองชุดก่อน':'ใช้ข้อมูลคลาวด์แทนในเครื่อง? จะดาวน์โหลดสำรองทั้งสองชุดก่อน'))return;
      if(localRaw!==getRaw())throw new Error('ข้อมูลในเครื่องเปลี่ยน กรุณาลองใหม่');
      backup(getState(),'local-before-sync');if(cloud)backup(cloud,'cloud-before-sync');
      if(useLocal){const selected=getState();applyState(selected);const sentRaw=getRaw();const result=await request('PUT',{state:selected,revision:remote.revision});if(!active)return;revision=result.revision;record(sentRaw);}
      else{if(!cloud)throw new Error('คลาวด์ยังไม่มีรายการให้กู้คืน');applyState(cloud);revision=remote.revision;record(getRaw());}
      conflict=false;show(dirty()?'บันทึกในเครื่อง · รอซิงค์':'ซิงค์แล้ว');notify('เลือกชุดข้อมูลแล้ว');if(dirty())timer=setTimeout(sync,300);
    }catch(error){if(active){conflict=true;show('ข้อมูลขัดแย้ง · ยังไม่เขียนทับ');notify(error.message);}}
    finally{busy=false;if(active&&conflict)show('ข้อมูลขัดแย้ง · เลือกชุดข้อมูล');}
  }
  const online=()=>sync();window.addEventListener('online',online);
  const visibility=()=>{if(document.visibilityState==='visible')sync();};document.addEventListener('visibilitychange',visibility);
  const interval=setInterval(()=>{if(document.visibilityState==='visible')sync();},30000);
  return {start:sync,pause(){conflict=true;clearTimeout(timer);show('ข้อมูลในเครื่องถูกล้าง · เลือกชุดข้อมูลเพื่อกู้คืน');},changed(){show(conflict?'ข้อมูลขัดแย้ง · เลือกชุดข้อมูล':'บันทึกในเครื่อง · รอซิงค์');clearTimeout(timer);timer=setTimeout(sync,500);},retry:sync,useCloud:()=>resolve(false),useLocal:()=>resolve(true),dispose(){active=false;clearTimeout(timer);clearInterval(interval);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visibility);}};
}
