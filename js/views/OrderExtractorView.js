/**
 * 주문내역 고객정보 추출기 뷰 — 기존 기능을 그대로 마운트한다.
 */
import { go } from "../router/Router.js";
import { mountOrderExtractor } from "../order/main.js";

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
export function renderOrderExtractorView(root) {
  root.innerHTML = `
    <div class="tool-shell">
      <div class="tool-topbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="backHomeBtn">← 홈</button>
        <div class="tool-topbar-brand">
          <h1 class="tool-page-title">주문내역 고객정보 추출기</h1>
          <p class="tool-page-sub">쿠팡 · 네이버 스마트스토어 주문 Excel → 고객정보 자동 변환</p>
        </div>
        <button type="button" id="themeToggle" class="btn btn-theme" aria-label="다크모드 전환" title="다크모드">
          <span class="theme-icon" aria-hidden="true">◐</span>
        </button>
      </div>

      <section class="panel upload-panel">
        <div id="dropZone" class="drop-zone" tabindex="0" role="button" aria-label="Excel 파일 업로드 영역">
          <input type="file" id="fileInput" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
          <div class="drop-zone-inner">
            <span class="drop-icon" aria-hidden="true">⇪</span>
            <p class="drop-title">파일 업로드</p>
            <p class="drop-hint">클릭하거나 Drag &amp; Drop</p>
            <p class="drop-formats">쿠팡 .xlsx · 네이버 .xls / .xlsx</p>
          </div>
        </div>
        <div id="fileMeta" class="file-meta d-none">
          <div class="file-meta-row">
            <span id="mallBadge" class="mall-badge">—</span>
            <span id="fileName" class="file-name"></span>
          </div>
          <button type="button" id="clearFileBtn" class="btn btn-sm btn-outline-secondary">파일 변경</button>
        </div>
      </section>

      <section class="panel control-panel">
        <div class="control-row">
          <div class="btn-group-actions">
            <button type="button" id="convertBtn" class="btn btn-primary" disabled>변환</button>
            <button type="button" id="copyBtn" class="btn btn-outline-primary" disabled>복사</button>
            <button type="button" id="downloadBtn" class="btn btn-outline-primary" disabled>TXT</button>
            <button type="button" id="resetBtn" class="btn btn-outline-secondary" disabled>초기화</button>
          </div>
          <div class="mode-group" role="group" aria-label="출력 모드">
            <label class="mode-label">출력 모드</label>
            <div class="btn-group" role="group">
              <input type="radio" class="btn-check" name="outputMode" id="modeBasic" value="basic" checked />
              <label class="btn btn-outline-secondary btn-sm" for="modeBasic">기본</label>
              <input type="radio" class="btn-check" name="outputMode" id="modeDelivery" value="delivery" />
              <label class="btn btn-outline-secondary btn-sm" for="modeDelivery">택배기사용</label>
              <input type="radio" class="btn-check" name="outputMode" id="modePicking" value="picking" />
              <label class="btn btn-outline-secondary btn-sm" for="modePicking">피킹용</label>
            </div>
          </div>
        </div>
        <div class="search-row">
          <input type="search" id="searchInput" class="form-control search-input" placeholder="고객명 · 전화번호 · 주소 · 상품명 검색" disabled autocomplete="off" />
        </div>
      </section>

      <section id="statsSection" class="panel stats-panel d-none" aria-live="polite">
        <div class="stat-item"><span class="stat-value" id="statCustomers">0</span><span class="stat-label">총 고객</span></div>
        <div class="stat-item"><span class="stat-value" id="statProducts">0</span><span class="stat-label">총 상품 종류</span></div>
        <div class="stat-item"><span class="stat-value" id="statQty">0</span><span class="stat-label">총 수량</span></div>
        <div class="stat-item"><span class="stat-value" id="statMessages">0</span><span class="stat-label">배송메시지</span></div>
      </section>

      <div id="alertBox" class="alert-box d-none" role="alert"></div>

      <section class="panel result-panel">
        <div class="result-header">
          <h2 class="result-title">변환 결과</h2>
          <span id="resultCount" class="result-count"></span>
        </div>
        <pre id="resultOutput" class="result-output" aria-live="polite">파일을 업로드한 뒤 변환을 눌러주세요.</pre>
      </section>

      <footer class="app-footer">
        <p>주문 데이터는 브라우저에서만 처리됩니다. 개인정보는 외부로 전송·저장되지 않습니다.</p>
      </footer>
    </div>
  `;

  const backBtn = root.querySelector("#backHomeBtn");
  backBtn?.addEventListener("click", () => go("/"));

  const mounted = mountOrderExtractor(root);
  return () => mounted.destroy();
}
