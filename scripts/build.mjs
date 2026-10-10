import {mkdir,copyFile,readdir} from 'node:fs/promises';
import {ASSETS} from './assets.mjs';
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
const existing=await readdir(new URL('../dist/',import.meta.url));
if(existing.some(name=>!ASSETS.includes(name)))throw new Error('Unexpected files in dist; inspect and move them before building.');
for(const name of ASSETS)await copyFile(new URL('../'+name,import.meta.url),new URL('../dist/'+name,import.meta.url));
console.log('Built public assets only; secrets, source server and documents excluded.');
