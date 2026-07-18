import { resolveCanonicalName, getMetroFareSlabs, getStations } from "@/lib/cache";
import type { AutoFareResult, FareInput, FareOutput } from "@/types";

const MINIMUM_FARE = 30;
const MINIMUM_DISTANCE_KM = 1.5;
const PER_KM_RATE = 18;
const WAITING_CHARGE_PER_5_MIN = 5;
const LUGGAGE_CHARGE_PER_PIECE = 5;
const NIGHT_SURCHARGE_RATE = 0.5;
const DEFAULT_FARE_TIME = new Date("2024-01-01T15:00:00");

const DISTANCE_MATRIX: Record<string, Record<string, number>> = {
  Edapally: {
    "Lulu Mall": 0.8,
    Palarivattom: 3.2,
    Kakkanad: 8.5,
    Infopark: 9.0,
    Kaloor: 5.0,
    Vyttila: 9.2,
    Aluva: 12.5,
    "MG Road": 6.8,
    "Medical College": 3.2,
  },
  Vyttila: {
    Kakkanad: 8.0,
    Maradu: 3.5,
    Tripunithura: 5.8,
    "Fort Kochi": 12.0,
    "Ernakulam South": 3.2,
    Thevara: 2.5,
    Palarivattom: 6.5,
    Edapally: 9.2,
    "MG Road": 4.5,
    "Vyttila Mobility Hub": 0.3,
  },
  Aluva: {
    Airport: 14.0,
    Angamaly: 12.0,
    Edapally: 12.5,
    Kalamassery: 6.0,
    Perumbavoor: 15.0,
  },
  "MG Road": {
    "Fort Kochi": 8.2,
    "Ernakulam Junction": 2.0,
    "Ernakulam South": 2.0,
    Kaloor: 3.5,
    "Marine Drive": 1.2,
    Vyttila: 4.5,
    "High Court": 1.5,
    "High Court Jetty": 1.5,
  },
  Palarivattom: {
    Kakkanad: 7.5,
    Infopark: 9.0,
    Edapally: 3.2,
    Kaloor: 2.5,
    Vyttila: 6.5,
  },
  Kaloor: {
    "Lissie Hospital": 1.5,
    "Medical Trust": 2.0,
    Kadavanthra: 4.5,
    "MG Road": 3.5,
    Palarivattom: 2.5,
    Vyttila: 5.5,
    "Ernakulam South": 3.0,
  },
  "Ernakulam South": {
    "Ernakulam Junction": 0.5,
    "MG Road": 2.0,
    Vyttila: 3.2,
    "Lulu Mall": 8.5,
    Edapally: 7.7,
    Kaloor: 3.0,
    "Ernakulam Boat Jetty": 2.4,
  },
  "Ernakulam Junction": {
    "Ernakulam South": 0.5,
    "MG Road": 2.0,
    Vyttila: 3.5,
    "Lulu Mall": 8.8,
    Edapally: 8.0,
  },
  Tripunithura: {
    "Hill Palace": 2.5,
    Vyttila: 5.8,
    "Ernakulam South": 7.0,
    Kakkanad: 10.5,
  },
  Kakkanad: {
    Infopark: 3.0,
    "Smart City": 4.0,
    Vyttila: 8.0,
    Palarivattom: 7.5,
    Edapally: 8.5,
  },
  "High Court": {
    "Fort Kochi": 5.5,
    Vypin: 4.0,
    "MG Road": 1.5,
  },
};

function normalizePlace(name: string): string {
  return resolveCanonicalName(name) ?? name.trim();
}

export function isNightTime(time: Date): boolean {
  const hours = time.getHours();
  return hours >= 22 || hours < 5;
}

export function getDistance(origin: string, destination: string): number | null {
  const from = normalizePlace(origin);
  const to = normalizePlace(destination);

  if (DISTANCE_MATRIX[from]?.[to] !== undefined) {
    return DISTANCE_MATRIX[from][to];
  }
  if (DISTANCE_MATRIX[to]?.[from] !== undefined) {
    return DISTANCE_MATRIX[to][from];
  }

  return null;
}

function calculateMeterFare(distanceKm: number): number {
  if (distanceKm <= MINIMUM_DISTANCE_KM) {
    return MINIMUM_FARE;
  }
  return MINIMUM_FARE + (distanceKm - MINIMUM_DISTANCE_KM) * PER_KM_RATE;
}

export function generateFareBreakdown(fare: FareOutput, lang: "ml" | "en"): string {
  if (lang === "ml") {
    let text = `${fare.distance_km} കിലോമീറ്ററിന് ഓട്ടോ ചാർജ് ${fare.totalFare} രൂപയാണ്.`;
    if (fare.isNightRate) {
      text += ` ഇതിൽ ${fare.nightSurcharge} രൂപ രാത്രി സർചാർജ് ഉൾപ്പെടുന്നു.`;
    }
    text += ` മീറ്റർ നിരക്ക് ${fare.meterFare} രൂപ.`;
    return text;
  }

  let text = `Auto fare for ${fare.distance_km} km is ₹${fare.totalFare}.`;
  if (fare.isNightRate) {
    text += ` This includes ₹${fare.nightSurcharge} night surcharge (50% extra between 10 PM and 5 AM).`;
  }
  text += ` Base meter fare is ₹${fare.meterFare}.`;
  return text;
}

