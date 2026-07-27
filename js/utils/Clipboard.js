/**
 * Clipboard API 래퍼
 */
import { ERROR_MESSAGE } from "../constants.js";

/**
 * 텍스트를 클립보드에 복사한다.
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyText(text) {
  const value = String(text || "");
  if (!value.trim()) {
    throw new Error(ERROR_MESSAGE.COPY_EMPTY);
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!ok) {
    throw new Error(ERROR_MESSAGE.COPY_FAIL);
  }
}
