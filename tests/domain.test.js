import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PortalStore } from '../server/domain.js';
const client = { id:'client-1', tenantId:'studio', clientId:'north', role:'client' };
const other = { ...client, id:'client-2', clientId:'south' };
const outsider = { ...client, tenantId:'elsewhere' };
const admin = { id:'agency', tenantId:'studio', role:'agency' };
function fixture(t) { const dir=mkdtempSync(join(tmpdir(),'portal-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); return { store:new PortalStore(join(dir,'db.json')), path:join(dir,'db.json') }; }
test('returns only own client projects, even with a guessed tenant', t=>{const {store}=fixture(t); assert.equal(store.projects(client).length,1); assert.equal(store.projects(outsider).length,0); assert.equal(store.projects(admin).length,2);});
test('rejects cross-client and cross-tenant writes without mutation', t=>{const {store}=fixture(t); const before=store.projects(client); assert.throws(()=>store.createTask(other,'website',{title:'Leak'}),{status:404}); assert.throws(()=>store.createTask(outsider,'website',{title:'Leak'}),{status:404}); assert.deepEqual(store.projects(client),before);});
test('validates bounded task input before mutation', t=>{const {store}=fixture(t); for(const title of ['', '  ', 42, 'x'.repeat(121)]) assert.throws(()=>store.createTask(client,'website',{title}),{status:400}); assert.equal(store.projects(client)[0].tasks.length,2);});
test('enforces task transitions and persists across restarts', t=>{const {store,path}=fixture(t); const task=store.createTask(client,'website',{title:'Review navigation'}); assert.equal(task.status,'todo'); assert.throws(()=>store.updateTask(client,task.id,{status:'done'}),{status:409}); assert.equal(store.updateTask(client,task.id,{status:'in_progress'}).status,'in_progress'); assert.equal(store.updateTask(client,task.id,{status:'done'}).status,'done'); assert.throws(()=>store.updateTask(client,task.id,{status:'todo'}),{status:409}); assert.equal(new PortalStore(path).projects(client)[0].tasks.at(-1).status,'done'); assert.doesNotMatch(readFileSync(path,'utf8'),/password/);});
test('agency can manage client projects within tenant; clients cannot create projects', t=>{const {store}=fixture(t); assert.equal(store.clients(admin).length,2); assert.equal(store.clients(client).length,1); assert.throws(()=>store.createProject(client,{clientId:'north',name:'New'}),{status:403}); assert.throws(()=>store.createProject(admin,{clientId:'absent',name:'New'}),{status:404}); assert.throws(()=>store.createProject(admin,{clientId:'north',name:''}),{status:400}); assert.equal(store.createProject(admin,{clientId:'north',name:'Campaign'}).name,'Campaign'); assert.equal(store.projects(client).length,2);});
test('missing task and invalid status return actionable errors', t=>{const {store}=fixture(t); assert.throws(()=>store.updateTask(client,'missing',{status:'done'}),{status:404}); assert.throws(()=>store.updateTask(client,'brief',{status:'oops'}),{status:400}); assert.throws(()=>store.updateTask(other,'brief',{status:'in_progress'}),{status:404});});
