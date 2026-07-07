// Singleton use case instances shared across the presentation layer.
// All repositories wire themselves to their own datasource singletons.

import { hypercoreKnowledge } from '@/data/datasources/hypercore-knowledge.datasource';
import { claudeAPI } from '@/data/datasources/claude-api.datasource';
import { claudeKnowledge } from '@/data/datasources/claude-knowledge.datasource';
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
import { qvacInterviewer } from '@/data/datasources/interviewer.adapter';
import { SaveDiagnosticReportUseCase } from '@/domain/usecases/save-diagnostic-report';

// Initialize Hypercore network conditionally based on persisted user preference.
// Runs once at startup; safe to call even if the store hasn't hydrated yet
// (the toggle defaults to false, so nothing starts unless the user opted in).
void (async () => {
  const { knowledgeNetworkEnabled } = useSettingsStore.getState();
  await hypercoreKnowledge.initialize({ enabled: knowledgeNetworkEnabled });
})();

const obdRepo    = new OBDRepositoryImpl();
const llmRepo    = new LLMRepositoryImpl();
const reportRepo = new ReportRepositoryImpl();
const carpsy     = new ChatWithQVACUseCase(llmRepo);
const multiAgent = new MultiAgentChatUseCase(carpsy, claudeAPI, claudeKnowledge);

// ADR-0009 senior port over the Claude datasource
const seniorAgent = {
  isConfigured: () => claudeAPI.isConfigured(),
  converse: (history: readonly { role: 'user' | 'assistant'; content: string }[]) =>
    claudeAPI.converseSenior(history),
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
  // ADR-0009 session pipeline: intake (junior) → brief → senior conversation
  diagnosticSession: new DiagnosticIntakeSessionUseCase(
    multiAgent,
    seniorAgent,
    caseLog,
    qvacInterviewer,
  ),
  saveDiagnosticReport: new SaveDiagnosticReportUseCase(reportRepo),
  // TriggerAlertUseCase is instantiated in BluetoothProvider with platform AlertServices
} as const;
