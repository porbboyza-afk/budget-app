import {authenticate,json} from './ai.js';
import {validateState} from '../model.js';
const MAX_BODY=2*1024*1024;
class Failure extends Error{constructor(message,status=400){super(message);this.status=status;}}
function checkState(input){
  if(!input||!Array.isArray(input.entries)||input.entries.length>10000||input.demo===true)throw new Failure('รองรับข้อมูลจริงไม่เกิน 10,000 รายการ');
  if(input.entries.some(row=>typeof row?.id!=='string'||row.id.length>100))throw new Failure('รหัสรายการไม่ถูกต้อง');
  try{return validateState(input);}catch{throw new Failure('ข้อมูลรายการไม่ถูกต้อง');}
}
async function body(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Failure('ต้องส่งข้อมูล JSON',415);
  const reader=request.body?.getReader();if(!reader)throw new Failure('ไม่มีข้อมูล');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();throw new Failure('ข้อมูลใหญ่เกิน 2 MB',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Failure('อ่าน JSON ไม่ได้');}
}
export async function handleLedger(request,env,{local=false}={}){
  try{
    if(!['GET','PUT'].includes(request.method))throw new Failure('ไม่รองรับวิธีเรียกนี้',405);
    if(request.method==='PUT'&&request.headers.get('origin')!==new URL(request.url).origin)throw new Failure('ไม่อนุญาตคำขอจากเว็บอื่น',403);
    const owner=local?'local-owner':await authenticate(request,env);
    const adapter=local?env.LOCAL_LEDGER:null;
    if(local?!adapter:!env.BUDGET_AI_DB)throw new Failure('ยังไม่ได้ตั้งระบบเก็บข้อมูล',503);
    if(request.method==='GET'){
      const row=adapter?await adapter.get(owner):await env.BUDGET_AI_DB.prepare('SELECT revision,state_json,updated_at FROM ledgers WHERE owner=?').bind(owner).first();
      return json(row?{state:checkState(JSON.parse(row.state_json)),revision:row.revision,updatedAt:row.updated_at}:{state:null,revision:0});
    }
    const input=await body(request);
    if(!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)throw new Failure('รุ่นข้อมูลไม่ถูกต้อง');
    const state=checkState(input.state),raw=JSON.stringify(state),now=new Date().toISOString();
    let saved;
    if(adapter)saved=await adapter.compareAndSet(owner,input.revision,raw,now);
    else if(input.revision===0){
      const result=await env.BUDGET_AI_DB.prepare('INSERT INTO ledgers (owner,revision,state_json,updated_at) VALUES (?,1,?,?) ON CONFLICT(owner) DO NOTHING RETURNING revision').bind(owner,raw,now).first();saved=!!result;
    }else{
      const result=await env.BUDGET_AI_DB.prepare('UPDATE ledgers SET revision=revision+1,state_json=?,updated_at=? WHERE owner=? AND revision=? RETURNING revision').bind(raw,now,owner,input.revision).first();saved=!!result;
    }
    if(!saved)throw new Failure('ข้อมูลบนคลาวด์เปลี่ยนแล้ว กรุณาเลือกชุดข้อมูลก่อนซิงค์',409);
    return json({revision:input.revision+1,updatedAt:now});
  }catch(error){return json({error:error.status?error.message:'ระบบเก็บข้อมูลไม่พร้อม กรุณาลองใหม่'},error.status||503);}
}
