import { resolveCanonicalName } from "@/lib/cache";
import type { Language, TransitRoute } from "@/types";

interface DemoMetroRoute {
  id: string;
  origins: string[];
  destinations: string[];
  routeOrigin: string;
  routeDestination: string;
  direction: string;
  answerEn: string;
  answerMl: string;
}

const DEMO_METRO_ROUTES: DemoMetroRoute[] = [
  {
    id: "M1",
    origins: ["Aluva"],
    destinations: ["MG Road"],
    routeOrigin: "Aluva",
    routeDestination: "MG Road",
    direction: "Southbound (Towards Tripunithura)",
    answerEn:
      "You can take a direct Kochi Metro train from Aluva heading towards Tripunithura and get down at MG Road Metro Station.",
    answerMl:
      "ആലുവയിൽ നിന്നും തൃപ്പൂണിത്തുറ ഭാഗത്തേക്കുള്ള മെട്രോയിൽ കയറി എം.ജി റോഡ് മെട്രോ സ്റ്റേഷനിൽ ഇറങ്ങുക.",
  },
  {
    id: "M2",
    origins: ["Edapally"],
    destinations: ["Vyttila"],
    routeOrigin: "Edapally",
    routeDestination: "Vyttila",
    direction: "Southbound (Towards Tripunithura)",
    answerEn:
      "Board the metro at Edapally station heading towards Tripunithura and alight at Vyttila Metro Station.",
    answerMl:
      "ഇടപ്പള്ളിയിൽ നിന്ന് തൃപ്പൂണിത്തുറ ഭാഗത്തേക്കുള്ള മെട്രോ ട്രെയിനിൽ കയറി വൈറ്റില സ്റ്റേഷനിൽ ഇറങ്ങുക.",
  },
  {
    id: "M3",
    origins: ["Ernakulam South"],
    destinations: ["Lulu Mall", "Edapally"],
    routeOrigin: "Ernakulam South",
    routeDestination: "Edapally",
    direction: "Northbound (Towards Aluva)",
    answerEn:
      "Take the metro from Ernakulam South station heading towards Aluva. Get down at Edapally Metro Station, which is directly connected to Lulu Mall via a skywalk.",
    answerMl:
      "എറണാകുളം സൗത്ത് സ്റ്റേഷനിൽ നിന്ന് ആലുവ ഭാഗത്തേക്കുള്ള മെട്രോയിൽ കയറുക. ലുലു മാളിലേക്ക് പോകാൻ ഇടപ്പള്ളി മെട്രോ സ്റ്റേഷനിൽ ഇറങ്ങുക. അവിടെ നിന്ന് മാളിലേക്ക് നേരിട്ട് ഒരു സ്കൈവാക്ക് ഉണ്ട്.",
  },
  {
    id: "M4",
    origins: ["Ernakulam Junction"],
    destinations: ["Lulu Mall", "Edapally"],
    routeOrigin: "Ernakulam South",
    routeDestination: "Edapally",
    direction: "Northbound (Towards Aluva)",
    answerEn:
      "The nearest metro station to Ernakulam Junction railway station is Ernakulam South. Board the train there heading towards Aluva, and get off at Edapally Metro Station. From there, you can walk directly into Lulu Mall.",
    answerMl:
      "എറണാകുളം ജംഗ്ഷൻ റെയിൽവേ സ്റ്റേഷന് ഏറ്റവും അടുത്തുള്ള മെട്രോ സ്റ്റേഷൻ എറണാകുളം സൗത്ത് ആണ്. അവിടെ നിന്നും ആലുവ ഭാഗത്തേക്കുള്ള മെട്രോയിൽ കയറി ഇടപ്പള്ളി സ്റ്റേഷനിൽ ഇറങ്ങുക. അവിടെ നിന്ന് ലുലു മാളിലേക്ക് നടന്നു പോകാം.",
  },
  {
    id: "M5",
    origins: ["Kalamassery"],
    destinations: ["Maharaja's College"],
    routeOrigin: "Kalamassery",
    routeDestination: "Maharaja's College",
    direction: "Southbound (Towards Tripunithura)",
    answerEn:
      "Take a metro from Kalamassery station moving towards Tripunithura and step out at Maharaja's College Metro Station.",
    answerMl:
      "കളമശ്ശേരിയിൽ നിന്ന് തൃപ്പൂണിത്തുറ ഭാഗത്തേക്ക് പോകുന്ന മെട്രോയിൽ കയറി മഹാരാജാസ് കോളേജ് സ്റ്റേഷനിൽ ഇറങ്ങുക.",
  },
  {
    id: "M6",
    origins: ["Palarivattom"],
    destinations: ["Tripunithura"],
    routeOrigin: "Palarivattom",
    routeDestination: "Tripunithura",
    direction: "Southbound (Towards Tripunithura)",
    answerEn:
      "You can board a direct train from Palarivattom station heading southbound and get off at the final stop, Tripunithura Metro Station.",
    answerMl:
      "പാലാരിവട്ടത്തു നിന്നും തൃപ്പൂണിത്തുറ ഭാഗത്തേക്കുള്ള മെട്രോയിൽ കയറി അവസാന സ്റ്റോപ്പായ തൃപ്പൂണിത്തുറ മെട്രോ സ്റ്റേഷനിൽ ഇറങ്ങുക.",
  },
  {
    id: "M7",
    origins: ["Kaloor"],
    destinations: ["Vyttila"],
    routeOrigin: "Kaloor",
    routeDestination: "Vyttila",
    direction: "Southbound (Towards Tripunithura)",
    answerEn:
      "Board the metro at Kaloor station heading towards Tripunithura and alight at Vyttila Metro Station.",
    answerMl:
      "കലൂരിൽ നിന്നും തൃപ്പൂണിത്തുറ ഭാഗത്തേക്കുള്ള മെട്രോ ട്രെയിനിൽ കയറി വൈറ്റില സ്റ്റേഷനിൽ ഇറങ്ങുക.",
  },
  {
    id: "M8",
    origins: ["MG Road"],
    destinations: ["CUSAT"],
    routeOrigin: "MG Road",
    routeDestination: "Cochin University (CUSAT)",
    direction: "Northbound (Towards Aluva)",
    answerEn:
      "Take the metro from MG Road station heading towards Aluva and get down at Cochin University (CUSAT) Metro Station.",
    answerMl:
      "എം.ജി റോഡിൽ നിന്ന് ആലുവ ഭാഗത്തേക്ക് പോകുന്ന മെട്രോയിൽ കയറി കൊച്ചിൻ യൂണിവേഴ്സിറ്റി (CUSAT) സ്റ്റേഷനിൽ ഇറങ്ങുക.",
  },
  {
    id: "M9",
    origins: ["Aluva"],
    destinations: ["Lulu Mall", "Edapally"],
    routeOrigin: "Aluva",
    routeDestination: "Edapally",
    direction: "Southbound (Towards Tripunithura)",
    answerEn:
      "Since you are starting from Aluva, board the metro heading towards Tripunithura and get down at Edapally Metro Station. You can take the skywalk directly into Lulu Mall.",
    answerMl:
      "നിങ്ങൾ ആലുവയിൽ നിന്നാണ് യാത്ര തിരിക്കുന്നത് എന്നതിനാൽ, തൃപ്പൂണിത്തുറ ഭാഗത്തേക്കുള്ള മെട്രോയിൽ കയറി ഇടപ്പള്ളി സ്റ്റേഷനിൽ ഇറങ്ങുക. അവിടെ നിന്നും സ്കൈവാക്ക് വഴി ലുലു മാളിലേക്ക് പ്രവേശിക്കാം.",
  },
];

