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
    const text = await response.text();
    if (
      response.status === 504 ||
      /FUNCTION_INVOCATION_TIMEOUT|TIMEOUT/i.test(text)
    ) {
      throw new Error(
        "서버 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요. (첫 요청은 Chromium 준비로 더 걸릴 수 있습니다)"
      );
    }
    try {
      payload = JSON.parse(text);
    } catch (err) {
      console.error("[CaptureService] json:", err, text.slice(0, 200));
      throw new Error("이미지 생성에 실패했습니다.");
    }
  } catch (err) {
    if (err?.message?.includes("처리 시간")) throw err;
    console.error("[CaptureService] read:", err);
    throw new Error(err?.message || "이미지 생성에 실패했습니다.");
  }

  if (!response.ok || !payload?.success) {
    // 일부 슬롯만 실패한 경우에도 images가 있으면 UI에 표시
    if (Array.isArray(payload?.images) && payload.images.length > 0) {
      return payload;
    }
    const message =
      payload?.message ||
      (response.status === 504
        ? "서버 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
        : response.status === 400
          ? "상품 정보를 찾을 수 없습니다."
          : "이미지 생성에 실패했습니다.");
    console.error("[CaptureService] api error:", payload);
    throw new Error(message);
  }

  return payload;
}

export const CaptureService = { captureProduct };
