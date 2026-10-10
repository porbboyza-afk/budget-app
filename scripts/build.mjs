import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ASSETS} from './assets.mjs';
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
const existing=await readdir(new URL('../dist/',import.meta.url));
if(existing.some(name=>!ASSETS.includes(name)))throw new Error('Unexpected files in dist; inspect and move them before building.');
for(const name of ASSETS)await copyFile(new URL('../'+name,import.meta.url),new URL('../dist/'+name,import.meta.url));
const hash=createHash('sha256');
for(const name of [...ASSETS].sort()){hash.update(name);hash.update(await readFile(new URL('../'+name,import.meta.url)));}
const version=hash.digest('hex').slice(0,20);
const worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');
if(!worker.includes("const CACHE='budget-shell-v1';"))throw new Error('Service worker cache placeholder is missing.');
await writeFile(new URL('../dist/sw.js',import.meta.url),worker.replace("const CACHE='budget-shell-v1';",`const CACHE='budget-shell-${version}';`));
console.log('Built public assets only; secrets, source server and documents excluded.');
