// Singleton use case instances shared across the presentation layer.
// All repositories wire themselves to their own datasource singletons.

import { hypercoreKnowledge } from '@/data/datasources/hypercore-knowledge.datasource';
import { claudeAPI } from '@/data/datasources/claude-api.datasource';
import { useSettingsStore } from '@/store/settingsStore';
import { OBDRepositoryImpl } from '@/data/repositories/obd.repository.impl';
import { LLMRepositoryImpl } from '@/data/repositories/llm.repository.impl';
import { ReportRepositoryImpl } from '@/data/repositories/report.repository.impl';
import { ConnectToVehicleUseCase } from '@/domain/usecases/connect-to-vehicle';
import { ReadRealTimeParametersUseCase } from '@/domain/usecases/read-real-time-parameters';
import { ReadTroubleCodesUseCase } from '@/domain/usecases/read-trouble-codes';
import { ClearTroubleCodesUseCase } from '@/domain/usecases/clear-trouble-codes';
import { InterpretWithQVACUseCase } from '@/domain/usecases/interpret-with-qvac';
import { ChatWithQVACUseCase } from '@/domain/usecases/chat-with-qvac';
import { MultiAgentChatUseCase } from '@/domain/usecases/multi-agent-chat';
import { DiagnosticIntakeSessionUseCase } from '@/domain/usecases/diagnostic-intake-session';
import { caseLog } from '@/data/datasources/case-log.datasource';
import { harvestOutbox } from '@/data/datasources/harvest-outbox.datasource';
import { claudeKnowledge } from '@/data/datasources/claude-knowledge.datasource';
import { SaveDiagnosticReportUseCase } from '@/domain/usecases/save-diagnostic-report';

// Initialize Hypercore network conditionally based on persisted user preference.
// Runs once at startup; safe to call even if the store hasn't hydrated yet
// (the toggle defaults to false, so nothing starts unless the user opted in).
void (async () => {
  const { knowledgeNetworkEnabled } = useSettingsStore.getState();
  await hypercoreKnowledge.initialize({ enabled: knowledgeNetworkEnabled });
})().catch((err) => {
  // The knowledge network is an optional feature — a failed init (e.g. the
  // worklet couldn't open its feed) must never surface as an uncaught rejection
  // or block app startup. Log and carry on; the app degrades to local-only RAG.
  console.warn('[Knowledge] init failed:', err);
});

const obdRepo    = new OBDRepositoryImpl();
const llmRepo    = new LLMRepositoryImpl();
const reportRepo = new ReportRepositoryImpl();
const carpsy     = new ChatWithQVACUseCase(llmRepo);
const multiAgent = new MultiAgentChatUseCase(carpsy);

// ADR-0009 senior port over the Claude datasource
const seniorAgent = {
  isConfigured: () => claudeAPI.isConfigured(),
  converse: (history: readonly { role: 'user' | 'assistant'; content: string }[]) =>
    claudeAPI.converseSenior(history),
};

// N3a — senior return path: a gate-passed senior diagnosis is stored on-device
// (Layer 0 + vector index) so the junior reuses it offline next time, as
// unverified provenance. Fire-and-forget: reuse is a bonus, never a blocker.
const knowledgeReturn = {
  storeSeniorAnswer: (query: string, answer: string) => {
    void claudeKnowledge
      .store(query, answer)
      .catch((err) => console.warn('[N3a] senior answer store failed:', err));
  },
};

export const container = {
  // Direct read access for the reports screen (list/detail/delete are queries,
  // not use cases with business rules)
  reportRepo,
  // Exposed so the BluetoothProvider can close the physical connection
  obdRepo,
  connectToVehicle: new ConnectToVehicleUseCase(obdRepo),
  readRealTimeParameters: new ReadRealTimeParametersUseCase(obdRepo),
  readTroubleCodes: new ReadTroubleCodesUseCase(obdRepo),
  clearTroubleCodes: new ClearTroubleCodesUseCase(obdRepo),
  interpretWithQVAC: new InterpretWithQVACUseCase(llmRepo),
  chatWithQVAC: carpsy,
  multiAgentChat: multiAgent,
  // ADR-0009 pipeline, token-budget revision: deterministic intake (templates
  // only — no InterviewerPort, so questions are instant and free) → junior
  // diagnosis (QVAC, offline) → senior conversation ONLY on user opt-in.
  diagnosticSession: new DiagnosticIntakeSessionUseCase(
    multiAgent,
    seniorAgent,
    caseLog,
    null,            // InterviewerPort off (template questions — instant and free)
    harvestOutbox,   // C1: gate-passed senior cases → outbox feed (opt-in inside)
    knowledgeReturn, // N3a: gate-passed senior answers → Layer 0 for offline reuse
  ),
  saveDiagnosticReport: new SaveDiagnosticReportUseCase(reportRepo),
  // TriggerAlertUseCase is instantiated in BluetoothProvider with platform AlertServices
} as const;
