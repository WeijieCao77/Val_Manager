import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA } from '../opencup-api.js'
import { createCupEngineArchive, verifyCupBundle } from '../opencup-engine-archive.js'
import { createCupComputer } from '../opencup-worker.js'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { playOpenCupMatch } from '../src/engine/openCup'
const db=new PGlite(),sql=makeSql(db)
await db.exec(OPEN_CUP_SCHEMA);await db.exec(OPEN_CUP_V2_SCHEMA)
const source=await readFile(new URL('../dist-server/engine.mjs',import.meta.url))
const hash=createHash('sha256').update(source).digest('hex')
const archive=createCupEngineArchive(sql,{source,hash}),computer=createCupComputer()
try {
 await Promise.all([archive.register(),archive.register()])
 assert.equal((await sql`select count(*)::int as n from open_cup_engine_builds`)[0].n,1)
 const build=await archive.load(hash)
 assert.deepEqual(await verifyCupBundle(build),source)
 const side=(i:number)=>({name:'x',tag:'x',...CUP_TEAMS[i].squad,levels:{},div:0,points:0})
 const args=[side(0),side(1),true,991,2] as const
 assert.deepEqual(await computer.compute(args,build),playOpenCupMatch(...args))
 // Change the deployed source without changing an already-started cup's hash.
 const changed=Buffer.from(source.toString()+'\n// next deployment\n')
 const changedHash=createHash('sha256').update(changed).digest('hex')
 const next=createCupEngineArchive(sql,{source:changed,hash:changedHash})
 await next.register()
 assert.deepEqual(await computer.compute(args,await next.load(hash)),playOpenCupMatch(...args))
 await computer.compute(args,await next.load(changedHash))
 await computer.compute(args,await next.load(hash))
 console.log('PASS archived engine round-trip, one insert, worker source parity, old build resumed after deploy, bounded worker replacement')
 await assert.rejects(createCupEngineArchive(sql,{source,hash:'0'.repeat(64)}).register(),/mismatch/)
 await assert.rejects(verifyCupBundle({hash,compressed:gzipSync('wrong').toString('base64')}),/checksum/)
 await sql`update open_cup_engine_builds set compressed=${gzipSync('wrong').toString('base64')} where hash=${hash}`
 await assert.rejects(createCupEngineArchive(sql,{source,hash}).load(hash),/checksum/)
 console.log('PASS mismatched source hash and corrupt persisted bundle rejected')
} finally {computer.close();await db.close()}