export function calculateAutoFareByRoute(input: FareInput): FareOutput | null {
  const distance = getDistance(input.origin, input.destination);
  if (distance === null) return null;

  const currentTime = input.currentTime ?? DEFAULT_FARE_TIME;
  const waitingMinutes = input.waitingMinutes ?? 0;
  const luggagePieces = input.luggagePieces ?? 0;
  const waitingBlocks = Math.floor(waitingMinutes / 5);

  const meterFare = Math.round(calculateMeterFare(distance));
  const waitingCharge = waitingBlocks * WAITING_CHARGE_PER_5_MIN;
  const luggageCharge = luggagePieces * LUGGAGE_CHARGE_PER_PIECE;
  const subtotal = meterFare + waitingCharge + luggageCharge;
  const night = isNightTime(currentTime);
  const nightSurcharge = night ? Math.round(subtotal * NIGHT_SURCHARGE_RATE) : 0;
  const totalFare = Math.round(subtotal + nightSurcharge);

  const fare: FareOutput = {
    distance_km: distance,
    baseFare: MINIMUM_FARE,
    meterFare,
    nightSurcharge,
    waitingCharge,
    luggageCharge,
    totalFare,
    isNightRate: night,
    breakdown_en: "",
    breakdown_ml: "",
  };

  fare.breakdown_en = generateFareBreakdown(fare, "en");
  fare.breakdown_ml = generateFareBreakdown(fare, "ml");
  return fare;
}

export function calculateMetroFare(originCode: string, destinationCode: string): number {
  const stations = getStations();
  const origin = stations.find((s) => s.code === originCode);
  const destination = stations.find((s) => s.code === destinationCode);

  if (!origin?.chainage_km || !destination?.chainage_km) {
    return 0;
  }

  const distance = Math.abs(destination.chainage_km - origin.chainage_km);
  const slab = getMetroFareSlabs().find(
    (s) => distance >= s.min_km && (s.max_km === null || distance < s.max_km)
  );

  return slab?.fare ?? getMetroFareSlabs().at(-1)?.fare ?? 0;
}

export function calculateAutoFare(options: {
  distance_km: number;
  isNight?: boolean;
  luggagePieces?: number;
  waitingBlocks?: number;
  at?: Date;
}): AutoFareResult {
  const distance = Math.max(0, options.distance_km);
  const night = options.isNight ?? isNightTime(options.at ?? new Date());
  const waitingBlocks = options.waitingBlocks ?? 0;
  const luggagePieces = options.luggagePieces ?? 0;

  const meterFare = Math.round(calculateMeterFare(distance));
  const waitingCharge = waitingBlocks * WAITING_CHARGE_PER_5_MIN;
  const luggageCharge = luggagePieces * LUGGAGE_CHARGE_PER_PIECE;
  const subtotal = meterFare + waitingCharge + luggageCharge;
  const surchargeAmount = night ? Math.round(subtotal * NIGHT_SURCHARGE_RATE) : 0;
  const finalFare = Math.round(subtotal + surchargeAmount);

  const breakdownData: FareOutput = {
    distance_km: distance,
    baseFare: MINIMUM_FARE,
    meterFare,
    nightSurcharge: surchargeAmount,
    waitingCharge,
    luggageCharge,
    totalFare: finalFare,
    isNightRate: night,
    breakdown_en: "",
    breakdown_ml: "",
  };
  breakdownData.breakdown_en = generateFareBreakdown(breakdownData, "en");
  breakdownData.breakdown_ml = generateFareBreakdown(breakdownData, "ml");

  return {
    distance_km: distance,
    baseFare: MINIMUM_FARE,
    totalFare: subtotal,
    nightSurcharge: night,
    surchargeAmount,
    finalFare,
    breakdown: breakdownData.breakdown_en,
    breakdown_ml: breakdownData.breakdown_ml,
  };
}

export function estimateAutoFareBetween(
  originQuery: string,
  destinationQuery: string,
  options?: { isNight?: boolean; luggagePieces?: number; at?: Date }
): AutoFareResult | null {
  const currentTime = options?.at ?? DEFAULT_FARE_TIME;
  const nightOverride = options?.isNight;

  const routeFare = calculateAutoFareByRoute({
    origin: originQuery,
    destination: destinationQuery,
    currentTime,
    luggagePieces: options?.luggagePieces ?? 0,
  });

  if (!routeFare) return null;

  if (nightOverride !== undefined && nightOverride !== routeFare.isNightRate) {
    return calculateAutoFare({
      distance_km: routeFare.distance_km,
      isNight: nightOverride,
      luggagePieces: options?.luggagePieces ?? 0,
      at: currentTime,
    });
  }

  return {
    distance_km: routeFare.distance_km,
    baseFare: routeFare.baseFare,
    totalFare: routeFare.meterFare + routeFare.waitingCharge + routeFare.luggageCharge,
    nightSurcharge: routeFare.isNightRate,
    surchargeAmount: routeFare.nightSurcharge,
    finalFare: routeFare.totalFare,
    breakdown: routeFare.breakdown_en,
    breakdown_ml: routeFare.breakdown_ml,
  };
}

export { DISTANCE_MATRIX };
