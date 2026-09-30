/**
 * 홈(랜딩) 뷰
 */
import { getToolsByStatus } from "../tools/registry.js";
import { go } from "../router/Router.js";

/**
 * @param {HTMLElement} root
 */
export function renderHomeView(root) {
  const stableTools = getToolsByStatus("stable");

  root.innerHTML = `
    <section class="home-hero">
      <p class="home-eyebrow">E-commerce Automation Toolkit</p>
      <h1 class="home-brand">전자상거래 업무 자동화 툴</h1>
      <p class="home-lead">필요한 업무 도구를 선택하세요. 모든 처리는 도구별로 분리되어 동작합니다.</p>
    </section>
    <section class="tool-grid" aria-label="업무 도구 목록">
      ${stableTools.map(
        (tool) => `
        <button type="button" class="tool-card" data-path="${tool.path}">
          <span class="tool-card-icon" aria-hidden="true">${tool.icon}</span>
          <span class="tool-card-title">${tool.title}</span>
          <span class="tool-card-desc">${tool.description}</span>
        </button>
      `
      ).join("")}
    </section>
    <div class="home-secondary-actions">
      <button type="button" class="lab-entry-button" id="labEntryBtn">🧪 실험실</button>
    </div>
  `;

  root.querySelectorAll(".tool-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-path");
      if (path) go(path);
    });
  });

  root.querySelector("#labEntryBtn")?.addEventListener("click", () => go("/lab"));
}
