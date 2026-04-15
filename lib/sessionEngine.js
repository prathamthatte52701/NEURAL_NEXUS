import { nanoid } from 'nanoid';
import { questionBank, personaProfiles } from './questionBank.js';
import { analyzeAnswer, summarizeSession } from './scoring.js';
import { readDb, writeDb } from './fileDb.js';
import {
  hasAI,
  generateAnalysisWithAI,
  generateFollowUpWithAI,
  generateDynamicQuestion,
  generateSessionSummaryWithAI
} from './aiProvider.js';

// ─── Question Picker ───────────────────────────────────────────────────────────
function scoreQuestion(q, session) {
  const profileText = `${session.resumeText || ''} ${session.jdText || ''}`.toLowerCase();
  const keywordScore = (q.keywords || []).reduce((s, kw) => s + (profileText.includes(kw) ? 2 : 0), 0);
  const diffBoost = session.difficulty === q.difficulty ? 2 : 0;
  const modeBoost = session.interviewMode?.toLowerCase().includes(q.category) ? 1.5 : 0;
  return keywordScore + diffBoost + modeBoost;
}

function pickBankQuestion(session) {
  const role = session.role;
  const candidates = questionBank
    .filter(q => q.role === role && !session.askedQuestions.includes(q.question))
    .sort((a, b) => scoreQuestion(b, session) - scoreQuestion(a, session));
  return candidates[0] || questionBank.find(q => q.role === role) || questionBank[0];
}

async function getNextQuestion(session) {
  // Try AI dynamic question first
  if (hasAI() && session.transcript.length < 10) {
    const aiQuestion = await generateDynamicQuestion({
      role: session.role,
      difficulty: session.difficulty,
      resumeText: session.resumeText,
      jdText: session.jdText,
      askedQuestions: session.askedQuestions,
      persona: session.persona
    });
    if (aiQuestion) {
      return { question: aiQuestion, meta: null };
    }
  }
  // Fallback to bank
  const q = pickBankQuestion(session);
  return { question: q.question, meta: q };
}

// ─── Create Session ────────────────────────────────────────────────────────────
export async function createSession(payload) {
  const db = readDb();
  const personaMeta = personaProfiles[payload.persona] || personaProfiles['calm-senior-interviewer'];

  const session = {
    id: nanoid(10),
    createdAt: new Date().toISOString(),
    role: payload.role,
    candidateName: payload.candidateName,
    interviewMode: payload.interviewMode || 'mixed',
    difficulty: payload.difficulty || 'medium',
    persona: payload.persona || 'calm-senior-interviewer',
    pressureMode: payload.pressureMode || 'balanced',
    resumeText: payload.resumeText || '',
    jdText: payload.jdText || '',
    askedQuestions: [],
    currentQuestion: null,
    currentMeta: null,
    transcript: [],
    pressureScore: payload.pressureMode === 'high-pressure' ? 72 : 48,
    interviewer: personaMeta,
    endedAt: null,
    summary: null
  };

  const { question, meta } = await getNextQuestion(session);
  session.currentQuestion = question;
  session.currentMeta = meta;
  session.askedQuestions.push(question);

  db.sessions.unshift(session);
  writeDb(db);

  return {
    session,
    firstQuestion: question,
    interviewerIntro: `${personaMeta.intro} Here is your first question: ${question}`
  };
}

// ─── Get Session ───────────────────────────────────────────────────────────────
export function getSession(sessionId) {
  const db = readDb();
  return db.sessions.find(s => s.id === sessionId) || null;
}

// ─── Submit Answer ─────────────────────────────────────────────────────────────
export async function answerQuestion(sessionId, answer, meta = {}) {
  const db = readDb();
  const session = db.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error('Session not found');

  const questionText = session.currentQuestion;
  const rubric = session.currentMeta;
  const presenceSnapshot = meta.presenceSnapshot || null;

  // Analyze answer
  let analysis;
  if (hasAI()) {
    const aiResult = await generateAnalysisWithAI({
      answer,
      question: questionText,
      role: session.role,
      rubric,
      presenceSnapshot
    });
    if (aiResult) {
      analysis = { ...aiResult, responseSeconds: meta.responseSeconds || 0 };
      // Override eyeContact from real presence data if available
      if (presenceSnapshot?.eyeContact) {
        analysis.eyeContactScore = presenceSnapshot.eyeContact;
      }
    }
  }

  if (!analysis) {
    analysis = analyzeAnswer({
      answer,
      question: questionText,
      role: session.role,
      transcriptSoFar: session.transcript,
      rubric,
      pressureScore: session.pressureScore,
      responseSeconds: meta.responseSeconds || 0
    });
    if (presenceSnapshot?.eyeContact) {
      analysis.eyeContactScore = presenceSnapshot.eyeContact;
    }
  }

  // Follow-up
  let followUp = null;
  if (hasAI()) {
    followUp = await generateFollowUpWithAI({
      answer, analysis, persona: session.persona, previousQuestion: questionText
    });
  }
  if (!followUp) {
    followUp = analysis.missingPoints?.[0]
      ? `Can you elaborate on: ${analysis.missingPoints[0]}?`
      : 'What would you do differently if you faced this again?';
  }

  // Record transcript entry
  session.transcript.push({
    question: questionText,
    questionMeta: rubric,
    answer,
    createdAt: new Date().toISOString(),
    analysis,
    followUp,
    responseSeconds: meta.responseSeconds || 0,
    presenceSnapshot,
    pressureScoreBefore: session.pressureScore
  });

  // Update pressure score
  const delta = ((analysis.metrics?.overall || 5) < 6.2 ? 7 : -3)
    + ((analysis.fillerCount || 0) >= 3 ? 4 : 0)
    + (session.pressureMode === 'high-pressure' ? 5 : 0);
  session.pressureScore = Math.max(20, Math.min(95, (session.pressureScore || 50) + delta));

  // Get next question
  const { question: nextQ, meta: nextMeta } = await getNextQuestion(session);
  session.currentQuestion = nextQ;
  session.currentMeta = nextMeta;
  if (nextQ) session.askedQuestions.push(nextQ);

  writeDb(db);

  const mood = session.pressureScore >= 75 ? 'skeptical'
    : (analysis.metrics?.overall || 0) >= 7.3 ? 'impressed'
    : 'neutral';

  return {
    analysis,
    followUp,
    nextQuestion: nextQ || null,
    pressureScore: session.pressureScore,
    interviewerMood: mood
  };
}

// ─── End Session ───────────────────────────────────────────────────────────────
export async function endSession(sessionId) {
  const db = readDb();
  const session = db.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error('Session not found');

  session.endedAt = new Date().toISOString();
  const baseSummary = summarizeSession(session);

  // Enhance with AI narrative if available
  let aiNarrative = null;
  if (hasAI() && session.transcript.length > 0) {
    aiNarrative = await generateSessionSummaryWithAI({
      transcript: session.transcript,
      role: session.role,
      candidateName: session.candidateName
    });
  }

  session.summary = { ...baseSummary, ...(aiNarrative || {}) };
  writeDb(db);
  return session.summary;
}

// ─── List Sessions ─────────────────────────────────────────────────────────────
export function listSessions() {
  const db = readDb();
  return db.sessions.map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    endedAt: s.endedAt,
    role: s.role,
    candidateName: s.candidateName,
    difficulty: s.difficulty,
    summary: s.summary
  }));
}
