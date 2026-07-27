/**
 * StatisticsService — 통계 계산
 */

/**
 * @param {import('../model/Customer.js').Customer[]} customers
 * @returns {{
 *   totalCustomers: number,
 *   totalProductKinds: number,
 *   totalQuantity: number,
 *   messageCount: number
 * }}
 */
export function calculateStatistics(customers) {
  const list = customers || [];
  const productNames = new Set();
  let totalQuantity = 0;
  let messageCount = 0;

  for (const customer of list) {
    if (String(customer.deliveryMessage || "").trim()) {
      messageCount += 1;
    }
    for (const product of customer.products || []) {
      const name = String(product.name || "").trim();
      if (name) productNames.add(name);
      const qty = Number(product.quantity);
      totalQuantity += Number.isFinite(qty) ? qty : 0;
    }
  }

  return {
    totalCustomers: list.length,
    totalProductKinds: productNames.size,
    totalQuantity,
    messageCount,
  };
}

export const StatisticsService = {
  calculateStatistics,
};
