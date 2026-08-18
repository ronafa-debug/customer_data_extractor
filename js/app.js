/**
 * 툴킷 SPA 엔트리
 */
import { Router } from "./router/Router.js";
import { renderHomeView } from "./views/HomeView.js";
import { renderOrderExtractorView } from "./views/OrderExtractorView.js";
import { renderProductExtractorView } from "./views/ProductExtractorView.js";
import { renderPriceManagerView } from "./views/PriceManagerView.js";

const THEME_KEY = "oce-theme";

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (_) {
    saved = null;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme =
    saved === "dark" || saved === "light"
      ? saved
      : prefersDark
        ? "dark"
        : "light";
  document.documentElement.setAttribute("data-theme", theme);
}

function main() {
  initTheme();
  const outlet = document.getElementById("app");
  if (!outlet) {
    throw new Error("#app 요소가 없습니다.");
  }

  const router = new Router(outlet, {
    "/": {
      title: "홈",
      render: (el) => {
        renderHomeView(el);
      },
    },
    "/order": {
      title: "주문내역 고객정보 추출기",
      render: (el) => renderOrderExtractorView(el),
    },
    "/product": {
      title: "제품 정보 추출기",
      render: (el) => renderProductExtractorView(el),
    },
    "/price": {
      title: "제품가격관리",
      render: (el) => renderPriceManagerView(el),
    },
  });

  router.start();
}

main();
