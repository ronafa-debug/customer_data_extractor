const MAX_DETECTION_EDGE = 1400;
const MAX_CROP_EDGE = 2400;
const MIN_AREA_RATIO = 0.004;
const MAX_AREA_RATIO = 0.7;

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * OCR용 crop은 표시용 crop보다 작은 비율만큼 넓혀 가장자리 글자를 보존한다.
 * @param {Array<{x:number,y:number}>} corners
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {number} [horizontalRatio]
 * @param {number} [verticalRatio]
 */
export function expandReceiptCorners(corners, imageWidth, imageHeight, horizontalRatio = 0.035, verticalRatio = 0.015) {
  const centerX = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
  const centerY = corners.reduce((sum, point) => sum + point.y, 0) / corners.length;
  return corners.map((point) => ({
    x: clamp(centerX + (point.x - centerX) * (1 + horizontalRatio * 2), 0, imageWidth - 1),
    y: clamp(centerY + (point.y - centerY) * (1 + verticalRatio * 2), 0, imageHeight - 1),
  }));
}

/** @param {Uint8ClampedArray} pixels */
function toGray(pixels) {
  const gray = new Uint8Array(pixels.length / 4);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
  }
  return gray;
}

/** @param {Uint8Array} gray */
function otsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  let totalSum = 0;
  for (let i = 0; i < 256; i += 1) totalSum += i * histogram[i];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 180;
  for (let i = 0; i < 256; i += 1) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = gray.length - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = i;
    }
  }
  return clamp(threshold + 10, 145, 225);
}

/** @param {Uint8Array} values @param {number} ratio */
function percentile(values, ratio) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  const target = values.length * ratio;
  let count = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];
    if (count >= target) return value;
  }
  return 255;
}

/** @param {Uint8Array} values @param {number} width @param {number} height */
function integralImage(values, width, height) {
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += values[(y - 1) * width + x - 1];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum;
    }
  }
  return integral;
}

/** @param {Uint8Array} gray @param {number} width @param {number} height */
function adaptiveInkMask(gray, width, height) {
  const radius = Math.max(8, Math.round(Math.min(width, height) * 0.011));
  const minimumLocalMean = percentile(gray, 0.3);
  const integral = integralImage(gray, width, height);
  const stride = width + 1;
  const mask = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(width - 1, x + radius);
      const y1 = Math.min(height - 1, y + radius);
      const sum = integral[(y1 + 1) * stride + x1 + 1] - integral[y0 * stride + x1 + 1] - integral[(y1 + 1) * stride + x0] + integral[y0 * stride + x0];
      const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
      mask[y * width + x] = mean >= minimumLocalMean && gray[y * width + x] < mean - 9 ? 1 : 0;
    }
  }
  return mask;
}

/** @param {Float64Array} values @param {number} radius */
function smoothProjection(values, radius) {
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i += 1) prefix[i + 1] = prefix[i] + values[i];
  const output = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    output[i] = (prefix[end + 1] - prefix[start]) / (end - start + 1);
  }
  return output;
}

/** @param {Float64Array} values @param {number} threshold @param {number} mergeGap @param {number} minLength */
function projectionRuns(values, threshold, mergeGap, minLength) {
  const raw = [];
  let start = -1;
  for (let i = 0; i <= values.length; i += 1) {
    if (i < values.length && values[i] >= threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      raw.push([start, i - 1]);
      start = -1;
    }
  }
  const merged = [];
  for (const run of raw) {
    const previous = merged[merged.length - 1];
    if (previous && run[0] - previous[1] - 1 <= mergeGap) previous[1] = run[1];
    else merged.push(run);
  }
  return merged.filter(([from, to]) => to - from + 1 >= minLength);
}

/** @param {Array<[number, number]>} bands */
function mergeNarrowProjectionBands(bands) {
  if (bands.length < 2) return bands;
  const widths = bands.map(([left, right]) => right - left + 1).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)];
  const narrowLimit = median * 0.65;
  const merged = [];
  for (let index = 0; index < bands.length; index += 1) {
    const current = bands[index];
    const next = bands[index + 1];
    if (!next) {
      merged.push([...current]);
      continue;
    }
    const currentWidth = current[1] - current[0] + 1;
    const nextWidth = next[1] - next[0] + 1;
    const gap = next[0] - current[1] - 1;
    const bothNarrow = currentWidth < narrowLimit && nextWidth < narrowLimit;
    const edgeFragment = (index === 0 && currentWidth < narrowLimit)
      || (index + 1 === bands.length - 1 && nextWidth < narrowLimit);
    if ((bothNarrow || edgeFragment) && gap <= median * 0.2) {
      merged.push([current[0], next[1]]);
      index += 1;
    } else {
      merged.push([...current]);
    }
  }
  return merged;
}

