import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {ASSETS} from './assets.mjs';
import {handleAI,publicConfig,MAX_BODY,json} from '../server/ai.js';
import {handleLedger} from '../server/ledger.js';
import {localLedger} from './local-ledger.mjs';
function envPairs(raw){return Object.fromEntries(raw.split(/\r?\n/).map(line=>line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(([,key,value])=>[key,value.replace(/^(['"])(.*)\1$/,'$2')]));}
const root=new URL('../',import.meta.url),env={};
for(const name of ['.env','.env.local']){try{Object.assign(env,envPairs(await readFile(new URL(name,root),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const name of ['DEEPSEEK_API_KEY','DEEPSEEK_ENV_FILE','FIREBASE_WEB_API_KEY','FIREBASE_PROJECT_ID','FIREBASE_AUTH_DOMAIN','BUDGET_ALLOWED_EMAILS'])if(process.env[name])env[name]=process.env[name];
if(!env.DEEPSEEK_API_KEY&&env.DEEPSEEK_ENV_FILE){const external=envPairs(await readFile(env.DEEPSEEK_ENV_FILE,'utf8'));env.DEEPSEEK_API_KEY=external.DEEPSEEK_API_KEY;}
env.LOCAL_LEDGER=localLedger;
const port=8771,origin=`http://127.0.0.1:${port}`;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end('Forbidden');return;}
    const url=new URL(req.url,origin);let response;
    if(url.pathname==='/api/config'&&req.method==='GET')response=publicConfig(env,true);
    else if(url.pathname==='/api/ledger'&&req.method==='GET')response=await handleLedger(new Request(url,{headers:req.headers}),env,{local:true});
    else if(url.pathname==='/api/ai'||url.pathname==='/api/ledger'){
      if((url.pathname==='/api/ai'&&req.method!=='POST')||(url.pathname==='/api/ledger'&&req.method!=='PUT')){response=json({error:'ไม่รองรับวิธีเรียกนี้'},405);}
      else{
        let length=0;const parts=[];
        for await(const chunk of req){length+=chunk.length;if(length>MAX_BODY){res.writeHead(413);res.end('Request too large');return;}parts.push(chunk);}
        const request=new Request(url,{method:req.method,headers:req.headers,body:Buffer.concat(parts)});
        response=url.pathname==='/api/ai'?await handleAI(request,env,{local:true}):await handleLedger(request,env,{local:true});
      }
    }else{
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(req.method!=='GET'||!ASSETS.includes(name)||name.startsWith('_')){response=new Response('Not found',{status:404});}
      else{const data=await readFile(new URL(name,root));const ext=name.slice(name.lastIndexOf('.'));response=new Response(data,{headers:{'Content-Type':mime[ext]||'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'Content-Type':'text/plain'});res.end('Server unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Budget AI: ${origin} · key ${env.DEEPSEEK_API_KEY?'loaded on server':'not configured'} (never printed)`));
