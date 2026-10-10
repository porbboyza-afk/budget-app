import {publicConfig} from '../../server/ai.js';
export const onRequestGet=context=>publicConfig(context.env);
