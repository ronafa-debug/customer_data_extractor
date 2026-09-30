/**
 * 개발 중인 기능을 모아 보여주는 실험실 뷰
 */
import { go } from "../router/Router.js";
import { getToolsByStatus } from "../tools/registry.js";

/**
 * @param {HTMLElement} root
 */
export function renderLabView(root) {
  const experimentalTools = getToolsByStatus("experimental");

  root.innerHTML = `
    <div class="tool-shell">
      <div class="tool-topbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="backHomeBtn">← 메인으로</button>
        <div class="tool-topbar-brand">
          <h1 class="tool-page-title">🧪 실험실</h1>
          <p class="tool-page-sub">아직 개발 중이거나 테스트 중인 기능입니다.</p>
        </div>
      </div>
      <section class="lab-grid" aria-label="실험 기능 목록">
        ${experimentalTools.map(
          (tool) => `
          <article class="lab-card">
            <span class="lab-card-icon" aria-hidden="true">${tool.icon}</span>
            <span class="lab-badge">실험 기능</span>
            <h2 class="lab-card-title">${tool.title}</h2>
            <p class="lab-card-desc">${tool.description}</p>
            <button type="button" class="btn btn-outline-primary btn-sm" data-lab-path="${tool.path}">실행하기</button>
          </article>
        `
        ).join("")}
      </section>
    </div>
  `;

  root.querySelector("#backHomeBtn")?.addEventListener("click", () => go("/"));
  root.querySelectorAll("[data-lab-path]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.getAttribute("data-lab-path");
      if (path) go(path);
    });
  });
}
