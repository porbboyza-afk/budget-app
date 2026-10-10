import {handleAI} from '../../server/ai.js';
export const onRequest=context=>handleAI(context.request,context.env);
