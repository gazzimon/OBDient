// QVAC on-device LLM datasource.
// Runs the model directly on the device — no internet, no external server.
//
// Lifecycle:
//   1. Call initialize() once at app start to download & load the model into RAM.
//   2. Call interpret() for each diagnostic session.
//   3. Call dispose() when the app goes to background to free RAM (optional).
//
// The model is kept in memory between calls for fast response times.
// The 4-bit ~1B model needs roughly 1 GB of RAM — safe to keep loaded.

import {
  loadModel,
  completion,
  unloadModel,
  LLAMA_3_2_1B_INST_Q4_0,
} from '@qvac/sdk';
import {
  QvacUnavailableError,
  QvacRequestError,
} from '@/core/errors/obd.errors';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface QvacInterpretationResult {
  text: string;
  generatedAt: Date;
}

// Default on-device model — Llama 3.2 1B (4-bit), small enough for low-RAM phones.
// To use a larger/different on-device model, swap this for another SDK model
// constant (e.g. QWEN3_600M_INST_Q4) or pass a GGUF modelSrc (local path,
// https URL, or pear:// hyperdrive key for P2P distribution).
const DEFAULT_MODEL = LLAMA_3_2_1B_INST_Q4_0;

const SYSTEM_PROMPT = `You are OBDient, an expert automotive diagnostic assistant.
You receive real-time OBD-II vehicle data and fault codes.
When a "Relevant diagnostic knowledge" section is provided, use it to ground your
explanation and recommended actions; prefer it over your own assumptions.
Always respond in English, clearly and concisely.
If there are active DTC codes, explain what they mean and what to do.
If parameters are normal, say so briefly.
Prioritize safety: if something is urgent, indicate it clearly.
Maximum 3 sentences. No unnecessary technical jargon.`;

export class QvacSDKDataSource {
  private modelId: string | null = null;
  private loadingPromise: Promise<void> | null = null;
  private loadProgress = 0;

  // Download and load the model into memory.
  // Safe to call multiple times — only loads once.
  async initialize(
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    if (this.modelId !== null) return;
    if (this.loadingPromise !== null) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        this.modelId = await loadModel({ modelSrc: DEFAULT_MODEL });
        this.loadProgress = 1;
        onProgress?.(1);
      } catch (err) {
        this.loadingPromise = null;
        throw new QvacUnavailableError(
          'Failed to load QVAC model on device',
          err,
        );
      }
    })();

    return this.loadingPromise;
  }

  isLoaded(): boolean {
    return this.modelId !== null;
  }

  getLoadProgress(): number {
    return this.loadProgress;
  }

  // Free RAM — call when the app goes to background or the user navigates away.
  async dispose(): Promise<void> {
    if (this.modelId === null) return;
    try {
      await unloadModel({ modelId: this.modelId });
    } finally {
      this.modelId = null;
      this.loadingPromise = null;
      this.loadProgress = 0;
    }
  }

  // Multi-turn chat: receives the full conversation history and returns the next reply.
  // `systemContext` is injected once as the first user turn so QVAC has vehicle + DTC context.
  async chat(
    systemContext: string,
    history: readonly { role: 'user' | 'assistant'; content: string }[],
  ): Promise<QvacInterpretationResult> {
    if (this.modelId === null) {
      throw new QvacUnavailableError('QVAC model is not loaded. Call initialize() first.');
    }

    const llmHistory = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const,   content: systemContext },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let text = '';
    try {
      const result = completion({ modelId: this.modelId, history: llmHistory, stream: true });
      for await (const token of result.tokenStream) {
        text += token;
      }
    } catch (err) {
      throw new QvacRequestError(0, `On-device inference failed: ${String(err)}`);
    }

    const trimmed = text.trim();
    if (!trimmed) throw new QvacRequestError(0, 'QVAC returned empty response');
    return { text: trimmed, generatedAt: new Date() };
  }

  async interpret(
    parameters: ObdParameterSnapshot,
    troubleCodes: readonly TroubleCode[],
    vehicleContext?: string,
    knowledgeContext?: readonly string[],
  ): Promise<QvacInterpretationResult> {
    if (this.modelId === null) {
      throw new QvacUnavailableError(
        'QVAC model is not loaded. Call initialize() first.',
      );
    }

    const userMessage = this.buildUserMessage(
      parameters,
      troubleCodes,
      vehicleContext,
      knowledgeContext,
    );

    const history = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const,   content: userMessage },
    ];

    let text = '';
    try {
      const result = completion({ modelId: this.modelId, history, stream: true });
      for await (const token of result.tokenStream) {
        text += token;
      }
    } catch (err) {
      throw new QvacRequestError(0, `On-device inference failed: ${String(err)}`);
    }

    const trimmed = text.trim();
    if (!trimmed) {
      throw new QvacRequestError(0, 'QVAC returned empty response');
    }

    return { text: trimmed, generatedAt: new Date() };
  }

  private buildUserMessage(
    parameters: ObdParameterSnapshot,
    troubleCodes: readonly TroubleCode[],
    vehicleContext?: string,
    knowledgeContext?: readonly string[],
  ): string {
    const lines: string[] = [];

    if (vehicleContext) {
      lines.push(`Vehicle: ${vehicleContext}`);
    }

    lines.push('Current OBD-II readings:');
    for (const param of Object.values(parameters)) {
      if (param) {
        const alertNote = param.alert
          ? ` ⚠️ ${param.alert.severity.toUpperCase()}`
          : '';
        lines.push(
          `  ${param.name}: ${param.value.toFixed(1)} ${param.unit}${alertNote}`,
        );
      }
    }

    if (troubleCodes.length > 0) {
      lines.push(`\nActive DTCs (${troubleCodes.length}):`);
      for (const dtc of troubleCodes) {
        lines.push(`  ${dtc.code} [${dtc.severity}]: ${dtc.description}`);
      }
    } else {
      lines.push('\nNo active DTCs.');
    }

    if (knowledgeContext && knowledgeContext.length > 0) {
      lines.push('\nRelevant diagnostic knowledge (retrieved on-device):');
      for (const snippet of knowledgeContext) {
        lines.push(`  - ${snippet}`);
      }
    }

    lines.push('\nProvide a brief diagnostic assessment.');
    return lines.join('\n');
  }
}

// Singleton — one model instance for the entire app session.
export const qvacSDK = new QvacSDKDataSource();
