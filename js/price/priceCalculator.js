/** @param {number} value */
export function ceilToTenWon(value) {
  return Math.ceil(Number(value) / 10) * 10;
}

/** @param {number|string} purchasePrice */
export function calculateMarketplacePrices(purchasePrice) {
  const amount = Number(String(purchasePrice).replace(/[,₩원\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { naverPrice: 0, coupangPrice: 0 };
  }
  return {
    naverPrice: ceilToTenWon(amount * 1.15),
    coupangPrice: ceilToTenWon(amount * 1.25),
  };
}
