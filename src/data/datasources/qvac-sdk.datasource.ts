// QVAC on-device LLM datasource.
// Runs the model directly on the device — no internet, no external server.
//
// Lifecycle:
//   1. Call initialize() once at app start to download & load the model into RAM.
//   2. Call interpret() for each diagnostic session.
//   3. Call dispose() when the app goes to background to free RAM (optional).
//
// The model is kept in memory between calls for fast response times.
// Qwen3-1.7B Q4_K_M needs ~1.6 GB of RAM loaded; on low-RAM devices the
// initialize() fallback drops to the SDK's Llama 3.2 1B (~0.9 GB).

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
import { audit, estimateTokens } from '@/core/utils/audit-log';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';

export interface QvacInterpretationResult {
  text: string;
  generatedAt: Date;
}

// Default: stock Qwen3-1.7B instruct, Q4_K_M (~1.11 GB download, ~1.6 GB RAM).
// Replaces the CARpsy fine-tune (Qwen3-0.6B), which leaked training artifacts
// into responses (see stripModelArtifacts). Under ADR-0009 the local model's
// job is interviewing + offline fallback + RAG narration — a clean instruct
// model beats a damaged specialist there. Same Qwen3 family: chat template and
// <think> stripping carry over unchanged.
const QWEN3_1_7B_URL =
  'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf';
// Kept for A/B with scripts/eval-carpsy.js:
// https://huggingface.co/gazzimon/CARpsy-v2-qwen3-0.6b-GGUF/resolve/main/CARpsy-v2-qwen3-0.6b.Q4_K_M.gguf
const DEFAULT_MODEL = QWEN3_1_7B_URL;

// The QVAC/llama.cpp default ctx_size is only 1024 tokens — too small for a
// diagnostic prompt (system prompt + 20 live sensors + retrieved knowledge +
// chat history) plus room to generate a reply, which overflows with
// CONTEXT_OVERFLOW. Qwen3-0.6B supports far more, so we raise it; 4096 tokens
// is ample headroom and costs only a few MB of extra KV cache at 0.6B.
const MODEL_CTX_SIZE = 4096;

// Hard ceiling on generated tokens (audit M4). The system prompt already asks for
// ≤3 sentences, but an adversarial/looping prompt could otherwise generate up to
// ctx_size — wasted battery/time and a wall of uncontrolled text in the UI. We cap
// defensively by stopping consumption of the stream; ~700 tokens is well beyond a
// normal diagnostic reply.
const MAX_OUTPUT_TOKENS = 700;

