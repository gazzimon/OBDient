// Connects to an ELM327 adapter, runs the init sequence, detects the OBD
// protocol, and returns a Vehicle entity ready for diagnostic use.

import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';
import type { Vehicle } from '@/domain/entities/vehicle';
import { upsertVehicle } from '@/data/datasources/storage.datasource';

export interface ConnectToVehicleInput {
  deviceAddress: string;
  // Optional known metadata — enriches the entity when available
  make?: string;
  model?: string;
  year?: number;
}

export interface ConnectToVehicleResult {
  vehicle: Vehicle;
  alreadyKnown: boolean;
}

export class ConnectToVehicleUseCase {
  constructor(private readonly obdRepo: IOBDRepository) {}

  async execute(input: ConnectToVehicleInput): Promise<ConnectToVehicleResult> {
    const vehicle = await this.obdRepo.connect(input.deviceAddress);

    // Enrich with any user-provided metadata
    const enriched: Vehicle = {
      ...vehicle,
      make: input.make ?? vehicle.make,
      model: input.model ?? vehicle.model,
      year: input.year ?? vehicle.year,
    };

    // Persist the vehicle so it appears in history
    await upsertVehicle({
      id: enriched.id,
      make: enriched.make,
      model: enriched.model,
      year: enriched.year ?? undefined,
      vin: enriched.vin ?? undefined,
      protocol: enriched.protocol,
      adapterAddress: enriched.adapterAddress,
      lastConnectedAt: enriched.connectedAt,
    });

    return { vehicle: enriched, alreadyKnown: false };
  }
}
