// ─── Heuristic Answer Scorer ──────────────────────────────────────────────────
const FILLER_WORDS = ['um', 'uh', 'like', 'basically', 'actually', 'you know', 'sort of', 'kind of'];

const STAR_SIGNALS = {
  situation: ['situation', 'context', 'background', 'at that time', 'when i was', 'we were'],
  task: ['task', 'goal', 'objective', 'responsible', 'i needed to', 'my role was'],
  action: ['i did', 'i decided', 'i worked', 'i built', 'i led', 'i analyzed', 'i created', 'i implemented', 'i proposed'],
  result: ['result', 'outcome', 'impact', 'improved', 'reduced', 'increased', 'learned', 'achieved', 'saved']
};

function clamp(value, min = 0, max = 10) {
  return Math.max(min, Math.min(max, value));
}

function countMatches(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter(term => lower.includes(term.toLowerCase())).length;
}

function detectStarCoverage(text) {
  return Object.fromEntries(
    Object.entries(STAR_SIGNALS).map(([key, values]) => [
      key,
      values.some(v => text.toLowerCase().includes(v))
    ])
  );
}

function countFillers(text) {
  const lower = (text || '').toLowerCase();
  return FILLER_WORDS.reduce((count, word) => {
    const regex = new RegExp(`\\b${word.replace(/\s/g, '\\s+')}\\b`, 'gi');
    return count + (lower.match(regex) || []).length;
  }, 0);
}

export function analyzeAnswer({ answer, question, role, transcriptSoFar = [], rubric = null, pressureScore = 50, responseSeconds = 0 }) {
  const text = (answer || '').trim();
  const lower = text.toLowerCase();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const sentenceCount = text ? text.split(/[.!?]+/).filter(Boolean).length : 0;
  const fillerCount = countFillers(text);

  const expectedPoints = rubric?.expectedPoints || [];
  const pointCoverage = expectedPoints.map(point => ({
    point,
    covered: point.split(/\s+/).some(token => token.length > 3 && lower.includes(token.toLowerCase()))
  }));
  const coveredPoints = pointCoverage.filter(i => i.covered).map(i => i.point);
  const missingPoints = pointCoverage.filter(i => !i.covered).map(i => i.point);

  const keywordHits = countMatches(lower, rubric?.keywords || []);
  const hasNumbers = /\b\d+(%|x|users|days|weeks|months|years|ms|seconds|hours|k|\$)?\b/i.test(text);
  const hasStructure = /(first|second|third|finally|because|therefore|so then|after that|before that|as a result)/i.test(text);
  const starCoverage = detectStarCoverage(lower);
  const starCount = Object.values(starCoverage).filter(Boolean).length;
  const repeatedOpening = transcriptSoFar.some(entry => entry.answer && entry.answer.slice(0, 40) === text.slice(0, 40));

  const relevance  = clamp(3.5 + coveredPoints.length * 1.2 + keywordHits * 0.6);
  const clarity    = clamp(4 + (sentenceCount >= 3 ? 1.4 : 0) + (hasStructure ? 1.4 : 0) - fillerCount * 0.25);
  const structure  = clamp(3 + starCount * 1.2 + (wordCount > 70 ? 1 : 0) + (hasStructure ? 1.2 : 0));
  const specificity = clamp(3 + (hasNumbers ? 2.2 : 0) + Math.min(keywordHits, 3) * 0.7 + (wordCount > 90 ? 1 : 0));
  const confidence = clamp(5 + (hasNumbers ? 1 : 0) - fillerCount * 0.35 - (wordCount < 35 ? 1.5 : 0));
  const roleFit    = clamp(4 + keywordHits * 0.9 + coveredPoints.length * 0.5);
  const delivery   = clamp(5 + (responseSeconds > 25 ? 0.8 : 0) - fillerCount * 0.2 - (pressureScore > 72 ? 0.4 : 0));
  const overall    = clamp((relevance + clarity + structure + specificity + confidence + roleFit + delivery) / 7);

  // Presence-linked scores (heuristic estimates)
  const confidenceScore = Math.round(clamp((confidence * 10 - (fillerCount * 3)), 0, 100) * 1);
  const toneScore = Math.round(clamp((clarity * 9 + (hasNumbers ? 8 : 0)), 0, 100));
  const eyeContactScore = Math.round(Math.random() * 20 + 65); // simulated, overridden by real presence

  const evidence = [];
  if (coveredPoints.length) evidence.push(`Covered ${coveredPoints.length}/${expectedPoints.length || 1} expected answer points.`);
  if (hasNumbers) evidence.push('Included measurable metrics or numeric evidence.');
  if (starCount >= 3) evidence.push('Answer followed a STAR-like structure effectively.');
  if (keywordHits >= 2) evidence.push(`Used ${keywordHits} role-relevant keywords for ${role.replaceAll('-', ' ')}.`);
  if (fillerCount > 0) evidence.push(`Detected ${fillerCount} filler word${fillerCount > 1 ? 's' : ''}.`);
  if (repeatedOpening) evidence.push('Opening sounded repetitive compared to a previous answer.');
  if (responseSeconds) evidence.push(`Response captured at ~${responseSeconds} seconds.`);

  const strengths = [];
  if (relevance >= 7.2) strengths.push('Answer stayed tightly relevant to the question.');
  if (structure >= 7)   strengths.push('Response had clear structure with good flow.');
  if (specificity >= 7) strengths.push('Specific examples made the answer convincing.');
  if (confidence >= 7)  strengths.push('Delivery sounded confident and assured.');
  if (roleFit >= 7)     strengths.push('Answer reflected strong domain expertise.');
  if (coveredPoints.length >= Math.ceil(expectedPoints.length * 0.6)) {
    strengths.push("Addressed most of the interviewer's expected answer points.");
  }

  const weaknesses = [];
  if (wordCount < 45) weaknesses.push('Answer too brief — longer responses build interviewer confidence.');
  if (missingPoints.length >= 2) weaknesses.push('Several expected points were not addressed.');
  if (specificity < 6) weaknesses.push('Add concrete actions, tools, or numbers to strengthen credibility.');
  if (structure < 6)   weaknesses.push('Structure needs clearer beginning, middle, and conclusion.');
  if (fillerCount >= 3) weaknesses.push('Excessive filler words reduced delivery polish.');
  if (pressureScore > 75 && confidence < 6.5) weaknesses.push('Pressure appears to be affecting answer quality.');

  const improvements = [
    'Open with a one-line context, then state your exact role in the situation.',
    'Add one measurable result, even if approximate.',
    'Structure with STAR: Situation → Task → Action → Result.',
    'End with a clear lesson, decision insight, or next step.'
  ];
  if (missingPoints[0]) improvements.unshift(`Cover this missing point next time: "${missingPoints[0]}".`);

  const idealAnswer = `A model answer would: clearly set context in 1-2 sentences, state your specific responsibility, describe 2-3 concrete actions you took (with tools/metrics if applicable), and close with a quantifiable outcome and reflection. Example: "When ${missingPoints[0] || 'facing this challenge'}, I was responsible for [specific task]. I [specific action with tool/metric]. As a result, [measurable outcome], and I learned [key insight]."`;

  const rewrite = `A stronger version: "In [specific context], my role was to [concrete ownership]. I [specific action — tool, method, decision]. This led to [quantifiable outcome]. The key insight I took away was [lesson]."`;

  return {
    metrics: {
      relevance: +relevance.toFixed(1),
      clarity: +clarity.toFixed(1),
      structure: +structure.toFixed(1),
      specificity: +specificity.toFixed(1),
      confidence: +confidence.toFixed(1),
      delivery: +delivery.toFixed(1),
      roleFit: +roleFit.toFixed(1),
      overall: +overall.toFixed(1)
    },
    confidenceScore,
    toneScore,
    eyeContactScore,
    evidence,
    strengths,
    weaknesses,
    improvements,
    fillerCount,
    wordCount,
    coveredPoints,
    missingPoints,
    starCoverage,
    responseSeconds,
    idealAnswer,
    rewrite
  };
}

