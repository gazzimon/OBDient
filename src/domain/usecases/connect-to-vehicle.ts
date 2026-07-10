// Connects to an ELM327 adapter, runs the init sequence, detects the OBD
// protocol, and returns a Vehicle entity ready for diagnostic use.

import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';
import type { Vehicle } from '@/domain/entities/vehicle';
import { upsertVehicle, getVehicleByVin } from '@/data/datasources/storage.datasource';
import { fetchVehicleInfoByVin } from '@/data/datasources/nhtsa.datasource';

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

    // Attempt VIN read — non-fatal, not all vehicles/adapters support mode 09
    const vin = await this.obdRepo.readVin();

    // If we got a VIN, check SQLite cache first to avoid a redundant network
    // decode on every reconnection to the same vehicle.
    const cached = vin ? await getVehicleByVin(vin) : null;
    const vinInfo = cached?.manufacturer
      ? { make: cached.make, model: cached.model ?? null, year: cached.year ?? null, manufacturer: cached.manufacturer, plantCountry: cached.plantCountry ?? null }
      : vin ? await fetchVehicleInfoByVin(vin) : null;

    // Enrich: explicit input > NHTSA decode > adapter-detected > defaults
    const enriched: Vehicle = {
      ...vehicle,
      vin:          vin ?? vehicle.vin,
      make:         input.make  ?? vinInfo?.make         ?? vehicle.make,
      model:        input.model ?? vinInfo?.model        ?? vehicle.model,
      year:         input.year  ?? vinInfo?.year         ?? vehicle.year,
      manufacturer: vinInfo?.manufacturer ?? vehicle.manufacturer,
      plantCountry: vinInfo?.plantCountry ?? vehicle.plantCountry,
    };

    // Persist the vehicle so it appears in history
    await upsertVehicle({
      id:             enriched.id,
      make:           enriched.make,
      model:          enriched.model,
      year:           enriched.year         ?? undefined,
      vin:            enriched.vin          ?? undefined,
      manufacturer:   enriched.manufacturer ?? undefined,
      plantCountry:   enriched.plantCountry ?? undefined,
      protocol:       enriched.protocol,
      adapterAddress: enriched.adapterAddress,
      lastConnectedAt: enriched.connectedAt,
    });

    return { vehicle: enriched, alreadyKnown: false };
  }
}