/** @param {Uint8Array} gray @param {number} width @param {number} height @param {object} stats @param {Array<object>} debugComponents */
function findTextLayoutCandidates(gray, width, height, stats, debugComponents) {
  const ink = adaptiveInkMask(gray, width, height);
  const rowCounts = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) count += ink[y * width + x];
    rowCounts[y] = count;
  }
  const smoothedRows = smoothProjection(rowCounts, Math.max(6, Math.round(height * 0.01)));
  const maxRow = Math.max(...smoothedRows);
  if (!maxRow) return [];
  const rowBands = projectionRuns(smoothedRows, maxRow * 0.55, Math.round(height * 0.02), Math.round(height * 0.07));
  const overall = projectionRuns(smoothedRows, maxRow * 0.08, Math.round(height * 0.035), Math.round(height * 0.1));
  if (!rowBands.length) return [];

  const top = Math.max(0, (overall[0]?.[0] ?? rowBands[0][0]) - Math.round(height * 0.03));
  const bottom = Math.min(height - 1, (overall[overall.length - 1]?.[1] ?? rowBands[rowBands.length - 1][1]) + Math.round(height * 0.08));
  const rowBoundaries = [top];
  for (let i = 0; i < rowBands.length - 1; i += 1) rowBoundaries.push(Math.round((rowBands[i][1] + rowBands[i + 1][0]) / 2));
  rowBoundaries.push(bottom);

  const candidates = [];
  stats.textColumnBands = [];
  rowBands.forEach(([bandTop, bandBottom], rowIndex) => {
    const columnCounts = new Float64Array(width);
    for (let y = bandTop; y <= bandBottom; y += 1) {
      for (let x = 0; x < width; x += 1) columnCounts[x] += ink[y * width + x];
    }
    const smoothedColumns = smoothProjection(columnCounts, Math.max(2, Math.round(width * 0.004)));
    const maxColumn = Math.max(...smoothedColumns);
    const columnBands = mergeNarrowProjectionBands(
      projectionRuns(smoothedColumns, maxColumn * 0.25, Math.round(width * 0.008), Math.round(width * 0.03))
    );
    stats.textColumnBands.push(columnBands.map(([left, right]) => [left, right]));
    if (!columnBands.length) return;
    const medianWidth = [...columnBands].map(([left, right]) => right - left + 1).sort((a, b) => a - b)[Math.floor(columnBands.length / 2)];
    const xBoundaries = [Math.max(0, columnBands[0][0] - Math.round(medianWidth * 0.35))];
    for (let i = 0; i < columnBands.length - 1; i += 1) xBoundaries.push(Math.round((columnBands[i][1] + columnBands[i + 1][0]) / 2));
    xBoundaries.push(Math.min(width - 1, columnBands[columnBands.length - 1][1] + Math.round(medianWidth * 0.35)));

    columnBands.forEach((_, columnIndex) => {
      const left = xBoundaries[columnIndex];
      const right = xBoundaries[columnIndex + 1];
      const candidateTop = rowBoundaries[rowIndex];
      const candidateBottom = rowBoundaries[rowIndex + 1];
      const box = { x: left, y: candidateTop, width: right - left + 1, height: candidateBottom - candidateTop + 1 };
      const corners = [
        { x: left, y: candidateTop },
        { x: right, y: candidateTop },
        { x: right, y: candidateBottom },
        { x: left, y: candidateBottom },
      ];
      const candidate = {
        area: box.width * box.height,
        box,
        corners,
        centerX: left + box.width / 2,
        centerY: candidateTop + box.height / 2,
      };
      candidates.push(candidate);
      debugComponents.push({ ...candidate, stage: "text-layout" });
    });
  });
  stats.textRows = rowBands.length;
  stats.textLayoutCandidates = candidates.length;
  return sortReceiptCandidates(removeDuplicateReceiptCandidates(candidates));
}