// ─── Session Summary ───────────────────────────────────────────────────────────
export function summarizeSession(session) {
  const entries = session.transcript || [];
  const total = entries.length || 1;

  const metricTotals = entries.reduce((acc, entry) => {
    const m = entry.analysis?.metrics || {};
    Object.keys(m).forEach(k => { acc[k] = (acc[k] || 0) + m[k]; });
    return acc;
  }, {});

  const averageMetrics = Object.fromEntries(
    Object.entries(metricTotals).map(([k, v]) => [k, +(v / total).toFixed(1)])
  );

  const avg = (key) => +(entries.reduce((s, e) => s + (e.analysis?.[key] || 0), 0) / total).toFixed(0);

  const allStrengths  = entries.flatMap(e => e.analysis?.strengths || []);
  const allWeaknesses = entries.flatMap(e => e.analysis?.weaknesses || []);
  const allMissing    = entries.flatMap(e => e.analysis?.missingPoints || []);

  const topItems = (items, limit = 4) => {
    const freq = new Map();
    items.forEach(item => freq.set(item, (freq.get(item) || 0) + 1));
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([item]) => item);
  };

  const overall = averageMetrics.overall || 0;
  const hiringRec = overall >= 8 ? 'Strong Hire' : overall >= 6.5 ? 'Hire' : overall >= 5.5 ? 'Borderline' : 'No Hire';

  return {
    averageMetrics,
    confidenceScore: avg('confidenceScore'),
    toneScore: avg('toneScore'),
    eyeContactScore: avg('eyeContactScore'),
    strengths: topItems(allStrengths),
    weaknesses: topItems(allWeaknesses),
    missingThemes: topItems(allMissing),
    hiringRecommendation: hiringRec,
    recommendation: overall >= 7.5
      ? 'Strong performance. Polish evidence quality and closing statements.'
      : 'Focus on structured answers, stronger evidence, and reducing filler words.',
    questionsAnswered: entries.length,
    totalDuration: Math.round((new Date(session.endedAt) - new Date(session.createdAt)) / 60000)
  };
}
