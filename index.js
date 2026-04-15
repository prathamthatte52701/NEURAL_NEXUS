import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import interviewRoutes from './routes/interviewRoutes.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const root = path.join(path.resolve()+"/dist")
app.use(express.static(root));
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '4mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: process.env.GEMINI_API_KEY ? 'gemini-ai' : 'heuristic',
    version: '2.0.0'
  });
});

app.use('/api/interview', interviewRoutes);

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.get("/{*splat}", (req, res)=>{
    res.sendFile("index.html", {root});
    
})

app.listen(PORT, () => {
  console.log(`\n🚀 NeuralDash Server v2.0 running at http://localhost:${PORT}`);
  console.log(`   AI Mode: ${process.env.GEMINI_API_KEY ? '✅ Gemini AI' : '⚡ Heuristic fallback'}\n`);
});
