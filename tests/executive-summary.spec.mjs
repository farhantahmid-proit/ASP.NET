import { generateAiExecutiveSummary } from '../server/oss-engine/executive-summary.js';

describe('AI Executive Summary Server Generator', () => {
  it('returns an explicit 503 API_KEY_MISSING error rather than faking model output when GEMINI_API_KEY is unset', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      let caught = null;
      try {
        await generateAiExecutiveSummary({
          repoFullName: 'acme/web-portal',
          branch: 'main',
          runPhase: 'static',
          metrics: {
            performanceBefore: 60,
            performanceAfter: 92,
            accessibilityBefore: 70,
            accessibilityAfter: 95
          },
          commits: [
            {
              category: 'performance',
              categoryLabel: 'Performance',
              title: 'Preload hero image with fetchpriority="high"',
              summary: 'Reduces LCP by 420ms',
              ruleId: 'largest-contentful-paint'
            }
          ]
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught.statusCode).toBe(503);
      expect(caught.message).toContain('GEMINI_API_KEY');
    } finally {
      if (prevKey !== undefined) {
        process.env.GEMINI_API_KEY = prevKey;
      }
    }
  });
});
