// Claude API datasource — cloud fallback for general automotive questions.
// Only receives: vehicle make/model/year + user question. Never receives VIN or raw sensor data.

import { useSettingsStore } from '@/store/settingsStore';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const GENERAL_MODEL  = 'claude-haiku-4-5-20251001';
const EVAL_MODEL     = 'claude-haiku-4-5-20251001';

export interface EvaluationResult {
  score: number;        // 1–5
  isAcceptable: boolean; // score >= 3
  correction: string | null;
}

export class ClaudeAPIDataSource {
  isConfigured(): boolean {
    const runtimeKey = useSettingsStore.getState().claudeApiKey ?? '';
    const envKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
    return runtimeKey.trim().length > 0 || envKey.trim().length > 0;
  }

  // Answers a general automotive question using Claude.
  // vehicleContext = "Chevrolet Cruze 2024" — NO VIN, NO sensor data.
  async answerGeneral(vehicleContext: string, question: string): Promise<string> {
    const apiKey = this.getKey();

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify({
        model: GENERAL_MODEL,
        max_tokens: 300,
        system:
          'You are a concise automotive assistant. Answer in 2–3 sentences max. ' +
          'Be practical and specific. Respond in the same language as the user question.',
        messages: [
          { role: 'user', content: `Vehicle: ${vehicleContext}\n\n${question}` },
        ],
      }),
    });

    await this.assertOk(response);
    const data = (await response.json()) as { content: { text: string }[] };
    return data.content[0]?.text ?? '';
  }

  // Evaluates a CARpsy response for quality. Returns score 1–5 and an optional correction.
  // Fires in background — caller should not await the result for UX purposes.
  async evaluateResponse(
    vehicleContext: string,
    userQuestion: string,
    carpsynResponse: string,
  ): Promise<EvaluationResult> {
    const apiKey = this.getKey();

    const prompt =
      `You are auditing a response from CARpsy, a 0.6B on-device automotive AI.\n\n` +
      `Vehicle: ${vehicleContext}\n` +
      `User question: "${userQuestion}"\n` +
      `CARpsy response: "${carpsynResponse}"\n\n` +
      `Rate 1–5 (5=excellent, 3=acceptable, 1=wrong or dangerous).\n` +
      `If score < 3 provide a brief correction (2 sentences). Otherwise correction is null.\n` +
      `Reply ONLY with valid JSON: {"score": N, "correction": "..." | null}`;

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify({
        model: EVAL_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    await this.assertOk(response);
    const data = (await response.json()) as { content: { text: string }[] };
    const raw = data.content[0]?.text ?? '{"score":3,"correction":null}';

    try {
      const parsed = JSON.parse(raw) as { score: number; correction: string | null };
      return {
        score: parsed.score,
        isAcceptable: parsed.score >= 3,
        correction: parsed.correction ?? null,
      };
    } catch {
      return { score: 3, isAcceptable: true, correction: null };
    }
  }

  private getKey(): string {
    // Runtime key (Settings UI) takes priority over the build-time env var.
    const runtimeKey = useSettingsStore.getState().claudeApiKey ?? '';
    const envKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
    const key = runtimeKey.trim() || envKey.trim();
    if (!key) throw new Error('Claude API key not configured. Add it in Settings → Claude AI.');
    return key;
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private async assertOk(response: Response): Promise<void> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Claude API error ${response.status}: ${body}`);
    }
  }
}

export const claudeAPI = new ClaudeAPIDataSource();
