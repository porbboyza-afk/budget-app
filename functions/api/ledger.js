import {handleLedger} from '../../server/ledger.js';
export const onRequest=({request,env})=>handleLedger(request,env);
