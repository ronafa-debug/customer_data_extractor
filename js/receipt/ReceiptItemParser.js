const HEADER_TERMS = {
  product: ["제품명", "품명"],
  unitPrice: ["단가"],
  quantity: ["수량"],
  total: ["금액"],
};

const PAYMENT_TERMS = ["결제금액", "공급가액", "부가세", "카드결제", "합계금액", "받을금액"];
const NON_PRODUCT_TERMS = ["사업자", "전화", "주소", "승인", "일시", "영수증", "모노마트", "제품명", "단가", "수량", "금액"];

/** @param {string} value */
function compact(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[|ㅣ]/g, "");
}

/** @param {string} productName */
export function isShippingFeeProductName(productName) {
  const normalized = String(productName || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/\((?:신규|\d+)\)/g, "")
    .replace(/\d+$/g, "")
    .replace(/[^가-힣A-Za-z]/g, "")
    .replace(/신규/g, "");
  const withoutShortOcrPrefix = normalized.replace(/^[A-Za-z]{1,3}(?=택배비|배송비)/, "");
  return withoutShortOcrPrefix === "택배비" || withoutShortOcrPrefix === "배송비";
}

/** @param {Array<{confidence?:number}>} words */
function averageConfidence(words) {
  if (!words.length) return 0;
  return words.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / words.length;
}

/** @param {string} text */
export function normalizeOcrPrice(text) {
  const compacted = String(text || "").replace(/[\s,._]/g, "");
  if (!/^\d+$/.test(compacted)) return null;
  const value = Number(compacted);
  return Number.isSafeInteger(value) ? value : null;
}

/** @param {string} text @param {string[]} terms */
function includesTerm(text, terms) {
  const value = compact(text);
  return terms.some((term) => value.includes(term));
}

/** @param {{text:string,bbox:{x0:number,y0:number,x1:number,y1:number}}} word */
function centerX(word) {
  return (word.bbox.x0 + word.bbox.x1) / 2;
}

/** @param {Array<object>} words @param {string[]} terms */
function findHeaderX(words, terms) {
  const match = words.find((word) => includesTerm(word.text, terms));
  return match ? centerX(match) : null;
}

/** @param {Array<{text:string,bbox:object,words:Array<object>}>} lines */
function findHeader(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const productX = findHeaderX(line.words, HEADER_TERMS.product);
    const unitPriceX = findHeaderX(line.words, HEADER_TERMS.unitPrice);
    const quantityX = findHeaderX(line.words, HEADER_TERMS.quantity);
    const totalX = findHeaderX(line.words, HEADER_TERMS.total);
    if (productX !== null && unitPriceX !== null && quantityX !== null && totalX !== null) {
      return { index, line, columns: { productX, unitPriceX, quantityX, totalX } };
    }
  }
  return null;
}

/** @param {object} columns */
function columnBoundaries(columns) {
  return {
    productEnd: (columns.productX + columns.unitPriceX) / 2,
    unitPriceEnd: (columns.unitPriceX + columns.quantityX) / 2,
    quantityEnd: (columns.quantityX + columns.totalX) / 2,
  };
}

/** @param {Array<object>} words */
function joinWords(words) {
  return words.map((word) => word.text.trim()).filter(Boolean).join(" ").trim();
}

