/**
 * Verun · Market price oracle
 * ──────────────────────────────────────────────────────────────────────────
 * Provides current USD spot prices for native tokens (HBAR, XLM, USDC)
 * so x402 paymentRequirements can quote a USD-stable target (e.g. $0.005)
 * regardless of the native token's market value at any given moment.
 *
 * Source: CoinGecko free public API (no auth required for /simple/price).
 * Cache:  5-minute TTL in-process memory (cheap + acceptable jitter).
 * Fallback: hardcoded last-known approximations if oracle is unreachable.
 *
 * Override via env to skip the oracle entirely:
 *   X402_PRICE_HBAR_USD=0.10  → forces HBAR price assumption
 *   X402_PRICE_XLM_USD=0.40   → forces XLM  price assumption
 */

const CACHE_TTL_MS = Number(process.env.PRICE_ORACLE_TTL_MS || 5 * 60 * 1000); // 5 min
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';

const SYMBOL_TO_ID = {
  HBAR: 'hedera-hashgraph',
  XLM:  'stellar',
  USDC: 'usd-coin',
};

// Hard fallbacks if oracle is unreachable AND no env override exists.
// Update periodically — these are loose floors, not guarantees.
const FALLBACK_USD = {
  HBAR: 0.10,
  XLM:  0.40,
  USDC: 1.00,
};

const cache = new Map();

const fetchFn = globalThis.fetch ? globalThis.fetch.bind(globalThis) : require('node-fetch');

async function getPriceUSD(symbol) {
  const upper = String(symbol || '').toUpperCase();

  // 1) Env override wins
  const envKey = `X402_PRICE_${upper}_USD`;
  if (process.env[envKey]) {
    const v = Number(process.env[envKey]);
    if (Number.isFinite(v) && v > 0) return v;
  }

  // 2) USDC is pegged 1:1 — no lookup
  if (upper === 'USDC') return 1.0;

  // 3) Cache hit
  const cached = cache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.priceUSD;
  }

  const cgId = SYMBOL_TO_ID[upper];
  if (!cgId) {
    // Unknown symbol → use fallback if present
    return FALLBACK_USD[upper] || 0;
  }

  // 4) Fetch live from CoinGecko
  try {
    const url = `${COINGECKO}?ids=${cgId}&vs_currencies=usd`;
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
    const data = await r.json();
    const priceUSD = data?.[cgId]?.usd;
    if (typeof priceUSD !== 'number' || !Number.isFinite(priceUSD) || priceUSD <= 0) {
      throw new Error(`No USD price in response for ${upper}`);
    }
    cache.set(upper, { priceUSD, fetchedAt: Date.now() });
    return priceUSD;
  } catch (e) {
    // 5) Stale cache fallback (better than nothing)
    if (cached) {
      return cached.priceUSD;
    }
    // 6) Hard fallback
    return FALLBACK_USD[upper] || 0;
  }
}

/**
 * Convert a USD target amount into the corresponding native-token amount
 * at the current market rate. Returns a Number (full precision).
 *
 *   convertUSDtoNative(0.005, 'HBAR')  →  0.05  (if HBAR = $0.10)
 *   convertUSDtoNative(0.005, 'XLM')   →  0.0125 (if XLM = $0.40)
 *   convertUSDtoNative(0.005, 'USDC')  →  0.005
 */
async function convertUSDtoNative(amountUSD, symbol) {
  const priceUSD = await getPriceUSD(symbol);
  if (!priceUSD || priceUSD <= 0) return amountUSD; // fallback equal
  return Number(amountUSD) / priceUSD;
}

module.exports = {
  getPriceUSD,
  convertUSDtoNative,
  SYMBOL_TO_ID,
  FALLBACK_USD,
};
