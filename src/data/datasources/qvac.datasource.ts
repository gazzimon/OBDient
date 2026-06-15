// QVAC datasource — calls the local LLM via OpenAI-compatible HTTP API.
// Falls back gracefully when the server is unreachable.

import {
  QvacRequestError,
  QvacTimeoutError,
  QvacUnavailableError,
} from '@/core/errors/obd.errors';
import type { ObdParameterSnapshot } from '@/domain/entities/obd-parameter';
import type { TroubleCode } from '@/domain/entities/trouble-code';
import { useSettingsStore } from '@/store/settingsStore';

const DEFAULT_BASE_URL = process.env['EXPO_PUBLIC_QVAC_BASE_URL'] ?? 'http://localhost:11434/v1';
const DEFAULT_MODEL = process.env['EXPO_PUBLIC_QVAC_MODEL'] ?? 'qwen2.5:7b';
const REQUEST_TIMEOUT_MS = 30000;

function getBaseUrl(): string {
  return useSettingsStore.getState().qvacBaseUrl || DEFAULT_BASE_URL;
}

function getModel(): string {
  return useSettingsStore.getState().qvacModel || DEFAULT_MODEL;
}

const SYSTEM_PROMPT = `You are OBDient, an expert automotive assistant integrated into a car.
You receive real-time vehicle data via OBD-II.
Always respond in English, clearly and concisely.
If there are active DTC codes, explain what they mean and what to do.
If parameters are normal, say so briefly.
Prioritize safety: if something is urgent, indicate it clearly.
Maximum 3 sentences per response. No unnecessary technical jargon.`;

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: false;
  temperature: number;
  max_tokens: number;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface QvacInterpretationResult {
  text: string;
  generatedAt: Date;
}

export class QvacDataSource {
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${getBaseUrl()}/models`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async interpret(
    parameters: ObdParameterSnapshot,
    troubleCodes: readonly TroubleCode[],
    vehicleContext?: string,
  ): Promise<QvacInterpretationResult> {
    const userMessage = this.buildUserMessage(parameters, troubleCodes, vehicleContext);

    const baseUrl = getBaseUrl();
    const body: OpenAIRequest = {
      model: getModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      temperature: 0.3,
      max_tokens: 150,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new QvacTimeoutError('QVAC request timed out after 30s', err);
      }
      throw new QvacUnavailableError(
        `QVAC server unreachable at ${baseUrl}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new QvacRequestError(response.status, await response.text());
    }

    const json = (await response.json()) as OpenAIResponse;
    const text = json.choices[0]?.message?.content?.trim();
    if (!text) throw new QvacRequestError(response.status, 'QVAC returned empty response');

    return { text, generatedAt: new Date() };
  }

  // Builds a structured prompt from current vehicle data
  private buildUserMessage(
    parameters: ObdParameterSnapshot,
    troubleCodes: readonly TroubleCode[],
    vehicleContext?: string,
  ): string {
    const lines: string[] = [];

    if (vehicleContext) {
      lines.push(`Vehicle: ${vehicleContext}`);
    }

    lines.push('Current OBD-II readings:');
    for (const param of Object.values(parameters)) {
      if (param) {
        const alertNote = param.alert ? ` ⚠️ ${param.alert.severity.toUpperCase()}` : '';
        lines.push(`  ${param.name}: ${param.value.toFixed(1)} ${param.unit}${alertNote}`);
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

    lines.push('\nProvide a brief diagnostic assessment.');
    return lines.join('\n');
  }
}

export const qvacDataSource = new QvacDataSource();
