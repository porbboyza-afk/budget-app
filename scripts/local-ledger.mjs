import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
const directory=new URL('../.local/',import.meta.url),file=new URL('ledger.json',directory);
let chain=Promise.resolve();
export const localLedger={
  async get(){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
  async compareAndSet(owner,revision,state_json,updated_at){
    const operation=chain.then(async()=>{
      const old=await localLedger.get();if((old?.revision||0)!==revision)return false;
      await mkdir(directory,{recursive:true});
      const temporary=new URL('ledger.pending.json',directory);
      await writeFile(temporary,JSON.stringify({revision:revision+1,state_json,updated_at}),'utf8');await rename(temporary,file);return true;
    });
    chain=operation.catch(()=>{});return operation;
  }
};