function normalizeDemoPlace(place: string): string {
  const cleaned = place
    .trim()
    .replace(/[’]/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+metro\s+station$/i, "")
    .replace(/\s+station$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const canonical = resolveCanonicalName(cleaned) ?? cleaned;
  return canonical
    .replace(/[’]/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesPlace(input: string, candidates: string[]): boolean {
  const normalizedInput = normalizeDemoPlace(input);
  return candidates.some((candidate) => normalizeDemoPlace(candidate) === normalizedInput);
}

function demoRouteToTransitRoute(route: DemoMetroRoute): TransitRoute {
  return {
    segments: [
      {
        mode: "metro",
        from: route.routeOrigin,
        to: route.routeDestination,
        duration: 0,
        fare: 0,
        details: route.answerEn,
        details_ml: route.answerMl,
        lineName: "Kochi Metro",
      },
    ],
    totalDuration: 0,
    totalFare: 0,
    transfers: 0,
    routeType: "demo_metro",
    provider: "demo",
    source: `Hardcoded hackathon demo route ${route.id}`,
    summary_en: route.answerEn,
    summary_ml: route.answerMl,
    notes: [`Direction: ${route.direction}`],
  };
}

export function findDemoMetroRoute(
  origin: string,
  destination: string
): TransitRoute | null {
  if (process.env.YATHRA_DEMO_METRO_ROUTES === "false") return null;

  const route = DEMO_METRO_ROUTES.find(
    (item) => matchesPlace(origin, item.origins) && matchesPlace(destination, item.destinations)
  );

  return route ? demoRouteToTransitRoute(route) : null;
}
