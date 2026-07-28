/**
 * CheckboxList — 간단 체크 목록 (확장용)
 */

/**
 * @param {HTMLElement} container
 * @param {Array<{ id: string, label: string }>} items
 * @param {{ defaultChecked?: boolean }} [options]
 */
export function renderCheckboxList(container, items, options = {}) {
  const defaultChecked = options.defaultChecked !== false;
  container.innerHTML = `
    <div class="checkbox-list">
      ${items
        .map(
          (item) => `
        <label class="checkbox-list-item">
          <input type="checkbox" data-id="${item.id}" ${
            defaultChecked ? "checked" : ""
          } />
          <span>${item.label}</span>
        </label>
      `
        )
        .join("")}
    </div>
  `;
}

/**
 * @param {HTMLElement} container
 * @returns {string[]}
 */
export function getCheckedIds(container) {
  return Array.from(
    container.querySelectorAll('input[type="checkbox"][data-id]:checked')
  ).map((el) => /** @type {HTMLInputElement} */ (el).dataset.id || "");
}
