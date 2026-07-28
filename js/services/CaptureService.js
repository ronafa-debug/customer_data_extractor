/**
 * CaptureService — 서버 Playwright 캡처 API 호출
 */

const CAPTURE_ENDPOINT = "/api/product-capture";

/**
 * @param {string} url
 * @returns {Promise<{
 *   success: boolean,
 *   productName: string,
 *   images: Array<{
 *     id: string,
 *     label: string,
 *     filename: string,
 *     mimeType: string,
 *     dataBase64: string,
 *     width: number,
 *     height: number
 *   }>
 * }>}
 */
export async function captureProduct(url) {
  let response;
  try {
    response = await fetch(CAPTURE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    console.error("[CaptureService] network:", err);
    throw new Error("URL을 불러올 수 없습니다.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    console.error("[CaptureService] json:", err);
    throw new Error("이미지 생성에 실패했습니다.");
  }

  if (!response.ok || !payload?.success) {
    // 일부 슬롯만 실패한 경우에도 images가 있으면 UI에 표시
    if (Array.isArray(payload?.images) && payload.images.length > 0) {
      return payload;
    }
    const message =
      payload?.message ||
      (response.status === 400
        ? "상품 정보를 찾을 수 없습니다."
        : "이미지 생성에 실패했습니다.");
    console.error("[CaptureService] api error:", payload);
    throw new Error(message);
  }

  return payload;
}

export const CaptureService = { captureProduct };
