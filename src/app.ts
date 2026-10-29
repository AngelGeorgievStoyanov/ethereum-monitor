import express from 'express';
import httpRouter from './httpRouter';

const app = express();

app.use(express.json());
app.use('/api', httpRouter);

export default app;
