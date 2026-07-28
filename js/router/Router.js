/**
 * Hash 기반 SPA 라우터
 * 새 창을 열지 않고 화면만 전환한다.
 */
export class Router {
  /**
   * @param {HTMLElement} outlet
   * @param {Record<string, { title: string, render: (el: HTMLElement) => void | (() => void) | Promise<void | (() => void)>> }} routes
   */
  constructor(outlet, routes) {
    this.outlet = outlet;
    this.routes = routes;
    /** @type {null | (() => void)} */
    this._cleanup = null;
    this._onHashChange = () => {
      this.navigate(this.getPath(), false);
    };
  }

  /** @returns {string} */
  getPath() {
    const hash = window.location.hash.replace(/^#/, "") || "/";
    return hash.startsWith("/") ? hash : `/${hash}`;
  }

  /**
   * @param {string} path
   * @param {boolean} [push=true]
   */
  async navigate(path, push = true) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (push && this.getPath() !== normalized) {
      window.location.hash = normalized;
      return;
    }

    const route = this.routes[normalized] || this.routes["/"];
    if (!route) {
      this.outlet.innerHTML = `<p class="alert-box is-error">페이지를 찾을 수 없습니다.</p>`;
      return;
    }

    if (typeof this._cleanup === "function") {
      try {
        this._cleanup();
      } catch (err) {
        console.error("[Router] cleanup:", err);
      }
      this._cleanup = null;
    }

    document.title = `${route.title} · 전자상거래 업무 자동화 툴`;
    this.outlet.innerHTML = "";
    const result = await route.render(this.outlet);
    if (typeof result === "function") {
      this._cleanup = result;
    }
  }

  start() {
    window.addEventListener("hashchange", this._onHashChange);
    return this.navigate(this.getPath(), false);
  }

  stop() {
    window.removeEventListener("hashchange", this._onHashChange);
  }
}

/**
 * @param {string} path
 */
export function go(path) {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}