const SYSTEM_PROMPT = `You are OBDient, an expert automotive diagnostic assistant.
You receive real-time OBD-II vehicle data and may or may not have fault codes.
Respond in the same language the user writes in.
Knowledge may come in two sections:
  - "Verified diagnostic knowledge" is trusted — base your diagnosis on it.
  - "Unverified suggestions" are AI-generated and NOT confirmed — you may use them
    as hypotheses, but flag uncertainty (e.g. "possibly", "this might be") and never
    state them as established fact.
Do not invent causes that appear in neither section.
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
  // Remembered so the model can be reloaded after a worklet crash (OOM/LMK),
  // without the user having to re-pick the source in Settings.
  private lastModelSrc: string = DEFAULT_MODEL;

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
    this.lastModelSrc = modelSrc;

    this.loadingPromise = (async () => {
      const load = async (src: string): Promise<void> => {
        const startedAt = Date.now();
        this.modelId = await loadModel({
          modelSrc: src,
          modelType: 'llamacpp-completion',
          modelConfig: { ctx_size: MODEL_CTX_SIZE },
        });
        this.lastModelSrc = src;
        this.loadProgress = 1;
        const loadMs = Date.now() - startedAt;
        // Artifact log: proves the model was loaded ON-DEVICE via the QVAC SDK.
        console.log(
          `[QVAC] Model loaded on-device in ${loadMs}ms — src=${src} modelId=${this.modelId}`,
        );
        audit({ event: 'model_load', modelId: this.modelId, src, load_ms: loadMs });
        onProgress?.(1);
      };

      try {
        await load(modelSrc);
      } catch (primaryErr) {
        // Last-resort fallback: the SDK's own shipped model constant. Covers
        // OOM on low-RAM devices and a broken/unreachable custom URL.
        if (modelSrc === LLAMA_3_2_1B_INST_Q4_0.src) {
          this.loadingPromise = null;
          throw new QvacUnavailableError('Failed to load QVAC model on device', primaryErr);
        }
        console.warn(
          `[QVAC] primary model failed (${String(primaryErr)}) — falling back to Llama 3.2 1B`,
        );
        try {
          await load(LLAMA_3_2_1B_INST_Q4_0.src);
        } catch (fallbackErr) {
          this.loadingPromise = null;
          throw new QvacUnavailableError('Failed to load QVAC model on device', fallbackErr);
        }
      }
    })();

    return this.loadingPromise;
  }

  // Force a clean reload after a worklet crash. The model file is already cached
  // on disk, so this loads it back into RAM without re-downloading.
  private async reloadModel(): Promise<void> {
    this.modelId = null;
    this.loadingPromise = null;
    const startedAt = Date.now();
    this.modelId = await loadModel({
      modelSrc: this.lastModelSrc,
      modelType: 'llamacpp-completion',
      modelConfig: { ctx_size: MODEL_CTX_SIZE },
    });
    this.loadProgress = 1;
    audit({ event: 'model_load', modelId: this.modelId, src: this.lastModelSrc, load_ms: Date.now() - startedAt });
  }

  // Run a streaming completion with one automatic reload-and-retry. The bare-kit
  // worklet can be killed by Android (memory pressure) between calls, leaving a
  // stale modelId; on failure we reload the model once and retry before giving up.
  private async streamCompletion(
    llmHistory: { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<string> {
    // Prompt size for the audit record (chars known exactly; tokens estimated).
    const promptChars = llmHistory.reduce((n, m) => n + m.content.length, 0);

    const run = async (): Promise<string> => {
      const startedAt = Date.now();
      let firstTokenAt: number | null = null;
      let text = '';
      let tokenCount = 0;
      const result = completion({ modelId: this.modelId!, history: llmHistory, stream: true });
      for await (const token of result.tokenStream) {
        if (firstTokenAt === null) firstTokenAt = Date.now(); // TTFT marker
        text += token;
        tokenCount++;
        // Defensive output cap (audit M4): stop consuming once we hit the ceiling.
        if (tokenCount >= MAX_OUTPUT_TOKENS) break;
      }
      // Artifact log: proves inference ran ON-DEVICE and records throughput.
      const ms = Date.now() - startedAt;
      const tpsNum = ms > 0 ? tokenCount / (ms / 1000) : 0;
      const tps = ms > 0 ? tpsNum.toFixed(1) : '—';
      const ttftMs = firstTokenAt !== null ? firstTokenAt - startedAt : null;
      console.log(
        `[QVAC] On-device inference: ${tokenCount} tokens in ${ms}ms (${tps} tok/s) modelId=${this.modelId}`,
      );
      audit({
        event: 'inference',
        modelId: this.modelId!,
        prompt_chars: promptChars,
        prompt_tokens_est: estimateTokens(promptChars),
        completion_tokens: tokenCount,
        ttft_ms: ttftMs,
        total_ms: ms,
        tokens_per_sec: Number(tpsNum.toFixed(1)),
      });
      return text;
    };

    try {
      return await run();
    } catch (firstErr) {
      console.warn('[QVAC] inference failed — reloading model and retrying once:', firstErr);
      try {
        await this.reloadModel();
        return await run();
      } catch (secondErr) {
        throw new QvacRequestError(0, `On-device inference failed after reload: ${String(secondErr)}`);
      }
    }
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
    const unloadedId = this.modelId;
    try {
      await unloadModel({ modelId: this.modelId });
    } finally {
      this.modelId = null;
      this.loadingPromise = null;
      this.loadProgress = 0;
      audit({ event: 'model_unload', modelId: unloadedId });
    }
  }

  // Multi-turn chat: receives the full conversation history and returns the next reply.
  // `systemContext` is injected once as the first user turn so QVAC has vehicle + DTC context.
  // `systemPrompt` selects the role (default: diagnostic junior; the ADR-0009
  // interviewer passes its own — PLAN-001 Pattern 2, per-role prompts).
  async chat(
    systemContext: string,
    history: readonly { role: 'user' | 'assistant'; content: string }[],
    systemPrompt: string = SYSTEM_PROMPT,
  ): Promise<QvacInterpretationResult> {
    if (this.modelId === null) {
      throw new QvacUnavailableError('QVAC model is not loaded. Call initialize() first.');
    }

    // Cap history to last 6 messages (3 exchanges) to stay within the 0.6B model context window.
    // The full history causes context overflow → model loops and repeats its last response.
    const MAX_HISTORY = 6;
    const cappedHistory = history.slice(-MAX_HISTORY);

    // Defense-in-depth against CONTEXT_OVERFLOW: even with the raised ctx_size,
    // bound the injected context so an unusually large knowledge block can't push
    // the prompt past the window (which would surface as a failed inference).
    // ~4 chars/token; reserve room for the system prompt, history, and the reply.
    const MAX_CONTEXT_CHARS = (MODEL_CTX_SIZE - 1024) * 4;
    const boundedContext =
      systemContext.length > MAX_CONTEXT_CHARS
        ? systemContext.slice(0, MAX_CONTEXT_CHARS) + '\n…(context truncated to fit on-device model)'
        : systemContext;
    if (boundedContext !== systemContext) {
      console.warn(
        `[QVAC] systemContext truncated ${systemContext.length}→${MAX_CONTEXT_CHARS} chars to fit ctx_size=${MODEL_CTX_SIZE}`,
      );
    }

    // Close the systemContext "user" turn with an assistant ack before the real conversation.
    // Without this, the first real user message follows the context directly as a second consecutive
    // user turn — invalid chat format that confuses the model.
    const llmHistory = [
      { role: 'system' as const,    content: systemPrompt },
      { role: 'user' as const,      content: boundedContext },
      { role: 'assistant' as const, content: 'Understood. I have the vehicle data. How can I help?' },
      ...cappedHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const text = await this.streamCompletion(llmHistory);

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

    const text = await this.streamCompletion(history);

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