/** @param {Uint8Array} mask @param {number} width @param {number} height */
function closeMask(mask, width, height) {
  const dilated = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      dilated[i] = mask[i] || mask[i - 1] || mask[i + 1] || mask[i - width] || mask[i + width] ? 1 : 0;
    }
  }
  const closed = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      closed[i] = dilated[i] && dilated[i - 1] && dilated[i + 1] && dilated[i - width] && dilated[i + width] ? 1 : 0;
    }
  }
  return closed;
}

/** @param {{x:number,y:number}} a @param {{x:number,y:number}} b */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** @param {Array<{x:number,y:number}>} corners */
function polygonArea(corners) {
  let area = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const next = corners[(i + 1) % corners.length];
    area += corners[i].x * next.y - next.x * corners[i].y;
  }
  return Math.abs(area) / 2;
}

/** @param {{box:{x:number,y:number,width:number,height:number}}} a @param {typeof a} b */
function intersectionOverUnion(a, b) {
  const left = Math.max(a.box.x, b.box.x);
  const top = Math.max(a.box.y, b.box.y);
  const right = Math.min(a.box.x + a.box.width, b.box.x + b.box.width);
  const bottom = Math.min(a.box.y + a.box.height, b.box.y + b.box.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.box.width * a.box.height + b.box.width * b.box.height - intersection;
  return union ? intersection / union : 0;
}

/**
 * 겹치는 후보는 더 큰 후보 하나만 남긴다.
 * @param {Array<object>} candidates
 */
export function removeDuplicateReceiptCandidates(candidates) {
  const selected = [];
  for (const candidate of [...candidates].sort((a, b) => b.area - a.area)) {
    if (!selected.some((item) => intersectionOverUnion(item, candidate) > 0.45)) {
      selected.push(candidate);
    }
  }
  return selected;
}

/**
 * 위에서 아래로 행을 나누고, 각 행은 왼쪽에서 오른쪽으로 정렬한다.
 * @param {Array<object>} candidates
 */
export function sortReceiptCandidates(candidates) {
  const rows = [];
  for (const candidate of [...candidates].sort((a, b) => a.centerY - b.centerY)) {
    const row = rows.find((item) => Math.abs(item.centerY - candidate.centerY) <= Math.min(item.height, candidate.box.height) * 0.45);
    if (row) {
      row.items.push(candidate);
      row.centerY = row.items.reduce((sum, item) => sum + item.centerY, 0) / row.items.length;
      row.height = Math.max(row.height, candidate.box.height);
    } else {
      rows.push({ centerY: candidate.centerY, height: candidate.box.height, items: [candidate] });
    }
  }
  return rows.sort((a, b) => a.centerY - b.centerY).flatMap((row) => row.items.sort((a, b) => a.centerX - b.centerX));
}

/** @param {{area:number,imageArea:number,fillRatio:number,quadArea:number,aspect:number,boxWidth:number,boxHeight:number,imageWidth:number,imageHeight:number}} geometry */
export function isReceiptCandidateGeometry(geometry) {
  const areaRatio = geometry.area / geometry.imageArea;
  return areaRatio >= MIN_AREA_RATIO &&
    areaRatio <= MAX_AREA_RATIO &&
    geometry.fillRatio >= 0.42 &&
    geometry.quadArea >= geometry.imageArea * MIN_AREA_RATIO &&
    geometry.aspect <= 9 &&
    geometry.boxWidth >= geometry.imageWidth * 0.04 &&
    geometry.boxHeight >= geometry.imageHeight * 0.06;
}

/** @param {Uint8Array} mask @param {number} width @param {number} height */
function findCandidates(mask, width, height, stats, debugComponents) {
  const queue = new Uint32Array(mask.length);
  const imageArea = width * height;
  const candidates = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    mask[start] = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let tl = { value: Infinity, x: 0, y: 0 };
    let br = { value: -Infinity, x: 0, y: 0 };
    let tr = { value: -Infinity, x: 0, y: 0 };
    let bl = { value: Infinity, x: 0, y: 0 };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.value) tl = { value: sum, x, y };
      if (sum > br.value) br = { value: sum, x, y };
      if (diff > tr.value) tr = { value: diff, x, y };
      if (diff < bl.value) bl = { value: diff, x, y };
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= mask.length || !mask[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        mask[next] = 0;
        queue[tail++] = next;
      }
    }
    const areaRatio = area / imageArea;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const fillRatio = area / (boxWidth * boxHeight);
    const corners = [tl, tr, br, bl].map(({ x, y }) => ({ x, y }));
    const quadArea = polygonArea(corners);
    const longEdge = Math.max(distance(corners[0], corners[1]), distance(corners[1], corners[2]));
    const shortEdge = Math.max(1, Math.min(distance(corners[0], corners[1]), distance(corners[1], corners[2])));
    const aspect = longEdge / shortEdge;
    stats.connectedComponents += 1;
    const debugCandidate = {
      area,
      corners,
      box: { x: minX, y: minY, width: boxWidth, height: boxHeight },
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      stage: "component",
    };
    if (area / imageArea >= 0.0005) debugComponents.push(debugCandidate);
    if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO || boxWidth < width * 0.04 || boxHeight < height * 0.06) continue;
    stats.afterArea += 1;
    debugCandidate.stage = "area";
    if (aspect > 9) continue;
    stats.afterAspect += 1;
    debugCandidate.stage = "aspect";
    if (fillRatio < 0.42 || quadArea < imageArea * MIN_AREA_RATIO) continue;
    stats.afterDensity += 1;
    debugCandidate.stage = "density";
    candidates.push({
      area,
      corners,
      box: { x: minX, y: minY, width: boxWidth, height: boxHeight },
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    });
  }
  const unique = removeDuplicateReceiptCandidates(candidates);
  stats.afterDeduplication = unique.length;
  return sortReceiptCandidates(unique);
}

