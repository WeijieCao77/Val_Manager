import postgres from '../../node_modules/postgres/src/index.js';
import {randomBytes} from 'node:crypto';
import {prune} from '../../stats.js';
const base=process.env.PG_TEST_URL;
if(!base || !['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw new Error('Dedicated local PG_TEST_URL required');
const admin=postgres(base,{max:1,onnotice:()=>{}}), name='verify_prune_'+randomBytes(5).toString('hex');
await admin.unsafe(`create database ${name}`);const u=new URL(base);u.pathname='/'+name;
const sql=postgres(u.toString(),{max:2,onnotice:()=>{}}), writer=postgres(u.toString(),{max:1,onnotice:()=>{}});
let release; const go=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);let pending;
try {
 await sql`create table events (id bigserial primary key, ts timestamptz not null default now())`;
 await sql`insert into events (ts) select now() from generate_series(1,12)`;
 const memo={};await prune(sql,180,10,12,memo);
 console.log('anchor',JSON.stringify(memo));
 pending=writer.begin(async tx=>{await tx`insert into events (ts) values(now())`;entered();await go;});await ready;
 await sql`insert into events (ts) values(now())`;
 // The previous fold covered <=12. Inserts 13 and 14 happen after that fold's SHARE lock ended.
 await prune(sql,180,10,12,memo);console.log('higher ID committed first',JSON.stringify(memo));
 release();await pending;
 // Next hourly fold now sees both commits and permits deleting through 14.
 await prune(sql,180,10,14,memo);
 const [row]=await sql`select count(*)::int as n,min(id)::int as first,max(id)::int as last from events`;
 console.log('after next hourly prune',JSON.stringify(row),'memo',JSON.stringify(memo));
 if(row.n!==10){console.log('FAIL exact cap: expected 10, actual '+row.n);process.exitCode=1}else console.log('PASS exact cap');
}finally{release?.();if(pending)await pending.catch(()=>{});await Promise.all([sql.end({timeout:2}),writer.end({timeout:2})]);await admin.unsafe(`drop database ${name} with(force)`);await admin.end({timeout:2})}
