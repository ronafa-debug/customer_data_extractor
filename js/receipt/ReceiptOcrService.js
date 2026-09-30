import Tesseract from "../../node_modules/tesseract.js/dist/tesseract.esm.min.js";
import { parseReceiptItems } from "./ReceiptItemParser.js";
import { parseBlocksLayout, parseTsvLayout } from "./ReceiptOcrLayout.js";

const { createWorker, PSM } = Tesseract;

const OCR_TARGET_WIDTH = 1400;
const OCR_MAX_HEIGHT = 5200;

/** @param {Blob} blob @param {{variant?:"contrast"|"sharpen"|"adaptive"}} [options] */
export async function preprocessReceiptForOcr(blob, { variant = "contrast" } = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(2.5, OCR_TARGET_WIDTH / bitmap.width, OCR_MAX_HEIGHT / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const histogram = new Uint32Array(256);
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
      const value = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
      gray[p] = value;
      histogram[value] += 1;
    }
    const percentile = (ratio) => {
      const target = gray.length * ratio;
      let count = 0;
      for (let value = 0; value < 256; value += 1) {
        count += histogram[value];
        if (count >= target) return value;
      }
      return 255;
    };
    const low = percentile(0.02);
    const high = Math.max(low + 1, percentile(0.98));
    const enhanced = new Uint8Array(gray.length);
    for (let p = 0; p < gray.length; p += 1) {
      enhanced[p] = Math.max(0, Math.min(255, Math.round((gray[p] - low) * 255 / (high - low))));
    }
    if (variant === "sharpen") {
      const source = enhanced.slice();
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const p = y * width + x;
          enhanced[p] = Math.max(0, Math.min(255, source[p] * 5 - source[p - 1] - source[p + 1] - source[p - width] - source[p + width]));
        }
      }
    } else if (variant === "adaptive") {
      const integral = new Uint32Array((width + 1) * (height + 1));
      for (let y = 1; y <= height; y += 1) {
        let rowSum = 0;
        for (let x = 1; x <= width; x += 1) {
          rowSum += enhanced[(y - 1) * width + x - 1];
          integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
        }
      }
      const radius = Math.max(12, Math.round(width * 0.018));
      const source = enhanced.slice();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const x0 = Math.max(0, x - radius);
          const y0 = Math.max(0, y - radius);
          const x1 = Math.min(width - 1, x + radius);
          const y1 = Math.min(height - 1, y + radius);
          const stride = width + 1;
          const sum = integral[(y1 + 1) * stride + x1 + 1] - integral[y0 * stride + x1 + 1] - integral[(y1 + 1) * stride + x0] + integral[y0 * stride + x0];
          const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
          enhanced[y * width + x] = source[y * width + x] < mean - 10 ? 0 : 255;
        }
      }
    }
    for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
      const value = enhanced[p];
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** @param {{onProgress?:(progress:{status:string,progress:number})=>void}} [options] */
export async function createReceiptOcrSession({ onProgress } = {}) {
  const worker = await createWorker(["kor", "eng"], undefined, {
    workerPath: "/node_modules/tesseract.js/dist/worker.min.js",
    logger: (message) => onProgress?.({ status: message.status, progress: message.progress || 0 }),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  return {
    /** @param {Blob} blob */
    async analyze(blob, { variant = "contrast" } = {}) {
      const processedImage = await preprocessReceiptForOcr(blob, { variant });
      const textRecognition = await worker.recognize(processedImage, {}, { text: true, tsv: true, blocks: true });
      const textLayout = textRecognition.data.blocks?.length
        ? parseBlocksLayout(textRecognition.data.blocks)
        : parseTsvLayout(textRecognition.data.tsv || "");
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const layoutRecognition = await worker.recognize(processedImage, {}, { text: true, tsv: true, blocks: true });
      const layout = layoutRecognition.data.blocks?.length
        ? parseBlocksLayout(layoutRecognition.data.blocks)
        : parseTsvLayout(layoutRecognition.data.tsv || "");
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
      const parsed = parseReceiptItems({
        text: textRecognition.data.text || "",
        lines: layout.lines,
        textLines: textLayout.lines,
      });
      return {
        rawText: textRecognition.data.text || "",
        words: layout.words,
        lines: layout.lines,
        textWords: textLayout.words,
        textLines: textLayout.lines,
        table: parsed.table,
        items: parsed.items,
        reason: parsed.reason,
        processedSize: { width: processedImage.width, height: processedImage.height },
        preprocessing: variant,
      };
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * @param {Array<{index:number,blob:Blob}>} receipts
 * @param {{onProgress?:(value:{current:number,total:number,status:string,ocrProgress?:number})=>void,onResult?:(result:object)=>void}} [options]
 */
export async function analyzeReceiptsSequentially(receipts, { onProgress, onResult } = {}) {
  if (!Array.isArray(receipts) || !receipts.length) return [];
  let activeIndex = 0;
  const session = await createReceiptOcrSession({
    onProgress: ({ status, progress }) => onProgress?.({ current: activeIndex, total: receipts.length, status, ocrProgress: progress }),
  });
  try {
    const results = [];
    for (let index = 0; index < receipts.length; index += 1) {
      activeIndex = index + 1;
      onProgress?.({ current: activeIndex, total: receipts.length, status: "recognizing text", ocrProgress: 0 });
      const ocrInput = receipts[index].ocrBlob || receipts[index].blob;
      let analysis = await session.analyze(ocrInput, { variant: "contrast" });
      if (!analysis.items.length || analysis.items.every((item) => item.reviewRequired)) {
        const adaptiveAnalysis = await session.analyze(ocrInput, { variant: "adaptive" });
        const sharpenAnalysis = await session.analyze(ocrInput, { variant: "sharpen" });
        const normalizeName = (value) => String(value || "").replace(/[^가-힣A-Za-z0-9]/g, "");
        const hasCommonRun = (left, right, length = 3) => {
          const a = normalizeName(left);
          const b = normalizeName(right);
          for (let start = 0; start <= a.length - length; start += 1) {
            if (b.includes(a.slice(start, start + length))) return true;
          }
          return false;
        };
        const consensusItems = adaptiveAnalysis.items.filter((adaptiveItem) => sharpenAnalysis.items.some((sharpenItem) => (
          adaptiveItem.purchasePrice === sharpenItem.purchasePrice &&
          hasCommonRun(adaptiveItem.productName, sharpenItem.productName)
        )));
        if (consensusItems.length) {
          analysis = {
            ...adaptiveAnalysis,
            items: consensusItems.map((item) => ({ ...item, reviewRequired: false, consensus: ["adaptive", "sharpen"] })),
            fallbackUsed: "adaptive-sharpen-consensus",
          };
        }
      }
      const result = { receiptIndex: receipts[index].index, ...analysis };
      results.push(result);
      onResult?.(result);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return results;
  } finally {
    await session.terminate();
  }
}
