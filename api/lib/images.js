/**
 * Sharp 기반 이미지 생성 규칙
 */
import sharp from "sharp";

/**
 * @param {string} name
 * @returns {string}
 */
export function sanitizeProductName(name) {
  return String(name || "상품")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * 버퍼를 정사각 PNG로 (contain + 흰 배경)
 * @param {Buffer} input
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
export async function toSquarePng(input, size) {
  return sharp(input)
    .resize(size, size, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

/**
 * 가로 고정, 세로 비율 유지
 * @param {Buffer} input
 * @param {number} width
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function resizeToWidth(input, width) {
  const image = sharp(input);
  const meta = await image.metadata();
  const srcW = meta.width || width;
  const srcH = meta.height || width;
  const height = Math.max(1, Math.round((srcH / srcW) * width));
  const buffer = await image
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  return { buffer, width, height };
}

/**
 * 이미지를 흰 캔버스 중앙에 배치
 * @param {Buffer} input
 * @param {number} canvasSize
 * @returns {Promise<Buffer>}
 */
export async function centerOnWhiteCanvas(input, canvasSize) {
  const meta = await sharp(input).metadata();
  const srcW = meta.width || canvasSize;
  const srcH = meta.height || canvasSize;

  const scale = Math.min(canvasSize / srcW, canvasSize / srcH, 1);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const resized = await sharp(input).resize(w, h, { fit: "inside" }).png().toBuffer();
  const left = Math.floor((canvasSize - w) / 2);
  const top = Math.floor((canvasSize - h) / 2);

  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
export function toBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

/**
 * 대표 이미지 캡처 버퍼에 여백을 위해 살짝 확장 후 1000 정사각
 * @param {Buffer} input
 * @returns {Promise<Buffer>}
 */
export async function buildMainImage(input) {
  const meta = await sharp(input).metadata();
  const w = meta.width || 1000;
  const h = meta.height || 1000;
  const pad = Math.round(Math.max(w, h) * 0.06);
  const padded = await sharp(input)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
  return toSquarePng(padded, 1000);
}

/**
 * '제품 스펙 총정리' 상세컷에서 포장 제품 사진만 잘라 1000×1000 PNG로 만든다.
 * (상단 TIP/타이틀 제거 → 포장 본체 bbox → 사방 균등 여백)
 * @param {Buffer} input
 * @returns {Promise<Buffer>}
 */
export async function buildSpecPackageMainImage(input) {
  const normalized = await sharp(input).rotate().toBuffer();
  const meta = await sharp(normalized).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w < 100 || h < 100) {
    return buildMainImage(normalized);
  }

  /** @type {Buffer} */
  let working = normalized;

  // 세로로 긴 스펙 배너만 TIP/타이틀 구간을 먼저 제거
  if (h > w * 1.15) {
    working = await cropTallSpecBanner(normalized);
  }

  // 스튜디오 배경 위 포장 본체만 남기고 정사각 배치 (참고 이미지와 동일 구도)
  return frameProductOnSquare(working, 1000, 0.07);
}

/**
 * 세로 스펙 배너에서 포장 구간만 잘라낸다.
 * @param {Buffer} normalized
 * @returns {Promise<Buffer>}
 */
async function cropTallSpecBanner(normalized) {
  const { data, info } = await sharp(normalized)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gw = info.width;
  const gh = info.height;

  /** @param {number} y */
  function rowAvg(y) {
    const yy = Math.max(0, Math.min(gh - 1, Math.floor(y)));
    let sum = 0;
    for (let x = 0; x < gw; x++) sum += data[yy * gw + x];
    return sum / gw;
  }

  /** @param {number} y */
  function rowStd(y) {
    const yy = Math.max(0, Math.min(gh - 1, Math.floor(y)));
    const m = rowAvg(yy);
    let sum = 0;
    for (let x = 0; x < gw; x++) {
      const v = data[yy * gw + x] - m;
      sum += v * v;
    }
    return Math.sqrt(sum / gw);
  }

  let bottom = gh - 1;
  while (bottom > Math.floor(gh * 0.55) && rowAvg(bottom) > 248) {
    bottom -= 1;
  }
  bottom = Math.min(gh - 1, bottom + Math.floor(gh * 0.012));

  /** @type {{ start: number, end: number, len: number }[]} */
  const gaps = [];
  for (let y = Math.floor(gh * 0.28); y < Math.floor(gh * 0.72); ) {
    if (rowAvg(y) <= 250 || rowStd(y) >= 4) {
      y += 1;
      continue;
    }
    let end = y;
    while (
      end < Math.floor(gh * 0.78) &&
      rowAvg(end) > 250 &&
      rowStd(end) < 4
    ) {
      end += 1;
    }
    const len = end - y;
    if (len >= 12) gaps.push({ start: y, end, len });
    y = Math.max(y + 1, end);
  }

  let top = Math.floor(gh * 0.45);
  if (gaps.length) {
    let best = gaps[gaps.length - 1];
    let bestScore = -1;
    for (const g of gaps) {
      let belowDark = 0;
      let samples = 0;
      for (let dy = 8; dy < 120; dy += 2) {
        const yy = g.end + dy;
        if (yy >= gh) break;
        belowDark += 255 - rowAvg(yy);
        samples += 1;
      }
      const score = (samples ? belowDark / samples : 0) + g.end * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    top = Math.max(0, best.end - Math.max(6, Math.floor(best.len * 0.15)));
  } else {
    let bestScore = -1;
    for (let y = Math.floor(gh * 0.34); y < Math.floor(gh * 0.64); y += 2) {
      let bright = 0;
      for (let dy = 0; dy < 8; dy++) bright += rowAvg(y + dy);
      bright /= 8;
      let belowDark = 0;
      for (let dy = 20; dy < 70; dy++) belowDark += 255 - rowAvg(y + dy);
      belowDark /= 50;
      if (bright > 230) {
        const score = bright + belowDark * 1.6;
        if (score > bestScore) {
          bestScore = score;
          top = Math.max(0, y - 12);
        }
      }
    }
  }

  top = Math.max(0, Math.min(top, gh - 80));
  bottom = Math.max(top + 80, Math.min(bottom, gh - 1));

  try {
    return await sharp(normalized)
      .extract({
        left: 0,
        top,
        width: gw,
        height: bottom - top + 1,
      })
      .toBuffer();
  } catch (err) {
    console.error("[images] tall crop fallback:", err?.message);
    return normalized;
  }
}

/**
 * 모서리 배경색을 기준으로 제품 bbox를 찾아 정사각 캔버스에 균등 여백으로 배치한다.
 * @param {Buffer} input
 * @param {number} size
 * @param {number} padRatio
 * @returns {Promise<Buffer>}
 */
async function frameProductOnSquare(input, size, padRatio = 0.08) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ch = info.channels;

  /** @param {number} x @param {number} y */
  function sample(x, y) {
    const i = (y * w + x) * ch;
    return [data[i], data[i + 1], data[i + 2]];
  }

  const corners = [
    sample(2, 2),
    sample(w - 3, 2),
    sample(2, h - 3),
    sample(w - 3, h - 3),
    sample(Math.floor(w / 2), 2),
    sample(Math.floor(w / 2), h - 3),
  ];
  const br = Math.round(corners.reduce((s, c) => s + c[0], 0) / corners.length);
  const bgc = Math.round(corners.reduce((s, c) => s + c[1], 0) / corners.length);
  const bb = Math.round(corners.reduce((s, c) => s + c[2], 0) / corners.length);
  const tol = 22;

  /** @param {number} i */
  function isBg(i) {
    return (
      Math.abs(data[i] - br) <= tol &&
      Math.abs(data[i + 1] - bgc) <= tol &&
      Math.abs(data[i + 2] - bb) <= tol
    );
  }

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let content = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (!isBg(i)) {
        content += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const bgColor = {
    r: Math.min(255, Math.max(0, br)),
    g: Math.min(255, Math.max(0, bgc)),
    b: Math.min(255, Math.max(0, bb)),
    alpha: 1,
  };

  // bbox를 못 찾으면 원본을 흰/배경 정사각에
  if (!content || maxX <= minX || maxY <= minY) {
    return placeOnSquareCanvas(input, size, padRatio, bgColor);
  }

  const padX = Math.max(4, Math.floor((maxX - minX + 1) * 0.04));
  const padY = Math.max(4, Math.floor((maxY - minY + 1) * 0.04));
  const left = Math.max(0, minX - padX);
  const top = Math.max(0, minY - padY);
  const right = Math.min(w - 1, maxX + padX);
  const bottom = Math.min(h - 1, maxY + padY);

  const cropped = await sharp(input)
    .extract({
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
    })
    .toBuffer();

  return placeOnSquareCanvas(cropped, size, padRatio, bgColor);
}

/**
 * 이미지를 정사각 캔버스 중앙에 배치 (사방 여백 비율 유지)
 * @param {Buffer} input
 * @param {number} size
 * @param {number} padRatio 한 쪽 여백 비율 (0.08 ≈ 8%)
 * @param {{ r: number, g: number, b: number, alpha?: number }} [bg]
 * @returns {Promise<Buffer>}
 */
async function placeOnSquareCanvas(
  input,
  size,
  padRatio = 0.08,
  bg = { r: 255, g: 255, b: 255, alpha: 1 }
) {
  const background = {
    r: bg.r,
    g: bg.g,
    b: bg.b,
    alpha: bg.alpha ?? 1,
  };
  const inner = Math.max(1, Math.round(size * (1 - padRatio * 2)));
  const fitted = await sharp(input)
    .resize(inner, inner, {
      fit: "contain",
      background,
    })
    .png()
    .toBuffer();

  const fm = await sharp(fitted).metadata();
  const fw = fm.width || inner;
  const fh = fm.height || inner;
  const left = Math.floor((size - fw) / 2);
  const top = Math.floor((size - fh) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: background.r, g: background.g, b: background.b },
    },
  })
    .composite([{ input: fitted, left, top }])
    .png()
    .toBuffer();
}

/**
 * 포장 완제품샷(병·팩·박스 라벨)에 가까울수록 높은 점수.
 * 소스 그릇·음식 연출·라이프스타일컷은 낮게 나온다.
 * @param {Buffer} input
 * @returns {Promise<number>}
 */
export async function scorePackageShot(input) {
  try {
    const meta = await sharp(input).rotate().metadata();
    const w = meta.width || 1;
    const h = meta.height || 1;

    const { data, info } = await sharp(input)
      .rotate()
      .resize(160, 160, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const cw = info.width;
    const ch = info.height;
    /** @param {number} x @param {number} y */
    function at(x, y) {
      const xx = Math.max(0, Math.min(cw - 1, x));
      const yy = Math.max(0, Math.min(ch - 1, y));
      const i = (yy * cw + xx) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    }

    const corners = [
      at(1, 1),
      at(cw - 2, 1),
      at(1, ch - 2),
      at(cw - 2, ch - 2),
    ];
    const br = corners.reduce((s, c) => s + c[0], 0) / 4;
    const bgc = corners.reduce((s, c) => s + c[1], 0) / 4;
    const bb = corners.reduce((s, c) => s + c[2], 0) / 4;

    let cornerVar = 0;
    for (const c of corners) {
      cornerVar +=
        Math.abs(c[0] - br) + Math.abs(c[1] - bgc) + Math.abs(c[2] - bb);
    }
    cornerVar /= 12;
    const cornerBright = (br + bgc + bb) / 3;

    let sat = 0;
    let bgCount = 0;
    const total = cw * ch;
    const tol = 22;
    let minX = cw;
    let minY = ch;
    let maxX = 0;
    let maxY = 0;
    /** @type {Uint8Array} */
    const isFg = new Uint8Array(total);

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 3;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        sat += max - min;
        const bgLike =
          Math.abs(r - br) <= tol &&
          Math.abs(g - bgc) <= tol &&
          Math.abs(b - bb) <= tol;
        if (bgLike) {
          bgCount += 1;
        } else {
          isFg[y * cw + x] = 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    sat /= total;
    const bgRatio = bgCount / total;
    if (maxX < minX || maxY < minY) return 0;

    const contentW = Math.max(1, maxX - minX + 1);
    const contentH = Math.max(1, maxY - minY + 1);
    const fill = (contentW * contentH) / total;
    const contentAspect = contentH / contentW;

    // —— 가로 라벨 띠: 포장 라벨은 행 평균색이 갑자기 바뀌는 구간이 많음 ——
    let bandTransitions = 0;
    /** @type {number[]} */
    const rowLuma = [];
    /** @type {number[]} */
    const rowHueProxy = [];
    for (let y = minY; y <= maxY; y++) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let n = 0;
      for (let x = minX; x <= maxX; x++) {
        if (!isFg[y * cw + x]) continue;
        const i = (y * cw + x) * 3;
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        n += 1;
      }
      if (n < 2) {
        rowLuma.push(rowLuma.length ? rowLuma[rowLuma.length - 1] : 128);
        rowHueProxy.push(0);
        continue;
      }
      const ar = sumR / n;
      const ag = sumG / n;
      const ab = sumB / n;
      rowLuma.push((ar + ag + ab) / 3);
      rowHueProxy.push(ar - ab);
    }
    for (let i = 1; i < rowLuma.length; i++) {
      const dL = Math.abs(rowLuma[i] - rowLuma[i - 1]);
      const dH = Math.abs(rowHueProxy[i] - rowHueProxy[i - 1]);
      if (dL > 18 || dH > 22) bandTransitions += 1;
    }
    const bandDensity =
      rowLuma.length > 0 ? bandTransitions / rowLuma.length : 0;

    // —— 중앙 텍스처: 소스·음식은 국소 분산이 크고, 병은 상대적으로 매끈 ——
    let texSum = 0;
    let texN = 0;
    const cx0 = minX + Math.floor(contentW * 0.2);
    const cx1 = minX + Math.floor(contentW * 0.8);
    const cy0 = minY + Math.floor(contentH * 0.25);
    const cy1 = minY + Math.floor(contentH * 0.75);
    for (let y = cy0; y < cy1; y++) {
      for (let x = cx0; x < cx1; x++) {
        if (!isFg[y * cw + x]) continue;
        const [r, g, b] = at(x, y);
        const [r2, g2, b2] = at(x + 1, y);
        const [r3, g3, b3] = at(x, y + 1);
        texSum +=
          Math.abs(r - r2) +
          Math.abs(g - g2) +
          Math.abs(b - b2) +
          Math.abs(r - r3) +
          Math.abs(g - g3) +
          Math.abs(b - b3);
        texN += 1;
      }
    }
    const texture = texN > 0 ? texSum / texN / 6 : 0;

    // —— 음식색(적갈·주황 소스) 비율 ——
    let foodish = 0;
    let fgN = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!isFg[y * cw + x]) continue;
        fgN += 1;
        const i = (y * cw + x) * 3;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const satPx = max - min;
        // 적갈·주황 계열 + 중간 밝기 = 소스/음식 톤
        if (
          satPx > 35 &&
          r > g + 8 &&
          r > b + 15 &&
          r > 70 &&
          r < 220 &&
          g > 30 &&
          g < 160
        ) {
          foodish += 1;
        }
      }
    }
    const foodRatio = fgN > 0 ? foodish / fgN : 0;

    // —— 세로 실루엣 폭 변화: 병은 허리/캡으로 폭이 변하고, 그릇은 하단이 넓음 ——
    /** @type {number[]} */
    const rowWidths = [];
    for (let y = minY; y <= maxY; y++) {
      let left = -1;
      let right = -1;
      for (let x = minX; x <= maxX; x++) {
        if (!isFg[y * cw + x]) continue;
        if (left < 0) left = x;
        right = x;
      }
      rowWidths.push(left < 0 ? 0 : right - left + 1);
    }
    const midW = rowWidths[Math.floor(rowWidths.length * 0.45)] || 1;
    const botW = rowWidths[Math.floor(rowWidths.length * 0.85)] || 1;
    const topW = rowWidths[Math.floor(rowWidths.length * 0.12)] || 1;
    const bowlFlare = botW / Math.max(1, midW);
    const topNarrow = topW / Math.max(1, midW);

    let score = 0;
    if (cornerBright > 200 && cornerVar < 12) score += 35;
    else if (cornerBright > 180 && cornerVar < 25) score += 18;
    if (bgRatio > 0.35 && bgRatio < 0.88) score += 20;
    if (fill > 0.1 && fill < 0.6) score += 18;
    if (sat < 28) score += 10;
    if (sat > 50) score -= 18;

    // 세로로 긴 포장(병·팩) 가점 / 둥근·넓은 피사체(그릇·접시) 감점
    if (contentAspect >= 1.45) score += 35;
    else if (contentAspect >= 1.2) score += 22;
    else if (contentAspect >= 1.05) score += 8;
    else if (contentAspect <= 0.95) score -= 28;
    else score -= 12;

    // 라벨 띠(색 구간 전환) — 완제품 라벨 신호
    if (bandDensity >= 0.12) score += 30;
    else if (bandDensity >= 0.07) score += 18;
    else if (bandDensity < 0.035) score -= 15;

    // 고텍스처 + 둥근 구도 = 음식 연출
    if (texture > 14 && contentAspect < 1.15) score -= 35;
    else if (texture > 18) score -= 18;
    else if (texture < 8 && contentAspect >= 1.15) score += 12;

    // 소스색 비율이 높고 세로비가 낮으면 음식컷
    if (foodRatio > 0.35 && contentAspect < 1.2) score -= 40;
    else if (foodRatio > 0.25 && contentAspect < 1.25) score -= 25;
    else if (foodRatio > 0.45) score -= 15;

    // 하단이 확 넓어지는 그릇형 실루엣
    if (bowlFlare > 1.35 && contentAspect < 1.25) score -= 25;
    // 상단이 좁은 병형
    if (topNarrow < 0.75 && contentAspect >= 1.2) score += 12;

    const ratio = h / w;
    if (ratio < 0.45 || ratio > 3.2) score -= 20;

    return score;
  } catch {
    return 0;
  }
}

