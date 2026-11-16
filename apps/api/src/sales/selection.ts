import { normalize } from "../seller/text.js";

export function packChoice(query: string): number[] | null {
  const prefix = "(?:(?:hola|quiero|elijo|prefiero|me interesa|me llevo|compro|dame|mandame|pasame|voy con|el|la)\\s+)*";
  const label = "(?:(?:pack|pac|pak|pal|curso|opcion|numero|nro)\\s*)?";
  const numeric = new RegExp(`^${prefix}${label}([1-9])(?:\\s*y\\s*${label}([1-9]))?(?:\\s+(?:por favor|gracias))?$`).exec(query);
  if (numeric) return [...new Set([Number(numeric[1]), ...(numeric[2] ? [Number(numeric[2])] : [])])];
  const ordinal = new RegExp(`^${prefix}(?:pack\\s+)?(primer|primero|primera|segundo|segunda|tercero|tercera)$`).exec(query);
  if (!ordinal) return null;
  return [/^(primer|primero|primera)$/.test(ordinal[1])
    ? 1
    : /^(segundo|segunda)$/.test(ordinal[1])
      ? 2
      : 3];
}
function higherPackIncludes(higher: { summary: string }, lower: { number: number; name: string }) {
  const summary = normalize(higher.summary);
  const name = normalize(lower.name);
  return new RegExp(`\\bpack ${lower.number}\\b`).test(summary) ||
    (name.length > 5 && !/^pack [1-9]$/.test(name) && (` ${summary} `).includes(` ${name} `));
}

export function resolveCampaignMatch<T extends { id: string }>(
  query: string,
  referral: { adId?: string } | undefined,
  campaigns: { code: string; adId: string | null; productId: string }[],
  products: T[],
) {
  const containsPhrase = (phrase: string) => {
    const normalized = normalize(phrase);
    return normalized && (` ${query} `).includes(` ${normalized} `);
  };
  const hits = campaigns.filter(
    (campaign) =>
      containsPhrase(campaign.code) ||
      (campaign.adId && referral?.adId === campaign.adId),
  );
  const longestTextMatch = Math.max(
    0,
    ...hits
      .filter((campaign) => containsPhrase(campaign.code))
      .map((campaign) => normalize(campaign.code).split(" ").length),
  );
  const ids = [
    ...new Set(
      hits
        .filter(
          (campaign) =>
            (campaign.adId && referral?.adId === campaign.adId) ||
            normalize(campaign.code).split(" ").length ===
              longestTextMatch,
        )
        .map((campaign) => campaign.productId),
    ),
  ];
  const routedProduct =
    ids.length === 1
      ? products.find((product) => product.id === ids[0])
      : undefined;
  return routedProduct;
}

export function resolveRequestedPacks<T extends { number: number; name: string; summary: string }>(
  packs: T[],
  requestedNumbers: number[] | null,
) {
  const requestedPacks = requestedNumbers?.map((number) => packs.find((pack) => pack.number === number));
  const validPacks = requestedPacks?.every((pack) => !!pack) ? requestedPacks as typeof packs : null;
  const highest = validPacks?.reduce((best, pack) => pack.number > best.number ? pack : best);
  const selected = highest && validPacks?.every((pack) =>
    pack.number === highest.number || higherPackIncludes(highest, pack),
  ) ? highest : undefined;
  return { validPacks, selected };
}
