import { resolveCanonicalName } from "@/lib/cache";
import type { Language, TransitRoute } from "@/types";

interface SupportRoute {
  origins: string[];
  destinations: string[];
  from: string;
  to: string;
  mode: "bus" | "water_metro";
  duration: number;
  fare: number;
  summaryEn: string;
  summaryMl: string;
}

const WATER_METRO_ROUTES: SupportRoute[] = [
  {
    origins: ["Vyttila", "Vyttila Hub"],
    destinations: ["Kakkanad"],
    from: "Vyttila Water Metro Terminal",
    to: "Kakkanad Water Metro Terminal",
    mode: "water_metro",
    duration: 25,
    fare: 30,
    summaryEn:
      "From Vyttila Metro, walk about 300 metres to Vyttila Water Metro Terminal. Take the Vyttila to Kakkanad Water Metro; boats are usually every 15 to 20 minutes, first boat around 6:30 AM and last boat around 9:00 PM. Fare is usually about ₹20 to ₹40.",
    summaryMl:
      "വൈറ്റില മെട്രോയിൽ നിന്ന് ഏകദേശം 300 മീറ്റർ നടന്ന് വൈറ്റില വാട്ടർ മെട്രോ ടെർമിനലിൽ എത്തുക. അവിടെ നിന്ന് കാക്കനാട് വാട്ടർ മെട്രോ എടുക്കാം; സാധാരണ 15 മുതൽ 20 മിനിറ്റ് ഇടവേളയിൽ ബോട്ട് ഉണ്ടാകും. ആദ്യ ബോട്ട് ഏകദേശം രാവിലെ 6:30നും അവസാന ബോട്ട് രാത്രി 9:00നും ആണ്. നിരക്ക് ഏകദേശം 20 മുതൽ 40 രൂപ വരെ.",
  },
  {
    origins: ["High Court", "High Court Jetty"],
    destinations: ["Vypin", "Fort Kochi"],
    from: "High Court Water Metro Terminal",
    to: "Vypin / Fort Kochi",
    mode: "water_metro",
    duration: 30,
    fare: 25,
    summaryEn:
      "Use the High Court Water Metro terminal for the Vypin and Fort Kochi side. Boats usually run every 20 minutes, with service from about 6:00 AM to 9:30 PM. Fare is usually around ₹20 to ₹30.",
    summaryMl:
      "വൈപ്പിൻ അല്ലെങ്കിൽ ഫോർട്ട് കൊച്ചി ഭാഗത്തേക്ക് പോകാൻ ഹൈക്കോർട്ട് വാട്ടർ മെട്രോ ടെർമിനൽ ഉപയോഗിക്കാം. സാധാരണ 20 മിനിറ്റ് ഇടവേളയിൽ ബോട്ട് ഉണ്ടാകും; സർവീസ് ഏകദേശം രാവിലെ 6:00 മുതൽ രാത്രി 9:30 വരെ. നിരക്ക് സാധാരണ 20 മുതൽ 30 രൂപ വരെ.",
  },
  {
    origins: ["Vyttila", "Vyttila Hub"],
    destinations: ["Ernakulam Boat Jetty", "Collectorate"],
    from: "Vyttila Water Metro Terminal",
    to: "Ernakulam Boat Jetty / Collectorate",
    mode: "water_metro",
    duration: 20,
    fare: 30,
    summaryEn:
      "From Vyttila Water Metro Terminal, take the boat towards Ernakulam Boat Jetty and Collectorate. Boats are usually every 20 to 30 minutes, first boat around 6:15 AM and last boat around 9:00 PM. Fare is usually about ₹20 to ₹35.",
    summaryMl:
      "വൈറ്റില വാട്ടർ മെട്രോ ടെർമിനലിൽ നിന്ന് എറണാകുളം ബോട്ട് ജെറ്റി, കലക്ടറേറ്റ് ഭാഗത്തേക്കുള്ള ബോട്ട് എടുക്കാം. സാധാരണ 20 മുതൽ 30 മിനിറ്റ് ഇടവേളയിൽ ബോട്ട് ഉണ്ടാകും; ആദ്യ ബോട്ട് ഏകദേശം രാവിലെ 6:15നും അവസാന ബോട്ട് രാത്രി 9:00നും ആണ്. നിരക്ക് ഏകദേശം 20 മുതൽ 35 രൂപ വരെ.",
  },
];

