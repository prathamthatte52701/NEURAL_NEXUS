import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

export function hasAI() {
  return !!ai;
}

// ─── Dynamic Question Generation ──────────────────────────────────────────────
export async function generateDynamicQuestion({ role, difficulty, resumeText, jdText, askedQuestions = [], persona }) {
  if (!ai) return null;

  const context = [];
  if (resumeText) context.push(`Candidate resume:\n${resumeText.slice(0, 800)}`);
  if (jdText) context.push(`Job description:\n${jdText.slice(0, 600)}`);
  const askedList = askedQuestions.slice(-5).join(' | ');

  const prompt = `You are a ${persona} conducting a ${difficulty} ${role} interview.
${context.join('\n')}
Previously asked questions: ${askedList || 'None yet'}

Generate ONE unique interview question that:
- Is appropriate for ${difficulty} difficulty
- Is relevant to the ${role} role
- Has NOT been asked before
- Feels natural and conversational
- If resume/JD is provided, makes it personalized

Return ONLY the question text, nothing else. No quotes, no numbering.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.85 }
    });
    return (response.text || '').trim();
  } catch (err) {
    console.error('[AI] generateDynamicQuestion failed:', err.message);
    return null;
  }
}

// ─── Answer Analysis ───────────────────────────────────────────────────────────
export async function generateAnalysisWithAI({ answer, question, role, rubric, presenceSnapshot }) {
  if (!ai) return null;

  const presenceContext = presenceSnapshot
    ? `Non-verbal presence data: Eye contact ${presenceSnapshot.eyeContact}%, Posture ${presenceSnapshot.posture}%, Attention ${presenceSnapshot.attention}%.`
    : '';

  const systemInstruction = `You are an expert ${role} interviewer and communication coach.
Analyze the candidate's answer thoroughly and return a JSON object.

${presenceContext}

Return ONLY valid JSON with this exact schema:
{
  "metrics": {
    "relevance": <0-10>,
    "clarity": <0-10>,
    "structure": <0-10>,
    "specificity": <0-10>,
    "confidence": <0-10>,
    "delivery": <0-10>,
    "roleFit": <0-10>,
    "overall": <0-10>
  },
  "confidenceScore": <0-100>,
  "toneScore": <0-100>,
  "eyeContactScore": <0-100>,
  "evidence": ["<specific observation about their answer>"],
  "strengths": ["<strength observed>"],
  "weaknesses": ["<weakness to improve>"],
  "improvements": ["<actionable improvement tip>"],
  "idealAnswer": "<A model 2-3 sentence answer that would score 9-10>",
  "rewrite": "<A stronger version of their specific answer>"
}`;

  const prompt = `Question: "${question}"
Candidate Answer: "${answer}"
Expected points: ${JSON.stringify(rubric?.expectedPoints || [])}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    });

    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(clean);

    return {
      fillerCount: countFillers(answer),
      wordCount: (answer || '').split(/\s+/).filter(Boolean).length,
      coveredPoints: [],
      missingPoints: [],
      ...result
    };
  } catch (err) {
    console.error('[AI] generateAnalysisWithAI failed:', err.message);
    return null;
  }
}

// ─── Follow-up Generation ──────────────────────────────────────────────────────
export async function generateFollowUpWithAI({ answer, analysis, persona, previousQuestion }) {
  if (!ai) return null;

  const prompt = `You are a ${persona} interviewer.
The candidate just answered: "${previousQuestion}"
Their answer: "${answer}"
Weaknesses noted: ${(analysis?.weaknesses || []).join(', ')}

Generate ONE short, natural follow-up question (1-2 sentences max) to probe deeper or clarify a weakness. 
Return ONLY the follow-up question. No quotes, no preamble.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.75 }
    });
    return (response.text || '').trim();
  } catch (err) {
    console.error('[AI] generateFollowUpWithAI failed:', err.message);
    return null;
  }
}

// ─── Session Summary ───────────────────────────────────────────────────────────
export async function generateSessionSummaryWithAI({ transcript, role, candidateName }) {
  if (!ai) return null;

  const qa = transcript.slice(0, 8).map((t, i) =>
    `Q${i + 1}: ${t.question}\nA: ${t.answer?.slice(0, 200)}`
  ).join('\n\n');

  const prompt = `You reviewed a ${role} interview for ${candidateName}. Here are their Q&A pairs:\n${qa}\n\nProvide a holistic coaching assessment. Return ONLY JSON:
{
  "overallVerdict": "<2 sentence overall assessment>",
  "hiringRecommendation": "<Strong Hire | Hire | Borderline | No Hire>",
  "topStrengths": ["<strength>", "<strength>", "<strength>"],
  "criticalGaps": ["<gap>", "<gap>"],
  "coachingPlan": ["<actionable step>", "<actionable step>", "<actionable step>"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.4 }
    });
    const text = response.text || '{}';
    return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
  } catch (err) {
    console.error('[AI] generateSessionSummaryWithAI failed:', err.message);
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const FILLERS = ['um', 'uh', 'like', 'basically', 'actually', 'you know', 'sort of', 'kind of'];
function countFillers(text) {
  const lower = (text || '').toLowerCase();
  return FILLERS.reduce((count, word) => {
    const regex = new RegExp(`\\b${word.replace(/\s/g, '\\s+')}\\b`, 'gi');
    return count + (lower.match(regex) || []).length;
  }, 0);
}