/**
 * 소스 그릇·음식 연출처럼 보이면 true (대표이미지 후보에서 배제용)
 * @param {Buffer} input
 * @returns {Promise<boolean>}
 */
export async function looksLikeFoodPresentation(input) {
  const score = await scorePackageShot(input);
  return score < 45;
}

/**
 * 교환/환불·고객센터 안내 같은 정책 배너인지 대략 판별한다.
 * (포장 제품 사진은 중간톤·라벨색이 있어 흰 배경만인 안내 이미지와 구분된다)
 * @param {Buffer} input
 * @returns {Promise<boolean>}
 */
export async function looksLikePolicyBanner(input) {
  try {
    const meta = await sharp(input).rotate().metadata();
    const w = meta.width || 1;
    const h = meta.height || 1;
    if (h / w > 3.8) return true;

    const { data, info } = await sharp(input)
      .rotate()
      .resize(100, 140, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let white = 0;
    let yellow = 0;
    let teal = 0;
    let midTone = 0;
    let saturated = 0;
    const total = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 235 && g > 235 && b > 235) white += 1;
      if (r > 220 && g > 200 && b < 120) yellow += 1;
      if (b > 120 && g > 140 && r < 100 && g > r + 30) teal += 1;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const avg = (r + g + b) / 3;
      if (avg > 40 && avg < 220) midTone += 1;
      if (max - min > 35 && avg > 50 && avg < 230) saturated += 1;
    }

    const whiteRatio = white / total;
    const yellowRatio = yellow / total;
    const tealRatio = teal / total;
    const midRatio = midTone / total;
    const satRatio = saturated / total;

    if (
      whiteRatio > 0.55 &&
      (yellowRatio > 0.008 || tealRatio > 0.01) &&
      satRatio < 0.12
    ) {
      return true;
    }
    if (whiteRatio > 0.78 && h / w > 2.0) return true;
    if (whiteRatio > 0.86 && midRatio < 0.18 && satRatio < 0.06) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
