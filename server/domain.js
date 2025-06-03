import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export class PortalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const initialData = () => ({
  clients:[{id:'north',tenantId:'studio',name:'North Studio (fictional)'},{id:'south',tenantId:'studio',name:'South Workshop (fictional)'}],
  projects:[{id:'website',tenantId:'studio',clientId:'north',name:'Website refresh',description:'A fictional project for exploring collaborative delivery.'},{id:'campaign',tenantId:'studio',clientId:'south',name:'Launch campaign',description:'A separate fictional client workspace.'}],
  requests:[],
  tasks:[{id:'brief',projectId:'website',title:'Confirm the project brief',status:'todo'},{id:'design',projectId:'website',title:'Review homepage direction',status:'in_progress'}]
});
function text(value,label,max=120) { if(typeof value!=='string'||!value.trim()||value.length>max) throw new PortalError(400,`${label} must be 1–${max} characters.`); return value.trim(); }
const visible = (user,record) => record.tenantId===user.tenantId && (user.role==='agency'||record.clientId===user.clientId||record.id===user.clientId);
export class PortalStore {
  constructor(path) { this.path=path; this.data=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):initialData(); if(!existsSync(path)) this.persist(this.data); }
  persist(data) { mkdirSync(dirname(this.path),{recursive:true}); const temp=`${this.path}.${randomUUID()}.tmp`; writeFileSync(temp,JSON.stringify(data,null,2)); renameSync(temp,this.path); }
  mutate(operation) { const next=structuredClone(this.data); const result=operation(next); this.persist(next); this.data=next; return structuredClone(result); }
  project(user,id,data=this.data) { const project=data.projects.find(p=>p.id===id&&visible(user,p)); if(!project) throw new PortalError(404,'Project not found.'); return project; }
  clients(user) { return structuredClone(this.data.clients.filter(c=>visible(user,c))); }
  projects(user) { return structuredClone(this.data.projects.filter(p=>visible(user,p)).map(p=>({...p,tasks:this.data.tasks.filter(t=>t.projectId===p.id)}))); }
  request(data,user,scope,key,payload,operation) {
    if(key!==undefined && (typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(key))) throw new PortalError(400,'Idempotency-Key must contain 8–128 letters, digits, underscores or hyphens.');
    const previous=key&&data.requests?.find(r=>r.key===key&&r.userId===user.id&&r.scope===scope);
    if(previous) { if(previous.payload!==payload) throw new PortalError(409,'Request key was already used with different input.'); return previous.result; }
    const result=operation();
    if(key){data.requests ||= []; data.requests.push({key,userId:user.id,scope,payload,result}); data.requests=data.requests.slice(-1000);}
    return result;
  }
  createProject(user,input,key) { if(user.role!=='agency') throw new PortalError(403,'Only the agency demo account can create projects.'); const name=text(input?.name,'Project name'); const client=this.data.clients.find(c=>c.id===input?.clientId&&c.tenantId===user.tenantId); if(!client) throw new PortalError(404,'Client not found.'); return this.mutate(data=>this.request(data,user,'projects',key,JSON.stringify({name,clientId:client.id}),()=>{const project={id:randomUUID(),tenantId:user.tenantId,clientId:client.id,name,description:'Demo project',tasks:[]}; data.projects.push(project); return project;})); }
  createTask(user,projectId,input,key) { this.project(user,projectId); const title=text(input?.title,'Task title'); return this.mutate(data=>this.request(data,user,`tasks:${projectId}`,key,JSON.stringify({title}),()=>{ const task={id:randomUUID(),projectId,title,status:'todo'}; data.tasks.push(task); return task; })); }
  updateTask(user,id,input) { const task=this.data.tasks.find(t=>t.id===id); if(!task) throw new PortalError(404,'Task not found.'); this.project(user,task.projectId); const transitions={todo:['in_progress'],in_progress:['todo','done'],done:[]}; if(typeof input?.status!=='string'||!Object.hasOwn(transitions,input.status)) throw new PortalError(400,'Status must be todo, in_progress, or done.'); if(!transitions[task.status].includes(input.status)) throw new PortalError(409,`Cannot move ${task.status} to ${input.status}.`); return this.mutate(data=>{const next=data.tasks.find(t=>t.id===id); next.status=input.status; return next;}); }
}