/** @param {HTMLCanvasElement} source @param {Array<object>} components @param {Array<object>} selected */
async function createDebugOverlay(source, components, selected) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);
  context.lineWidth = Math.max(2, Math.round(canvas.width / 700));
  context.font = `bold ${Math.max(16, Math.round(canvas.width / 55))}px sans-serif`;
  for (const candidate of components) {
    context.strokeStyle = candidate.stage === "component" ? "#ffb000" : candidate.stage === "area" ? "#ff5c5c" : "#28a7ff";
    context.strokeRect(candidate.box.x, candidate.box.y, candidate.box.width, candidate.box.height);
  }
  selected.forEach((candidate, index) => {
    context.strokeStyle = "#00d46a";
    context.fillStyle = "#00a950";
    context.beginPath();
    candidate.corners.forEach((point, pointIndex) => pointIndex ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.stroke();
    context.fillText(String(index + 1), candidate.box.x + 6, candidate.box.y + 24);
  });
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("디버그 이미지를 만들 수 없습니다.")), "image/jpeg", 0.9));
  return { blob, url: URL.createObjectURL(blob) };
}

/** @param {number[][]} matrix @param {number[]} values */
function solve(matrix, values) {
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let column = 0; column < rows.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-9) throw new Error("영수증 모서리를 보정할 수 없습니다.");
    for (let i = column; i <= rows.length; i += 1) rows[column][i] /= divisor;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let i = column; i <= rows.length; i += 1) rows[row][i] -= factor * rows[column][i];
    }
  }
  return rows.map((row) => row[rows.length]);
}

/** @param {Array<{x:number,y:number}>} corners @param {number} width @param {number} height */
function destinationToSource(corners, width, height) {
  const destinations = [{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }];
  const matrix = [];
  const values = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = destinations[i];
    const source = corners[i];
    matrix.push([x, y, 1, 0, 0, 0, -source.x * x, -source.x * y]); values.push(source.x);
    matrix.push([0, 0, 0, x, y, 1, -source.y * x, -source.y * y]); values.push(source.y);
  }
  return solve(matrix, values);
}

/** @param {HTMLCanvasElement} sourceCanvas @param {Array<{x:number,y:number}>} corners */
async function perspectiveCrop(sourceCanvas, source, corners) {
  let width = Math.round(Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2])));
  let height = Math.round(Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2])));
  const scale = Math.min(1, MAX_CROP_EDGE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const transform = destinationToSource(corners, width, height);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = outputCanvas.getContext("2d");
  const output = outputContext.createImageData(width, height);
  const [a, b, c, d, e, f, g, h] = transform;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = g * x + h * y + 1;
      const sx = clamp(Math.round((a * x + b * y + c) / denominator), 0, sourceCanvas.width - 1);
      const sy = clamp(Math.round((d * x + e * y + f) / denominator), 0, sourceCanvas.height - 1);
      const sourceIndex = (sy * sourceCanvas.width + sx) * 4;
      const outputIndex = (y * width + x) * 4;
      output.data[outputIndex] = source.data[sourceIndex];
      output.data[outputIndex + 1] = source.data[sourceIndex + 1];
      output.data[outputIndex + 2] = source.data[sourceIndex + 2];
      output.data[outputIndex + 3] = 255;
    }
  }
  outputContext.putImageData(output, 0, 0);
  const blob = await new Promise((resolve, reject) => outputCanvas.toBlob((value) => value ? resolve(value) : reject(new Error("영수증 이미지를 만들 수 없습니다.")), "image/jpeg", 0.94));
  return { blob, url: URL.createObjectURL(blob), width, height };
}