const FEEDER_BUS_ROUTES: SupportRoute[] = [
  {
    origins: ["Palarivattom"],
    destinations: ["Kakkanad", "Infopark", "Smart City"],
    from: "Palarivattom Metro",
    to: "Kakkanad / Infopark",
    mode: "bus",
    duration: 35,
    fare: 20,
    summaryEn:
      "From Palarivattom Metro, take feeder bus 101 or 102 towards Kakkanad and Infopark. Buses usually come every 10 to 12 minutes, with service roughly from 6:00 AM to 9:30 PM.",
    summaryMl:
      "പാലാരിവട്ടം മെട്രോയിൽ നിന്ന് കാക്കനാട്, ഇൻഫോപാർക്ക് ഭാഗത്തേക്ക് 101 അല്ലെങ്കിൽ 102 ഫീഡർ ബസ് എടുക്കാം. സാധാരണ 10 മുതൽ 12 മിനിറ്റ് ഇടവേളയിൽ ബസ് ഉണ്ടാകും; സർവീസ് ഏകദേശം രാവിലെ 6:00 മുതൽ രാത്രി 9:30 വരെ.",
  },
  {
    origins: ["Vyttila"],
    destinations: ["Kakkanad", "Tripunithura", "Maradu"],
    from: "Vyttila Metro / Mobility Hub",
    to: "Kakkanad / Tripunithura / Maradu",
    mode: "bus",
    duration: 35,
    fare: 20,
    summaryEn:
      "From Vyttila Metro, go to Vyttila Mobility Hub and take the KSRTC feeder connection towards Kakkanad, Tripunithura, or Maradu. Buses usually run every 10 minutes until about 10:00 PM.",
    summaryMl:
      "വൈറ്റില മെട്രോയിൽ നിന്ന് വൈറ്റില മൊബിലിറ്റി ഹബിലേക്ക് പോകുക. അവിടെ നിന്ന് കാക്കനാട്, തൃപ്പൂണിത്തുറ, മരട് ഭാഗത്തേക്കുള്ള KSRTC ഫീഡർ ബസ് കിട്ടും. സാധാരണ 10 മിനിറ്റ് ഇടവേളയിൽ ബസ് ഉണ്ടാകും; രാത്രി ഏകദേശം 10 മണിവരെ സർവീസ് ഉണ്ട്.",
  },
  {
    origins: ["MG Road"],
    destinations: ["Fort Kochi"],
    from: "MG Road Metro",
    to: "Fort Kochi",
    mode: "bus",
    duration: 40,
    fare: 20,
    summaryEn:
      "From MG Road Metro, take bus 13 or 13A towards Fort Kochi. Route 13 goes via Menaka and Boat Jetty, and 13A goes via Marine Drive. Buses usually run every 15 to 20 minutes until around 9:00 PM.",
    summaryMl:
      "എം.ജി റോഡ് മെട്രോയിൽ നിന്ന് ഫോർട്ട് കൊച്ചി ഭാഗത്തേക്ക് 13 അല്ലെങ്കിൽ 13A ബസ് എടുക്കാം. 13 ബസ് മേനക, ബോട്ട് ജെറ്റി വഴി പോകും; 13A മറൈൻ ഡ്രൈവ് വഴി പോകും. സാധാരണ 15 മുതൽ 20 മിനിറ്റ് ഇടവേളയിൽ ബസ് ഉണ്ടാകും; രാത്രി ഏകദേശം 9 മണിവരെ സർവീസ് ഉണ്ട്.",
  },
  {
    origins: ["Aluva"],
    destinations: ["Angamaly", "Perumbavoor"],
    from: "Aluva Metro / KSRTC Stand",
    to: "Angamaly / Perumbavoor",
    mode: "bus",
    duration: 35,
    fare: 25,
    summaryEn:
      "From Aluva Metro, go to Aluva KSRTC stand and take the KSRTC feeder connection towards Angamaly or Perumbavoor. Buses usually run every 15 minutes from early morning until about 10:00 PM.",
    summaryMl:
      "ആലുവ മെട്രോയിൽ നിന്ന് ആലുവ KSRTC സ്റ്റാൻഡിലേക്ക് പോകുക. അവിടെ നിന്ന് അങ്കമാലി അല്ലെങ്കിൽ പെരുമ്പാവൂർ ഭാഗത്തേക്കുള്ള KSRTC ബസ് എടുക്കാം. സാധാരണ 15 മിനിറ്റ് ഇടവേളയിൽ ബസ് ഉണ്ടാകും; രാവിലെ മുതൽ രാത്രി ഏകദേശം 10 മണിവരെ സർവീസ് ഉണ്ട്.",
  },
  {
    origins: ["Kaloor"],
    destinations: ["Medical Trust", "Kadavanthra"],
    from: "Kaloor Metro",
    to: "Medical Trust / Kadavanthra",
    mode: "bus",
    duration: 20,
    fare: 15,
    summaryEn:
      "From Kaloor Metro, take feeder bus 1 or 1A towards Medical Trust and Kadavanthra. Buses usually run every 8 to 12 minutes until around 9:30 PM.",
    summaryMl:
      "കലൂർ മെട്രോയിൽ നിന്ന് മെഡിക്കൽ ട്രസ്റ്റ്, കടവന്ത്ര ഭാഗത്തേക്ക് 1 അല്ലെങ്കിൽ 1A ഫീഡർ ബസ് എടുക്കാം. സാധാരണ 8 മുതൽ 12 മിനിറ്റ് ഇടവേളയിൽ ബസ് ഉണ്ടാകും; രാത്രി ഏകദേശം 9:30 വരെ സർവീസ് ഉണ്ട്.",
  },
];

function normalizePlace(place: string): string {
  const canonical = resolveCanonicalName(place) ?? place.trim();
  return canonical
    .replace(/[’]/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+metro(?:\s+station)?$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesPlace(input: string, candidates: string[]): boolean {
  const normalized = normalizePlace(input);
  return candidates.some((candidate) => normalizePlace(candidate) === normalized);
}

function toTransitRoute(route: SupportRoute): TransitRoute {
  return {
    segments: [
      {
        mode: route.mode,
        from: route.from,
        to: route.to,
        duration: route.duration,
        fare: route.fare,
        details: route.summaryEn,
        details_ml: route.summaryMl,
      },
    ],
    totalDuration: route.duration,
    totalFare: route.fare,
    transfers: 0,
    routeType: route.mode === "bus" ? "feeder_bus" : "water_metro",
    provider: "local",
    source: route.mode === "bus" ? "Kochi Metro feeder bus demo cache" : "Kochi Water Metro demo cache",
    summary_en: route.summaryEn,
    summary_ml: route.summaryMl,
  };
}

export function findSupportRoute(
  origin: string,
  destination: string,
  mode: "bus" | "water_metro"
): TransitRoute | null {
  const routes = mode === "bus" ? FEEDER_BUS_ROUTES : WATER_METRO_ROUTES;
  const route = routes.find(
    (item) => matchesPlace(origin, item.origins) && matchesPlace(destination, item.destinations)
  );
  return route ? toTransitRoute(route) : null;
}
