import { GoogleGenAI, Type } from '@google/genai';

const EXECUTIVE_SUMMARY_MODEL = 'gemini-4-hydrogen';

function isConfiguredApiKey(rawKey) {
  const trimmed = String(rawKey || '').trim();
  if (!trimmed) return false;
  if (trimmed === 'MY_GEMINI_API_KEY' || trimmed === 'YOUR_GEMINI_API_KEY') return false;
  return true;
}

function createGeminiClient() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!isConfiguredApiKey(apiKey)) {
    const err = new Error(
      'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to generate AI Executive Summaries.'
    );
    err.statusCode = 503;
    err.code = 'API_KEY_MISSING';
    throw err;
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

function sanitizeText(raw, maxLen = 280) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function clampScore(raw, fallback = 0) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeErrorStatus(err) {
  const msg = String(err?.message || '');
  const lower = msg.toLowerCase();
  const rawStatus = Number(err?.statusCode || err?.status || err?.code || 0);

  if (err?.code === 'API_KEY_MISSING') {
    return { statusCode: 503, message: msg };
  }
  if (
    rawStatus === 400 ||
    rawStatus === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('api key not valid')
  ) {
    return {
      statusCode: 403,
      message:
        'Gemini API rejected the configured credentials. Please verify GEMINI_API_KEY in Settings > Secrets.'
    };
  }
  if (
    rawStatus === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota')
  ) {
    return {
      statusCode: 429,
      message:
        'Gemini API quota or rate limit exceeded. Wait a moment and retry, or select a billing-enabled key in Settings > Secrets.'
    };
  }
  if (rawStatus === 404 || lower.includes('not_found')) {
    return {
      statusCode: 502,
      message: `Requested Gemini model (${EXECUTIVE_SUMMARY_MODEL}) was not found or is unavailable.`
    };
  }
  return {
    statusCode: rawStatus >= 400 && rawStatus < 600 ? rawStatus : 502,
    message: msg || 'Failed to generate AI Executive Summary.'
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a concise AI-powered Executive Summary highlighting the most impactful
 * improvements discovered in an audit session using the server-side @google/genai SDK.
 */
export async function generateAiExecutiveSummary(payload) {
  const ai = createGeminiClient();

  const repoFullName = sanitizeText(payload?.repoFullName || 'repository', 160);
  const branch = sanitizeText(payload?.branch || 'main', 80);
  const runPhase = payload?.runPhase === 'lhr' ? 'Lighthouse LHR JSON' : 'Static AST & Linter';

  const metrics = payload?.metrics || {};
  const perfBefore = clampScore(metrics.performanceBefore, 60);
  const perfAfter = clampScore(metrics.performanceAfter, 90);
  const a11yBefore = clampScore(metrics.accessibilityBefore, 68);
  const a11yAfter = clampScore(metrics.accessibilityAfter, 94);
  const bpBefore = clampScore(metrics.bestPracticesBefore, 74);
  const bpAfter = clampScore(metrics.bestPracticesAfter, 94);
  const seoBefore = clampScore(metrics.seoBefore, 76);
  const seoAfter = clampScore(metrics.seoAfter, 95);
  const secBefore = clampScore(metrics.securityBefore, 70);
  const secAfter = clampScore(metrics.securityAfter, 93);

  const rawCommits = Array.isArray(payload?.commits) ? payload.commits : [];
  const compactCommits = rawCommits.slice(0, 18).map((c) => ({
    category: sanitizeText(c?.categoryLabel || c?.category || 'Performance', 48),
    title: sanitizeText(c?.title || c?.commitMessage || '', 160),
    summary: sanitizeText(c?.summary || '', 200),
    ruleId: sanitizeText(c?.ruleId || '', 64)
  }));

  const promptPayload = {
    repository: repoFullName,
    branch,
    auditPhase: runPhase,
    totalFixes: rawCommits.length,
    scoreDeltas: {
      performance: `${perfBefore} -> ${perfAfter} (+${Math.max(0, perfAfter - perfBefore)})`,
      accessibility: `${a11yBefore} -> ${a11yAfter} (+${Math.max(0, a11yAfter - a11yBefore)})`,
      bestPractices: `${bpBefore} -> ${bpAfter} (+${Math.max(0, bpAfter - bpBefore)})`,
      seo: `${seoBefore} -> ${seoAfter} (+${Math.max(0, seoAfter - seoBefore)})`,
      security: `${secBefore} -> ${secAfter} (+${Math.max(0, secAfter - secBefore)})`
    },
    commits: compactCommits
  };

  const requestParams = {
    model: EXECUTIVE_SUMMARY_MODEL,
    contents: `Generate a concise Executive Summary for this web quality audit report:\n${JSON.stringify(
      promptPayload
    )}`,
    config: {
      systemInstruction:
        'You are a principal web performance and accessibility engineering advisor. Write a crisp, factual Executive Summary for engineering leads and product stakeholders. Keep the headline under 16 words, keep the summary to 2-3 concise sentences highlighting quantified score gains and root-cause fixes, list the top 3-4 most impactful improvements grounded strictly in the provided commits and metrics, and finish with one concrete next step.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: {
            type: Type.STRING,
            description: 'Concise one-sentence executive headline summarizing the audit outcome.'
          },
          summary: {
            type: Type.STRING,
            description: 'Two to three concise sentences describing the highest-impact improvements.'
          },
          topImprovements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: {
                  type: Type.STRING,
                  description: 'Category name such as Performance, Accessibility, Security, SEO, or Best Practices.'
                },
                title: {
                  type: Type.STRING,
                  description: 'Concise improvement title grounded in the audit commits.'
                },
                impact: {
                  type: Type.STRING,
                  description: 'Short explanation of user-facing or engineering impact.'
                }
              },
              required: ['category', 'title', 'impact']
            }
          },
          recommendedNextStep: {
            type: Type.STRING,
            description: 'Single concrete recommended next step.'
          }
        },
        required: ['headline', 'summary', 'topImprovements', 'recommendedNextStep']
      }
    }
  };

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent(requestParams);
      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('Gemini returned an empty Executive Summary response.');
      }
      const parsed = JSON.parse(rawText);
      const topImprovements = Array.isArray(parsed.topImprovements)
        ? parsed.topImprovements
            .slice(0, 4)
            .map((item) => ({
              category: sanitizeText(item?.category || 'Quality', 48),
              title: sanitizeText(item?.title || '', 160),
              impact: sanitizeText(item?.impact || '', 220)
            }))
            .filter((item) => item.title.length > 0)
        : [];

      return {
        headline: sanitizeText(parsed.headline || `${repoFullName} Audit Executive Summary`, 200),
        summary: sanitizeText(parsed.summary || '', 650),
        topImprovements,
        recommendedNextStep: sanitizeText(
          parsed.recommendedNextStep ||
            'Review the selected atomic remediation commits and export a Git patch or Pull Request.',
          260
        ),
        model: EXECUTIVE_SUMMARY_MODEL,
        generatedAtIso: new Date().toISOString()
      };
    } catch (err) {
      lastError = err;
      const mapped = normalizeErrorStatus(err);
      const isTransient = mapped.statusCode === 429 || mapped.statusCode >= 500;
      if (!isTransient || attempt === 2) {
        const finalErr = new Error(mapped.message);
        finalErr.statusCode = mapped.statusCode;
        throw finalErr;
      }
      await sleep(350 * (attempt + 1));
    }
  }

  const mapped = normalizeErrorStatus(lastError);
  const fallbackErr = new Error(mapped.message);
  fallbackErr.statusCode = mapped.statusCode;
  throw fallbackErr;
}
