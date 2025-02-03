import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { PortalStore, PortalError } from './domain.js';
const users = [
  {id:'agency',email:'agency@demo.test',name:'Demo agency',tenantId:'studio',role:'agency'},
  {id:'north-user',email:'north@demo.test',name:'North client',tenantId:'studio',clientId:'north',role:'client'},
  {id:'south-user',email:'south@demo.test',name:'South client',tenantId:'studio',clientId:'south',role:'client'}
];
// Public fixture credential, deliberately shared by these demo accounts.
const passwordHash = scryptSync('demo-portal','portal-demo-fixture',32);
const cookieOptions={httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',path:'/api',maxAge:8*60*60*1000};
export function createApp({path=resolve('data/portal.json'),store=new PortalStore(path),clock=Date.now}={}) {
  const app=express(); const sessions=new Map();
  app.disable('x-powered-by');
  app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store'); next();});
  app.use('/api',(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)&&req.headers.origin){const allowed=new Set([`http://${req.headers.host}`,`https://${req.headers.host}`,process.env.DEV_ORIGIN||'http://127.0.0.1:5173']); if(!allowed.has(req.headers.origin)) return res.status(403).json({error:'Request origin is not allowed.'});} next();});
  app.use(express.json({limit:'8kb'}));
  app.get('/api/health',(_req,res)=>res.json({status:'ok',demo:true}));
  app.post('/api/login',(req,res)=>{
    const {email,password}=req.body||{};
    if(typeof email!=='string'||email.length>120||typeof password!=='string'||password.length>120) throw new PortalError(400,'Email and password are required (maximum 120 characters).');
    const user=users.find(u=>u.email===email.trim().toLowerCase());
    if(!user||!timingSafeEqual(passwordHash,scryptSync(password,'portal-demo-fixture',32))) throw new PortalError(401,'Invalid demo email or password.');
    for(const [token,session] of sessions) if(session.expires<=clock()) sessions.delete(token);
    if(sessions.size>=1000) throw new PortalError(503,'Demo session limit reached. Please try later.');
    const token=randomBytes(32).toString('hex'); sessions.set(token,{user,expires:clock()+cookieOptions.maxAge});
    res.cookie('portal_session',token,cookieOptions).json({user});
  });
  app.use('/api',(req,_res,next)=>{
    const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('portal_session='))?.slice('portal_session='.length);
    const session=sessions.get(token); if(!session||session.expires<=clock()){sessions.delete(token); return next(new PortalError(401,'Please sign in to the demo.'));} req.user=session.user; req.sessionToken=token; next();
  });
  app.get('/api/me',(req,res)=>res.json({user:req.user}));
  app.post('/api/logout',(req,res)=>{sessions.delete(req.sessionToken); res.clearCookie('portal_session',{...cookieOptions,maxAge:undefined}).sendStatus(204);});
  app.get('/api/clients',(req,res)=>res.json({clients:store.clients(req.user)}));
  app.get('/api/projects',(req,res)=>res.json({projects:store.projects(req.user)}));
  app.post('/api/projects',(req,res)=>res.status(201).json({project:store.createProject(req.user,req.body)}));
  app.post('/api/projects/:id/tasks',(req,res)=>res.status(201).json({task:store.createTask(req.user,req.params.id,req.body)}));
  app.patch('/api/tasks/:id',(req,res)=>res.json({task:store.updateTask(req.user,req.params.id,req.body)}));
  app.use('/api',(_req,_res,next)=>next(new PortalError(404,'API route not found.')));
  app.use(express.static(resolve('dist')));
  app.get('/',(_req,res)=>res.sendFile(resolve('dist/index.html')));
  app.use((err,_req,res,_next)=>{const status=err instanceof PortalError?err.status:err.type==='entity.too.large'?413:err.type==='entity.parse.failed'?400:500; res.status(status).json({error:status===500?'Unable to save or load demo data. Please retry.':err instanceof PortalError?err.message:status===413?'Request body exceeds 8 KB.':'Invalid JSON request.'});});
  return app;
}
