// Tests the VIN enrichment logic in ConnectToVehicleUseCase:
// - First connection: calls Vincario API
// - Reconnection with same VIN: uses SQLite cache, skips API
// - No VIN: skips both cache and API

import { ConnectToVehicleUseCase } from '@/domain/usecases/connect-to-vehicle';
import type { IOBDRepository } from '@/domain/repositories/i-obd.repository';
import { createUnknownVehicle } from '@/domain/entities/vehicle';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockVehicle = createUnknownVehicle('AA:BB:CC:DD:EE:FF', 'ISO_15765_4_CAN_29BIT_500K');

const mockObdRepo: IOBDRepository = {
  connect:           jest.fn().mockResolvedValue(mockVehicle),
  disconnect:        jest.fn(),
  readParameter:     jest.fn(),
  readParameters:    jest.fn(),
  readTroubleCodes:  jest.fn(),
  clearTroubleCodes: jest.fn(),
  readVin:           jest.fn(),
  isConnected:       jest.fn().mockReturnValue(true),
};

// Mock storage datasource
jest.mock('@/data/datasources/storage.datasource', () => ({
  upsertVehicle:   jest.fn().mockResolvedValue(undefined),
  getVehicleByVin: jest.fn(),
}));

// Mock Vincario datasource
jest.mock('@/data/datasources/vincario.datasource', () => ({
  fetchVehicleInfoByVin: jest.fn(),
}));

import { upsertVehicle, getVehicleByVin } from '@/data/datasources/storage.datasource';
import { fetchVehicleInfoByVin } from '@/data/datasources/vincario.datasource';

const mockGetVehicleByVin   = getVehicleByVin   as jest.Mock;
const mockFetchVincario      = fetchVehicleInfoByVin as jest.Mock;
const mockReadVin            = mockObdRepo.readVin as jest.Mock;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConnectToVehicleUseCase — VIN enrichment', () => {
  let useCase: ConnectToVehicleUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ConnectToVehicleUseCase(mockObdRepo);
  });

  it('calls Vincario and enriches vehicle on first connection (no cache)', async () => {
    mockReadVin.mockResolvedValue('8AGEA76C0RR117525');
    mockGetVehicleByVin.mockResolvedValue(null); // no cache
    mockFetchVincario.mockResolvedValue({
      make:         'Chevrolet',
      model:        null,
      year:         2024,
      manufacturer: 'General Motors De Argentina Srl',
      plantCountry: 'Argentina',
    });

    const { vehicle } = await useCase.execute({ deviceAddress: 'AA:BB:CC:DD:EE:FF' });

    expect(mockFetchVincario).toHaveBeenCalledWith('8AGEA76C0RR117525');
    expect(vehicle.make).toBe('Chevrolet');
    expect(vehicle.year).toBe(2024);
    expect(vehicle.manufacturer).toBe('General Motors De Argentina Srl');
    expect(vehicle.plantCountry).toBe('Argentina');
    expect(vehicle.vin).toBe('8AGEA76C0RR117525');
    expect(upsertVehicle).toHaveBeenCalled();
  });

  it('uses SQLite cache on reconnection — skips Vincario API', async () => {
    mockReadVin.mockResolvedValue('8AGEA76C0RR117525');
    mockGetVehicleByVin.mockResolvedValue({
      id:             'cached-id',
      make:           'Chevrolet',
      model:          'Unknown',
      year:           2024,
      vin:            '8AGEA76C0RR117525',
      manufacturer:   'General Motors De Argentina Srl',
      plantCountry:   'Argentina',
      protocol:       'ISO_15765_4_CAN_29BIT_500K',
      adapterAddress: 'AA:BB:CC:DD:EE:FF',
      lastConnectedAt: new Date(),
    });

    const { vehicle } = await useCase.execute({ deviceAddress: 'AA:BB:CC:DD:EE:FF' });

    expect(mockFetchVincario).not.toHaveBeenCalled(); // cache hit — no API call
    expect(vehicle.make).toBe('Chevrolet');
    expect(vehicle.manufacturer).toBe('General Motors De Argentina Srl');
  });

  it('skips both cache and API when VIN is not available', async () => {
    mockReadVin.mockResolvedValue(null); // adapter doesn't support mode 09

    const { vehicle } = await useCase.execute({ deviceAddress: 'AA:BB:CC:DD:EE:FF' });

    expect(mockGetVehicleByVin).not.toHaveBeenCalled();
    expect(mockFetchVincario).not.toHaveBeenCalled();
    expect(vehicle.make).toBe('Unknown');
    expect(vehicle.vin).toBeNull();
  });

  it('explicit input overrides Vincario data', async () => {
    mockReadVin.mockResolvedValue('8AGEA76C0RR117525');
    mockGetVehicleByVin.mockResolvedValue(null);
    mockFetchVincario.mockResolvedValue({
      make: 'Chevrolet', model: null, year: 2024,
      manufacturer: 'General Motors De Argentina Srl', plantCountry: 'Argentina',
    });

    const { vehicle } = await useCase.execute({
      deviceAddress: 'AA:BB:CC:DD:EE:FF',
      make:  'Chevrolet',
      model: 'Onix',
      year:  2024,
    });

    expect(vehicle.make).toBe('Chevrolet');
    expect(vehicle.model).toBe('Onix');  // user input wins
    expect(vehicle.year).toBe(2024);
  });

  it('still connects when Vincario API fails', async () => {
    mockReadVin.mockResolvedValue('8AGEA76C0RR117525');
    mockGetVehicleByVin.mockResolvedValue(null);
    mockFetchVincario.mockResolvedValue(null); // API returned null

    const { vehicle } = await useCase.execute({ deviceAddress: 'AA:BB:CC:DD:EE:FF' });

    expect(vehicle.make).toBe('Unknown'); // falls back to adapter default
    expect(vehicle.vin).toBe('8AGEA76C0RR117525'); // VIN still saved
  });
});
