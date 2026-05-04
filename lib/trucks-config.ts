export interface TruckConfig {
  id: number;
  licensePlate: string;
  driver: string;
  type: string;
  typeEn: string;
  maxPallets: number;
  maxWeightKg: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  refrigerated: boolean;
  phone?: string;
}

// Static fleet config — update to match actual vehicles
const FLEET: TruckConfig[] = [
  {
    id: 1,
    licensePlate: "12-345-67",
    driver: "יוסי כהן",
    type: "משאית כבדה",
    typeEn: "Heavy Truck",
    maxPallets: 10,
    maxWeightKg: 12000,
    lengthM: 7.2,
    widthM: 2.4,
    heightM: 2.6,
    refrigerated: false,
    phone: "050-1234567",
  },
  {
    id: 2,
    licensePlate: "23-456-78",
    driver: "דוד לוי",
    type: "משאית מקוררת",
    typeEn: "Refrigerated Truck",
    maxPallets: 10,
    maxWeightKg: 10000,
    lengthM: 6.8,
    widthM: 2.4,
    heightM: 2.4,
    refrigerated: true,
    phone: "052-2345678",
  },
  {
    id: 3,
    licensePlate: "34-567-89",
    driver: "משה אברהם",
    type: "משאית בינונית",
    typeEn: "Medium Truck",
    maxPallets: 10,
    maxWeightKg: 8000,
    lengthM: 6.0,
    widthM: 2.3,
    heightM: 2.5,
    refrigerated: false,
    phone: "054-3456789",
  },
  {
    id: 4,
    licensePlate: "45-678-90",
    driver: "אלי שפירא",
    type: "משאית כבדה",
    typeEn: "Heavy Truck",
    maxPallets: 10,
    maxWeightKg: 12000,
    lengthM: 7.2,
    widthM: 2.4,
    heightM: 2.6,
    refrigerated: false,
    phone: "058-4567890",
  },
];

export function getTruckConfig(truckNumber: number): TruckConfig {
  // Cycle through fleet if more trucks than configs
  const idx = (truckNumber - 1) % FLEET.length;
  return { ...FLEET[idx], id: truckNumber };
}
