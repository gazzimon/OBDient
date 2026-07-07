// Tests for vehicle-identity-parser.ts — deterministic identity extraction
// from free-text intake replies (ADR-0009 Phase 1 input path).

import { parseVehicleIdentity } from '@/domain/services/vehicle-identity-parser';

describe('parseVehicleIdentity — full replies', () => {
  const CASES: ReadonlyArray<[string, string | null, string | null, number | null, string | null]> = [
    // text, make, model, year, engine
    ['chevrolet corsa 1.6 2008', 'Chevrolet', 'Corsa', 2008, '1.6'],
    ['Tengo un vw gol 2010', 'Volkswagen', 'Gol', 2010, null],
    ['es un citroën c4 del 2012', 'Citroën', 'C4', 2012, null],
    ['Ford Fiesta 1,6 2015', 'Ford', 'Fiesta', 2015, '1.6'],
    ['toyota hilux sw4 2018 3.0', 'Toyota', 'Hilux Sw4', 2018, '3.0'],
    ['mi auto es un fiat palio 1.4 modelo 2013', 'Fiat', 'Palio', 2013, '1.4'],
    ['chevy corsa', 'Chevrolet', 'Corsa', null, null],
    ['renault clio mio', 'Renault', 'Clio Mio', null, null],
  ];

  it.each(CASES)('"%s"', (text, make, model, year, engine) => {
    const parsed = parseVehicleIdentity(text);
    expect(parsed.make).toBe(make);
    expect(parsed.model).toBe(model);
    expect(parsed.year).toBe(year);
    expect(parsed.engine).toBe(engine);
  });
});

describe('parseVehicleIdentity — partial and edge cases', () => {
  it('model before make still resolves both', () => {
    const parsed = parseVehicleIdentity('corsa chevrolet 2008');
    expect(parsed.make).toBe('Chevrolet');
    expect(parsed.model).toBe('Corsa');
    expect(parsed.year).toBe(2008);
  });

  it('year alone', () => {
    const parsed = parseVehicleIdentity('2008');
    expect(parsed).toEqual({ make: null, model: null, year: 2008, engine: null, mileageKm: null, fuelType: null });
  });

  it('rejects implausible years (they become model candidates, not years)', () => {
    expect(parseVehicleIdentity('peugeot 206 1975').year).toBeNull();
  });

  it('numeric model names are not eaten by the year regex', () => {
    const parsed = parseVehicleIdentity('peugeot 206 2005');
    expect(parsed.make).toBe('Peugeot');
    expect(parsed.model).toBe('206');
    expect(parsed.year).toBe(2005);
  });

  it('empty and noise-only input yields all nulls', () => {
    const empty = { make: null, model: null, year: null, engine: null, mileageKm: null, fuelType: null };
    expect(parseVehicleIdentity('')).toEqual(empty);
    expect(parseVehicleIdentity('es mi auto')).toEqual(empty);
  });

  it('is deterministic', () => {
    const text = 'chevrolet corsa 1.6 2008';
    expect(parseVehicleIdentity(text)).toEqual(parseVehicleIdentity(text));
  });
});

describe('parseVehicleIdentity — mileage and fuel type', () => {
  it('parses "150 mil km" shorthand mileage', () => {
    const parsed = parseVehicleIdentity('chevrolet corsa 2008 1.6 nafta, 150 mil km');
    expect(parsed.mileageKm).toBe(150000);
    expect(parsed.fuelType).toBe('petrol');
    expect(parsed.model).toBe('Corsa');
    expect(parsed.year).toBe(2008);
  });

  it('parses full mileage with thousands separators', () => {
    expect(parseVehicleIdentity('peugeot 206 2005 con 120.000 kms').mileageKm).toBe(120000);
    expect(parseVehicleIdentity('180000 km, ford fiesta diesel 2015').mileageKm).toBe(180000);
  });

  it('recognizes fuel type aliases', () => {
    expect(parseVehicleIdentity('gol 2010 gasolina').fuelType).toBe('petrol');
    expect(parseVehicleIdentity('hilux 2018 gasoil').fuelType).toBe('diesel');
    expect(parseVehicleIdentity('corsa gnc 2008').fuelType).toBe('cng');
  });

  it('mileage digits never leak into the model name', () => {
    const parsed = parseVehicleIdentity('ford fiesta 2015 150000 km');
    expect(parsed.model).toBe('Fiesta');
    expect(parsed.mileageKm).toBe(150000);
  });

  it('bare long numbers without a km marker are ignored (not mileage, not model)', () => {
    const parsed = parseVehicleIdentity('ford fiesta 150000');
    expect(parsed.mileageKm).toBeNull();
    expect(parsed.model).toBe('Fiesta');
  });
});
