import express from 'express';
const app = express();
app.get('/api/health', (_req, res) => res.json({status:'ok', demo:true}));
app.listen(3001, '127.0.0.1', () => console.log('Demo API: http://127.0.0.1:3001'));
