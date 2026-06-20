// QVAC on-device LLM datasource.
// Runs the model directly on the device — no internet, no external server.
//
// Lifecycle:
//   1. Call initialize() once at app start to download & load the model into RAM.
//   2. Call interpret() for each diagnostic session.
//   3. Call dispose() when the app goes to background to free RAM (optional).
//
// The model is kept in memory between calls for fast response times.
// CARpsy Q4_K_M (0.6B) needs roughly 400 MB of RAM — safe to keep loaded on mid-range phones.

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

// CARpsy — OBDient's fine-tuned Qwen3-0.6B model, specialized for OBD-II diagnostics.
// Hosted on Hugging Face; downloaded once and cached on device by the QVAC SDK.
// Fallback: LLAMA_3_2_1B_INST_Q4_0 if the custom model fails to load.
const CARPSY_MODEL_URL =
  'https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF/resolve/main/CARpsy-v2-qwen3-0.6b.Q4_K_M.gguf';
const DEFAULT_MODEL = CARPSY_MODEL_URL;

const SYSTEM_PROMPT = `You are OBDient, an expert automotive diagnostic assistant.
You receive real-time OBD-II vehicle data and may or may not have fault codes.
Respond in the same language the user writes in.
When a "Relevant diagnostic knowledge" section is provided, base your diagnosis ONLY on that knowledge.
Do not add causes or diagnoses not listed in the provided knowledge.
If there are active DTC codes, explain what they mean and what to do next.
If there are NO fault codes, analyze the live sensor data and tell the user whether everything looks normal or if anything stands out.
If parameters are normal, say so briefly and reassuringly.
Prioritize safety: if something is urgent, state it in the first sentence.
Maximum 3 sentences. No unnecessary technical jargon.`;

function stripThinkingTokens(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

// Removes known CARpsy fine-tuning artifacts that leak into responses.
// These are training-data instructions the model echoes in certain contexts.
function stripModelArtifacts(text: string): string {
  return text
    .replace(/—\s*Do not answer in \w+\.?/gi, '')
    .replace(/Do not answer in \w+\.?/gi, '')
    .replace(/Respond in the same language.*?\./gi, '')
    .trim();
}

export class QvacSDKDataSource {
  private modelId: string | null = null;
  private loadingPromise: Promise<void> | null = null;
  private loadProgress = 0;

  // Download and load the model into memory.
  // Safe to call multiple times — only loads once.
  // Pass a custom `modelSrc` (HTTPS URL, local path, or pear:// key) to use a fine-tuned GGUF
  // instead of the default bundled model.
  async initialize(
    onProgress?: (progress: number) => void,
    customModelSrc?: string | null,
  ): Promise<void> {
    if (this.modelId !== null) return;
    if (this.loadingPromise !== null) return this.loadingPromise;

    const modelSrc = (customModelSrc ?? '').trim() || DEFAULT_MODEL;

    this.loadingPromise = (async () => {
      try {
        this.modelId = await loadModel({ modelSrc, modelType: 'llamacpp-completion' });
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

    // Cap history to last 6 messages (3 exchanges) to stay within the 0.6B model context window.
    // The full history causes context overflow → model loops and repeats its last response.
    const MAX_HISTORY = 6;
    const cappedHistory = history.slice(-MAX_HISTORY);

    // Close the systemContext "user" turn with an assistant ack before the real conversation.
    // Without this, the first real user message follows the context directly as a second consecutive
    // user turn — invalid chat format that confuses the model.
    const llmHistory = [
      { role: 'system' as const,    content: SYSTEM_PROMPT },
      { role: 'user' as const,      content: systemContext },
      { role: 'assistant' as const, content: 'Understood. I have the vehicle data. How can I help?' },
      ...cappedHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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

    const trimmed = stripModelArtifacts(stripThinkingTokens(text));
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

    const trimmed = stripThinkingTokens(text);
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
      lines.push('\nRelevant diagnostic knowledge (retrieved on-device — base your diagnosis on this):');
      for (const snippet of knowledgeContext) {
        // Prefix each snippet with the DTC it belongs to if detectable (format: "DTC Pxxxx — ...")
        const dtcMatch = snippet.match(/DTC\s+(P\d{4}[^—\s]*)/);
        const label = dtcMatch ? `[${dtcMatch[1]}] ` : '';
        lines.push(`  - ${label}${snippet}`);
      }
    }

    lines.push('\nProvide a brief diagnostic assessment.');
    return lines.join('\n');
  }
}

// Singleton — one model instance for the entire app session.
export const qvacSDK = new QvacSDKDataSource();