/**
 * @param {File} file
 * @param {{ onProgress?: (message:string) => void }} [options]
 */
export async function detectReceipts(file, { onProgress, debug = false } = {}) {
  if (!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해주세요.");
  onProgress?.("영수증을 인식하고 있습니다…");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const detectionScale = Math.min(1, MAX_DETECTION_EDGE / Math.max(bitmap.width, bitmap.height));
    const detectionWidth = Math.max(1, Math.round(bitmap.width * detectionScale));
    const detectionHeight = Math.max(1, Math.round(bitmap.height * detectionScale));
    const detectionCanvas = document.createElement("canvas");
    detectionCanvas.width = detectionWidth;
    detectionCanvas.height = detectionHeight;
    const detectionContext = detectionCanvas.getContext("2d", { willReadFrequently: true });
    detectionContext.filter = "blur(1px)";
    detectionContext.drawImage(bitmap, 0, 0, detectionWidth, detectionHeight);
    detectionContext.filter = "none";
    const gray = toGray(detectionContext.getImageData(0, 0, detectionWidth, detectionHeight).data);
    const threshold = otsuThreshold(gray);
    const mask = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i += 1) mask[i] = gray[i] >= threshold ? 1 : 0;
    const foregroundPixels = mask.reduce((sum, value) => sum + value, 0);
    const stats = {
      originalSize: { width: bitmap.width, height: bitmap.height },
      detectionSize: { width: detectionWidth, height: detectionHeight },
      threshold,
      foregroundRatio: foregroundPixels / mask.length,
      connectedComponents: 0,
      afterArea: 0,
      afterAspect: 0,
      afterDensity: 0,
      afterDeduplication: 0,
    };
    const debugComponents = [];
    const brightCandidates = findCandidates(closeMask(mask, detectionWidth, detectionHeight), detectionWidth, detectionHeight, stats, debugComponents);
    const candidates = brightCandidates.length
      ? brightCandidates
      : findTextLayoutCandidates(gray, detectionWidth, detectionHeight, stats, debugComponents);
    stats.detector = brightCandidates.length ? "bright-paper" : "adaptive-ink-layout";
    stats.finalCandidates = candidates.length;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;
    sourceCanvas.getContext("2d").drawImage(bitmap, 0, 0);
    const sourcePixels = sourceCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const receipts = [];
    for (let i = 0; i < candidates.length; i += 1) {
      onProgress?.(`영수증 이미지를 만드는 중… (${i + 1}/${candidates.length})`);
      const corners = candidates[i].corners.map((point) => ({ x: point.x / detectionScale, y: point.y / detectionScale }));
      const crop = await perspectiveCrop(sourceCanvas, sourcePixels, corners);
      const ocrCorners = expandReceiptCorners(corners, sourceCanvas.width, sourceCanvas.height);
      const ocrCrop = await perspectiveCrop(sourceCanvas, sourcePixels, ocrCorners);
      receipts.push({
        id: `receipt-${i + 1}`,
        index: i + 1,
        corners,
        ...crop,
        ocrBlob: ocrCrop.blob,
        ocrSize: { width: ocrCrop.width, height: ocrCrop.height },
      });
      URL.revokeObjectURL(ocrCrop.url);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const debugResult = debug ? await createDebugOverlay(detectionCanvas, debugComponents, candidates) : null;
    return { source: { name: file.name, width: bitmap.width, height: bitmap.height }, receipts, diagnostics: stats, debug: debugResult };
  } finally {
    bitmap.close();
  }
}

/** @param {{receipts?: Array<{url?:string}>}|null} result */
export function releaseReceiptResult(result) {
  for (const receipt of result?.receipts || []) if (receipt.url) URL.revokeObjectURL(receipt.url);
  if (result?.debug?.url) URL.revokeObjectURL(result.debug.url);
}
