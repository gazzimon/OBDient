// Singleton use case instances shared across the presentation layer.
// All repositories wire themselves to their own datasource singletons.

import { OBDRepositoryImpl } from '@/data/repositories/obd.repository.impl';
import { LLMRepositoryImpl } from '@/data/repositories/llm.repository.impl';
import { ReportRepositoryImpl } from '@/data/repositories/report.repository.impl';
import { ConnectToVehicleUseCase } from '@/domain/usecases/connect-to-vehicle';
import { ReadRealTimeParametersUseCase } from '@/domain/usecases/read-real-time-parameters';
import { ReadTroubleCodesUseCase } from '@/domain/usecases/read-trouble-codes';
import { ClearTroubleCodesUseCase } from '@/domain/usecases/clear-trouble-codes';
import { InterpretWithQVACUseCase } from '@/domain/usecases/interpret-with-qvac';
import { SaveDiagnosticReportUseCase } from '@/domain/usecases/save-diagnostic-report';

const obdRepo = new OBDRepositoryImpl();
const llmRepo = new LLMRepositoryImpl();
const reportRepo = new ReportRepositoryImpl();

export const container = {
  connectToVehicle: new ConnectToVehicleUseCase(obdRepo),
  readRealTimeParameters: new ReadRealTimeParametersUseCase(obdRepo),
  readTroubleCodes: new ReadTroubleCodesUseCase(obdRepo),
  clearTroubleCodes: new ClearTroubleCodesUseCase(obdRepo),
  interpretWithQVAC: new InterpretWithQVACUseCase(llmRepo),
  saveDiagnosticReport: new SaveDiagnosticReportUseCase(reportRepo),
  // TriggerAlertUseCase is instantiated in BluetoothProvider with platform AlertServices
} as const;
