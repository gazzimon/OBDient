// Senior agent datasource — the ADR-0009 senior conversation ONLY, routed through
// the OBDient senior proxy (obdient-seed/src/proxy). The app holds NO provider
// key: the proxy keeps it server-side, so nothing sensitive ships in the APK
// (audit C1). The UI knows exactly one name for this agent — "Assistente Sr" —
// never the model or provider (Beta V2 §1).
//
// Data contract: vehicle data may travel; the VIN and user identity never do
// (enforced upstream by DiagnosticBrief construction + redactText).

import { useSettingsStore } from '@/store/settingsStore';

// Build-time constant, inlined by Metro (Expo SDK 56) — must use static dot
// notation. A URL is NOT a secret, so EXPO_PUBLIC_ is correct here; a provider
// key must never be EXPO_PUBLIC_ (it would be extractable from the APK, audit C1).
// Empty when unset → the senior is treated as not configured.
const PROXY_URL = process.env.EXPO_PUBLIC_SENIOR_PROXY_URL ?? '';

type Lang = 'pt' | 'es' | 'en';

export class SeniorAgentDataSource {
  isConfigured(): boolean {
    return PROXY_URL.trim().length > 0;
  }

  // Senior conversation mode (ADR-0009 §3): sends the whole thread (first turn is
  // the deterministic brief) to the proxy, which adds the system prompt, the model
  // and the credential, then returns the next senior reply. The caller
  // (DiagnosticIntakeSessionUseCase) owns history and fallbacks.
  async converseSenior(
    history: readonly { role: 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    const base = PROXY_URL.trim().replace(/\/+$/, '');
    if (!base) {
      throw new Error('Senior proxy URL not configured (EXPO_PUBLIC_SENIOR_PROXY_URL).');
    }

    const response = await fetch(`${base}/v1/senior`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history.map((t) => ({ role: t.role, content: t.content })),
        language: this.currentLanguage(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Senior proxy error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as { answer?: unknown };
    if (typeof data.answer !== 'string' || data.answer.trim().length === 0) {
      throw new Error('Senior proxy returned an empty answer.');
    }
    return data.answer;
  }

  // Language hint for the proxy's system prompt. Reads the user-selected language
  // when the setting exists (Beta V2 §3 selector); the senior mirrors the owner's
  // language regardless, so an absent value is fine.
  private currentLanguage(): Lang | undefined {
    const lang = (useSettingsStore.getState() as { language?: unknown }).language;
    return lang === 'pt' || lang === 'es' || lang === 'en' ? lang : undefined;
  }
}

export const seniorProxy = new SeniorAgentDataSource();
