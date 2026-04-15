import express from 'express';
import multer from 'multer';
import {
  createSession, answerQuestion, endSession,
  getSession, listSessions
} from '../lib/sessionEngine.js';
import { questionBank } from '../lib/questionBank.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Sessions ────────────────────────────────────────────────────────────────────
router.get('/sessions', (_req, res) => res.json(listSessions()));

router.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// ── Question Bank ───────────────────────────────────────────────────────────────
router.get('/question-bank', (req, res) => {
  const { role } = req.query;
  const rows = role ? questionBank.filter(q => q.role === role) : questionBank;
  res.json({ count: rows.length, questions: rows });
});

// ── Start Interview ─────────────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { role, candidateName, interviewMode, difficulty, persona, resumeText, jdText, pressureMode } = req.body;
  if (!role || !candidateName) {
    return res.status(400).json({ error: 'role and candidateName are required' });
  }
  try {
    const result = await createSession({
      role, candidateName, interviewMode, difficulty, persona, resumeText, jdText, pressureMode
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[/start]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Submit Answer ───────────────────────────────────────────────────────────────
router.post('/answer', async (req, res) => {
  const { sessionId, answer, responseSeconds, presenceSnapshot } = req.body;
  if (!sessionId || !answer) {
    return res.status(400).json({ error: 'sessionId and answer are required' });
  }
  try {
    const result = await answerQuestion(sessionId, answer, { responseSeconds, presenceSnapshot });
    res.json(result);
  } catch (err) {
    console.error('[/answer]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── End Interview ───────────────────────────────────────────────────────────────
router.post('/end', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  try {
    const summary = await endSession(sessionId);
    res.json(summary);
  } catch (err) {
    console.error('[/end]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Resume Upload ───────────────────────────────────────────────────────────────
router.post('/upload-resume', upload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // For text files: read directly. For PDF: extract text (simplified).
  const buffer = req.file.buffer;
  const mimetype = req.file.mimetype;
  let text = '';

  if (mimetype === 'text/plain') {
    text = buffer.toString('utf-8');
  } else {
    // Basic PDF text extraction (look for readable strings)
    text = buffer.toString('latin1').replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 100) {
      text = 'Resume uploaded. AI will consider the document context.';
    }
  }

  res.json({ text: text.slice(0, 3000), length: text.length });
});

export default router;
