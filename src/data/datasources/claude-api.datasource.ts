// Claude API datasource — the ADR-0009 senior conversation ONLY.
// Claude is opt-in: the app calls this exclusively after the user requests the
// senior review (DiagnosticIntakeSessionUseCase.requestSenior). The previous
// answerGeneral (general chit-chat) and evaluateResponse (per-turn background
// quality audit) paths were removed — they burned tokens invisibly.
// Data contract: vehicle data may travel; the VIN and user identity never do
// (enforced upstream by DiagnosticBrief construction + redactText).

import { useSettingsStore } from '@/store/settingsStore';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
// Senior diagnostician (ADR-0009): one well-fed call per case, so it earns a
// stronger model than a chat-with-anything path would.
const SENIOR_MODEL = 'claude-sonnet-5';

const SENIOR_SYSTEM =
  'You are a senior automotive diagnostic technician. A local intake agent hands ' +
  'you structured cases collected from real vehicles over OBD-II; you conduct the ' +
  'diagnosis with the owner from there until the case is resolved. Be concrete and ' +
  'practical, order checks cheapest-first, and reply in the language the owner ' +
  'writes in. Never ask for the VIN, license plate, or any personal data.';

// A message content block with an optional prompt-cache breakpoint.
type TextBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

export class ClaudeAPIDataSource {
  isConfigured(): boolean {
    // Only the runtime key counts: the app ships with NO embedded key (audit C1).
    return (useSettingsStore.getState().claudeApiKey ?? '').trim().length > 0;
  }

  // Senior conversation mode (ADR-0009 §3): receives the whole thread — first
  // turn is the deterministic brief — and returns the next senior reply.
  // The caller (DiagnosticIntakeSessionUseCase) owns history and fallbacks.
  //
  // Prompt caching: the system prompt gets a breakpoint, and the LAST message
  // of each request gets one too, so every follow-up turn re-reads the whole
  // prior conversation from cache (~0.1x input price) instead of re-paying it.
  async converseSenior(
    history: readonly { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const apiKey = this.getKey();

    const messages = history.map((t, i) => ({
      role: t.role,
      content: [
        {
          type: 'text',
          text: t.content,
          ...(i === history.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
        } satisfies TextBlock,
      ],
    }));

    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify({
        model: SENIOR_MODEL,
        max_tokens: 1500,
        system: [
          {
            type: 'text',
            text: SENIOR_SYSTEM,
            cache_control: { type: 'ephemeral' },
          } satisfies TextBlock,
        ],
        messages,
      }),
    });

    await this.assertOk(response);
    const data = (await response.json()) as { content: { text: string }[] };
    const text = data.content[0]?.text ?? '';
    if (!text) throw new Error('Claude senior returned an empty response');
    return text;
  }

  private getKey(): string {
    // User-supplied at runtime (Settings → Claude AI) and stored only on-device.
    // There is deliberately NO EXPO_PUBLIC_* fallback: an env key would be inlined
    // by Metro into the public JS bundle and extractable from the APK (audit C1).
    const key = (useSettingsStore.getState().claudeApiKey ?? '').trim();
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
