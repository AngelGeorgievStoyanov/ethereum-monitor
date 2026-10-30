import express from 'express';
import path from 'node:path';
import httpRouter from './httpRouter';

const app = express();

app.use(express.json());
app.use('/api', httpRouter);
app.get('/dashboard', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'public/dashboard.html'));
});

export default app;