/** @param {Array<object>} lines @param {Array<object>} textLines @param {number} [minimumY] */
function parseGeometricRows(lines, textLines, minimumY = 0) {
  const paymentYs = [...lines, ...textLines]
    .filter((line) => includesTerm(line.text, PAYMENT_TERMS))
    .map((line) => line.bbox.y0);
  const paymentY = paymentYs.length ? Math.min(...paymentYs) : Infinity;
  const pageRight = Math.max(1, ...lines.flatMap((line) => line.words.map((word) => word.bbox.x1)));
  const numericLines = [...lines, ...textLines]
    .filter((line) => line.bbox.y0 >= minimumY && line.bbox.y0 < paymentY)
    .sort((a, b) => {
      const yDifference = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDifference) >= 20) return yDifference;
      const numericConfidence = (line) => {
        const numericWords = line.words.filter((word) => normalizeOcrPrice(word.text) !== null);
        return averageConfidence(numericWords);
      };
      return numericConfidence(b) - numericConfidence(a);
    });
  const items = [];
  const matchedProductLines = new Set();
  const usedRows = [];
  for (const numericLine of numericLines) {
    if (usedRows.some((y) => Math.abs(y - numericLine.bbox.y0) < 20)) continue;
    const numericWords = numericLine.words
      .map((word) => ({ word, value: normalizeOcrPrice(word.text) }))
      .filter((entry) => entry.value !== null && Number(entry.word.confidence ?? 100) >= 25)
      .filter((entry) => centerX(entry.word) >= pageRight * 0.38)
      .sort((a, b) => centerX(a.word) - centerX(b.word));
    if (numericWords.length < 2) continue;
    const selected = numericWords.length >= 3 ? numericWords.slice(-3) : numericWords;
    const unitPrice = selected[0];
    const quantity = selected[1];
    const totalPrice = selected[2] || null;
    if (unitPrice.value < 100 || quantity.value < 1 || quantity.value > 100) continue;
    if (centerX(unitPrice.word) >= centerX(quantity.word)) continue;
    if (totalPrice && centerX(quantity.word) >= centerX(totalPrice.word)) continue;
    const numericCenterY = (numericLine.bbox.y0 + numericLine.bbox.y1) / 2;
    const lineHeight = Math.max(1, numericLine.bbox.y1 - numericLine.bbox.y0);
    const nearbyProducts = textLines.filter((line) => {
      if (matchedProductLines.has(line) || line.bbox.y0 < minimumY || line.bbox.y0 >= paymentY) return false;
      const lineCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
      if (lineCenterY > numericCenterY + lineHeight * 0.35 || numericCenterY - lineCenterY > lineHeight * 2.5) return false;
      if (includesTerm(line.text, PAYMENT_TERMS) || includesTerm(line.text, NON_PRODUCT_TERMS)) return false;
      const lineNumbers = line.words.filter((word) => normalizeOcrPrice(word.text) !== null);
      return lineNumbers.length < 2 && /[가-힣]/.test(line.text) && line.words.some((word) => centerX(word) < centerX(unitPrice.word));
    }).sort((a, b) => Math.abs(numericCenterY - ((a.bbox.y0 + a.bbox.y1) / 2)) - Math.abs(numericCenterY - ((b.bbox.y0 + b.bbox.y1) / 2)));
    const productLine = nearbyProducts[0];
    if (!productLine) continue;
    const productName = productLine.text.replace(/^[\d\s,]*[^A-Za-z가-힣]*/, "").replace(/[|.,·ㆍ]+$/g, "").trim();
    if (!productName || isShippingFeeProductName(productName)) continue;
    const productWords = productLine.words.filter((word) => /[가-힣A-Za-z]/.test(word.text));
    const productConfidence = averageConfidence(productWords);
    const priceConfidence = Number(unitPrice.word.confidence || 0);
    if (productConfidence < 25) continue;
    matchedProductLines.add(productLine);
    usedRows.push(numericLine.bbox.y0);
    items.push({
      productName,
      purchasePrice: unitPrice.value,
      quantity: quantity.value,
      totalPrice: totalPrice?.value ?? null,
      productConfidence,
      priceConfidence,
      reviewRequired: productConfidence < 55 || priceConfidence < 60,
      sourceText: `${productLine.text}\n${numericLine.text}`,
    });
  }
  if (!items.length) return null;
  const rows = [...lines, ...textLines].filter((line) => line.bbox.y0 >= minimumY && line.bbox.y0 < paymentY);
  return {
    items,
    table: {
      bbox: {
        x0: Math.min(...rows.map((line) => line.bbox.x0)),
        y0: Math.min(...rows.map((line) => line.bbox.y0)),
        x1: Math.max(...rows.map((line) => line.bbox.x1)),
        y1: Math.max(...rows.map((line) => line.bbox.y1)),
      },
      columns: null,
      headerText: null,
    },
    reason: null,
  };
}

/**
 * OCR line/word 좌표를 영수증 상품 행으로 변환한다.
 * @param {{text?:string,lines?:Array<{text:string,bbox:object,words:Array<{text:string,confidence?:number,bbox:{x0:number,y0:number,x1:number,y1:number}}>} >}} ocr
 */
export function parseReceiptItems(ocr) {
  const lines = Array.isArray(ocr?.lines) ? ocr.lines.filter((line) => Array.isArray(line.words) && line.words.length) : [];
  const textLines = Array.isArray(ocr?.textLines) ? ocr.textLines.filter((line) => Array.isArray(line.words) && line.words.length) : lines;
  const header = findHeader(lines);
  if (!header) {
    return parseGeometricRows(lines, textLines) || { items: [], table: null, reason: "header-not-found" };
  }

  const boundaries = columnBoundaries(header.columns);
  const tableLines = [];
  let tableBottom = header.line.bbox.y1;
  for (const line of lines.slice(header.index + 1)) {
    if (includesTerm(line.text, PAYMENT_TERMS)) break;
    tableLines.push(line);
    tableBottom = Math.max(tableBottom, line.bbox.y1);
  }

  const items = [];
  for (const line of tableLines) {
    const productWords = line.words.filter((word) => centerX(word) < boundaries.productEnd);
    const unitWords = line.words.filter((word) => {
      const x = centerX(word);
      return x >= boundaries.productEnd && x < boundaries.unitPriceEnd;
    });
    const quantityWords = line.words.filter((word) => {
      const x = centerX(word);
      return x >= boundaries.unitPriceEnd && x < boundaries.quantityEnd;
    });
    const totalWords = line.words.filter((word) => centerX(word) >= boundaries.quantityEnd);
    const productName = joinWords(productWords);
    const purchasePrice = normalizeOcrPrice(joinWords(unitWords));
    const quantity = normalizeOcrPrice(joinWords(quantityWords));
    const totalPrice = normalizeOcrPrice(joinWords(totalWords));
    if (!productName || isShippingFeeProductName(productName) || purchasePrice === null || quantity === null || totalPrice === null) continue;
    const productConfidence = averageConfidence(productWords);
    const priceConfidence = averageConfidence(unitWords);
    if (productConfidence < 25) continue;
    items.push({
      productName,
      purchasePrice,
      quantity,
      totalPrice,
      productConfidence,
      priceConfidence,
      reviewRequired: productConfidence < 55 || priceConfidence < 60,
      sourceText: line.text,
    });
  }

  if (!items.length) {
    return parseGeometricRows(lines, textLines, header.line.bbox.y1) || {
      items: [],
      table: { bbox: header.line.bbox, columns: header.columns, headerText: header.line.text },
      reason: "item-row-not-found",
    };
  }
  return {
    items,
    table: {
      bbox: {
        x0: header.line.bbox.x0,
        y0: header.line.bbox.y0,
        x1: header.line.bbox.x1,
        y1: tableBottom,
      },
      columns: header.columns,
      headerText: header.line.text,
    },
    reason: items.length ? null : "item-row-not-found",
  };
}
