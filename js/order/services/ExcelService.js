/**
 * ExcelService — 파일 로드 및 정규화
 * CDN 스크립트(XLSX, XlsxPopulate)에 의존한다.
 */
import {
  NAVER_PASSWORD,
  SUPPORTED_EXTENSIONS,
  ERROR_MESSAGE,
} from "../constants.js";

/**
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(ERROR_MESSAGE.CORRUPTED_FILE));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * OLE Compound(암호화 래퍼) 여부
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function looksEncrypted(buffer) {
  const bytes = new Uint8Array(buffer);
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  );
}

/**
 * SheetJS workbook → 정규화
 * @param {object} workbook
 * @returns {{ sheets: Array<{ name: string, data: any[][] }>, source: string }}
 */
function normalizeSheetJs(workbook) {
  const XLSX = globalThis.XLSX;
  const sheets = (workbook.SheetNames || []).map((name) => {
    const sheet = workbook.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    return { name, data };
  });
  return { sheets, source: "sheetjs" };
}

/**
 * xlsx-populate workbook → 정규화
 * @param {object} workbook
 * @returns {{ sheets: Array<{ name: string, data: any[][] }>, source: string }}
 */
function normalizePopulate(workbook) {
  const sheets = [];
  workbook.sheets().forEach((sheet) => {
    const name = sheet.name();
    const used = sheet.usedRange();
    if (!used) {
      sheets.push({ name, data: [] });
      return;
    }
    const values = used.value() || [];
    const data = values.map((row) =>
      (row || []).map((cell) => {
        if (cell == null) return "";
        if (typeof cell === "object" && cell.text != null) return String(cell.text);
        return String(cell);
      })
    );
    sheets.push({ name, data });
  });
  return { sheets, source: "xlsx-populate" };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} password
 * @returns {Promise<object>}
 */
async function openWithPassword(buffer, password) {
  const XlsxPopulate = globalThis.XlsxPopulate;
  if (!XlsxPopulate) {
    throw new Error(ERROR_MESSAGE.OPEN_FAIL);
  }

  try {
    const workbook = await XlsxPopulate.fromDataAsync(buffer, { password });
    return normalizePopulate(workbook);
  } catch (err) {
    console.error("[ExcelService] password open failed:", err);
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("password") || msg.includes("encrypt")) {
      throw new Error(ERROR_MESSAGE.INVALID_PASSWORD);
    }
    throw new Error(ERROR_MESSAGE.OPEN_FAIL);
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {object}
 */
function openWithSheetJs(buffer) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) {
    throw new Error(ERROR_MESSAGE.OPEN_FAIL);
  }

  try {
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      codepage: 65001,
    });
    return normalizeSheetJs(workbook);
  } catch (err) {
    console.error("[ExcelService] SheetJS read failed:", err);
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("password") || msg.includes("encrypt")) {
      throw new Error(ERROR_MESSAGE.INVALID_PASSWORD);
    }
    throw new Error(ERROR_MESSAGE.CORRUPTED_FILE);
  }
}

/**
 * Excel 파일을 읽어 정규화 workbook을 반환한다.
 * 네이버 암호 파일은 NAVER_PASSWORD 로 자동 해제한다.
 * @param {File} file
 * @returns {Promise<{ sheets: Array<{ name: string, data: any[][] }>, fileName: string, source: string }>}
 */
export async function loadExcelFile(file) {
  if (!file) {
    throw new Error(ERROR_MESSAGE.NO_FILE);
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(ERROR_MESSAGE.UNSUPPORTED_FORMAT);
  }

  let buffer;
  try {
    buffer = await readAsArrayBuffer(file);
  } catch (err) {
    console.error("[ExcelService] readAsArrayBuffer:", err);
    throw new Error(ERROR_MESSAGE.CORRUPTED_FILE);
  }

  if (looksEncrypted(buffer)) {
    try {
      const normalized = await openWithPassword(buffer, NAVER_PASSWORD);
      return { ...normalized, fileName: file.name };
    } catch (passwordErr) {
      try {
        const normalized = openWithSheetJs(buffer);
        return { ...normalized, fileName: file.name };
      } catch (_) {
        throw passwordErr;
      }
    }
  }

  try {
    const normalized = openWithSheetJs(buffer);
    return { ...normalized, fileName: file.name };
  } catch (sheetErr) {
    try {
      const normalized = await openWithPassword(buffer, NAVER_PASSWORD);
      return { ...normalized, fileName: file.name };
    } catch (passwordErr) {
      console.error("[ExcelService] fallback password failed:", passwordErr);
      throw sheetErr;
    }
  }
}

export const ExcelService = {
  loadExcelFile,
  looksEncrypted,
};
