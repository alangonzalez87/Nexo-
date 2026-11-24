import { normalize } from "../seller/text.js";
import type { PackIntent } from "../seller.js";

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

type NamedPack = { number: number; name: string };

const nameWord = (word: string) =>
  word.length > 4 ? word.replace(/s$/, "") : word;
const choosing =
  /^(?:si )?(?:quiero|elijo|prefiero|compro|me llevo|dame|me interesa)\b/;
const choosesPack =
  /\b(?:cual (?:pack )?(?:queres|elegis|te interesa)|elegi (?:tu|un|el|entre los) pack|responde (?:con )?(?:el numero|[1-9]))\b/;
const nameQualifiers = new Set(
  "si el la los las de del completo completa entero entera pack curso opcion quiero elijo prefiero compro me llevo dame interesa por favor gracias"
    .split(" ")
    .map(nameWord),
);

export function wantsBothPacks(query: string, previousReply: string) {
  return (
    /^(?:(?:si )?(?:quiero|me llevo|elijo|dame)\s+)(?:ambos|ambas|(?:los|las) (?:dos|2))(?: packs?)?(?: por favor| gracias)?$/.test(
      query,
    ) ||
    (choosesPack.test(normalize(previousReply)) &&
      /^(?:ambos|ambas|(?:los|las) (?:dos|2))(?: packs?)?$/.test(query))
  );
}

export function namedPackIntent(
  query: string,
  packs: NamedPack[],
  previousReply: string,
): PackIntent | undefined {
  const number =
    /^(?:si )?me interesa(?: saber como)? (?:(?:el|la) )?(?:numero|opcion) ([1-9])(?: por favor| gracias)?$/.exec(
      query,
    )?.[1];
  if (number) return { intent: "choose", packNumbers: [Number(number)] };
  if (
    /\b(?:no|cuanto|precio|cuesta|sale|valor|incluye|video|videos|antes|pero|entre|si puedo|quiero saber|me interesa saber)\b/.test(
      query,
    )
  )
    return;

  const words = query.split(" ").map(nameWord);
  const candidates = packs.filter((pack) => {
    const packWords = normalize(pack.name).split(" ").map(nameWord);
    const name = packWords.filter(
      (word) =>
        word.length > 2 && !nameQualifiers.has(word) && !/^\d+$/.test(word),
    );
    return (
      name.length > 0 &&
      name.every((word) => words.includes(word)) &&
      words.every(
        (word) => packWords.includes(word) || nameQualifiers.has(word),
      )
    );
  });
  if (candidates.length !== 1) return;
  return {
    intent:
      choosing.test(query) || choosesPack.test(normalize(previousReply))
        ? "choose"
        : "price",
    packNumbers: [candidates[0].number],
  };
}
function higherPackIncludes(
  higher: { summary: string },
  lower: { number: number; name: string },
) {
  const summary = normalize(higher.summary);
  const name = normalize(lower.name);
  const references = [`pack ${lower.number}`];
  if (name.length > 5 && !/^pack [1-9]$/.test(name)) references.push(name);
  const reference = `(?:${references.join("|")})`;
  const excludesLower = new RegExp(
    `\\b(?:no incluye|no contiene|no trae|sin) (?:el |la |los |las )?${reference}\\b|\\b${reference} se vende por separado\\b`,
  );
  return (
    !excludesLower.test(summary) && new RegExp(`\\b${reference}\\b`).test(summary)
  );
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
