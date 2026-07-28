# 전자상거래 업무 자동화 툴 (E-commerce Automation Toolkit)

하나의 웹사이트에서 전자상거래 업무 자동화 도구를 선택해 사용하는 **SPA 툴킷**입니다.

저장소: [ronafa-debug/customer_data_extractor](https://github.com/ronafa-debug/customer_data_extractor)  
라이브: [customer-data-extractor.vercel.app](https://customer-data-extractor.vercel.app)

---

## 프로젝트 요약

| 항목 | 내용 |
|------|------|
| 목적 | 주문 정리·상품 이미지 생성 등 반복 업무를 한곳에서 자동화 |
| 구성 | 홈(도구 선택) → 도구별 화면 (해시 라우팅 SPA) |
| 원칙 | 주문 개인정보는 브라우저만 처리 / 상품 캡처는 서버 Playwright만 사용 |
| 확장 | `js/tools/registry.js` + 라우트·Parser Factory에 도구·쇼핑몰 추가 |

---

## 제공 도구

| 도구 | 설명 |
|------|------|
| 주문내역 고객정보 추출기 | 쿠팡·네이버 주문 Excel → 고객별 텍스트 (브라우저 전용) |
| 제품 정보 추출기 | 상품 URL → 대표/상세/필수정보/추가 PNG 4종 (Playwright 서버) |

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | HTML5, CSS3, Bootstrap 5, Vanilla JS (ES6 Modules) |
| Backend | Vercel Serverless Functions / 로컬 `scripts/dev-server.mjs` (Node.js 20+) |
| Browser Automation | Playwright (`playwright` 로컬, `playwright-core` + `@sparticuz/chromium` 배포) |
| Image | Sharp (리사이즈·크롭·정사각·포장샷 점수) |

---

## 아키텍처

```text
사용자
  ↓
Frontend (해시 라우터 SPA)
  ↓
주문 추출기: 브라우저만 처리 (개인정보 서버 미전송)
제품 추출기: POST /api/product-capture
  ↓
Playwright → DOM 분석 → 이미지 URL/스크린샷 → Sharp → PNG(base64) 반환
```

- 브라우저는 타 사이트를 **직접 캡처하지 않습니다**.
- 캡처·DOM 분석·이미지 생성은 **서버에서만** 수행합니다.
- 서버에 상품/개인정보를 **저장하지 않습니다**.

### 로컬 vs Vercel

| | 로컬 (`npm run dev:local`) | Vercel (Hobby) |
|--|---------------------------|----------------|
| 품질 | 큰 viewport·충분한 대기 → **업무용 권장** | 60초 한도로 빠른 경로(작은 viewport 등) |
| 속도 | Chromium 재사용으로 재요청이 빠름 | 콜드스타트 시 첫 요청이 느릴 수 있음 |
| 용도 | 최종 이미지 생성 | 데모·간단한 공유 |

---

## 프로젝트 구조

```text
index.html
css/style.css
js/
  app.js
  router/Router.js
  tools/registry.js
  views/
    HomeView.js
    OrderExtractorView.js
    ProductExtractorView.js
  order/                 # 주문 추출기 (독립 모듈)
  product/               # URL 기반 Parser (프론트 판별)
  services/
    CaptureService.js
    ImageService.js
    DownloadService.js
  components/
    ImagePreview.js
api/
  product-capture.js
  lib/
    browser.js           # 로컬 브라우저 재사용 / Vercel Chromium
    images.js            # Sharp 규칙 (포장샷 점수·크롭·정사각)
    product/             # Playwright Parser (모노마트 등)
scripts/
  dev-server.mjs         # 로컬 정적 + API (포트 5151)
vercel.json
package.json
tests/
  run-tests.mjs
```

---

## 로컬 실행

```bash
npm install
npm run install:browser   # Chromium (최초 1회)
npm run dev:local         # http://localhost:5151
```

- `npm run dev:local` — 정적 파일 + `/api/product-capture` (**권장**)
- `npm run dev` — `vercel dev` (Vercel CLI 로그인 필요)
- `npm start` — 정적만 (주문 추출기만 사용 시)
- `npm run test:order` — 주문 추출기 단위 테스트

> 제품 추출기 코드를 수정한 뒤에는 **로컬 서버를 재시작**해야 새 로직이 반영됩니다.

---

## 1) 주문내역 고객정보 추출기

쿠팡·네이버 스마트스토어 주문 Excel을 업로드하면 고객별 주문정보를 읽기 쉬운 텍스트로 변환합니다. **100% 클라이언트**에서 처리합니다.

### 주요 기능

- 쇼핑몰 자동 인식 (쿠팡 / 네이버)
- 네이버 암호 파일 자동 해제 (비밀번호 `1108`)
- 고객 그룹화 · 동일 상품 수량 합산 · 상품명 단위까지 정규화
- 출력 모드: 기본 / 택배기사용 / 피킹용
- 검색 · 통계 · 복사 · TXT 다운로드 · 다크모드

### 출력 규칙

- 이름 / 전화 / 주소 / (배송메시지) / 상품 사이에 **빈 줄**
- 기본주소 + 상세주소는 **한 줄**, 동일·포함 관계면 **중복 제거**
- 배송메시지가 없으면 해당 블록 생략

---

## 2) 제품 정보 추출기

상품 URL을 입력하면 서버가 페이지를 열고 **4종 PNG**를 생성합니다.

### 생성 규칙

| ID | 내용 | 크기 | 파일명 예 |
|----|------|------|-----------|
| 대표이미지 | 「제품 스펙 총정리」 영역에서 **완제품 포장컷** 선택 | 1000×1000 | `제품명 - 대표이미지.png` |
| 상세페이지1 | 대표이미지 리사이즈 | 860×860 | `제품명1 - 상세페이지.png` |
| 상세페이지2 | **상품필수 정보** 섹션 캡처 | 가로 860 | `제품명2 - 상세페이지.png` |
| 추가이미지 | 상세페이지2를 흰 캔버스 중앙 배치 | 1000×1000 | `제품명 - 추가이미지.png` |

### 대표이미지 선정 방식

1. 상세 본문 `emono/product` CDN 이미지만 후보로 수집 (정책·공통·에디터 경로 제외)
2. `scorePackageShot`으로 점수화 — **병·팩·라벨 포장** 가점, **소스 그릇·음식 연출** 감점/배제
3. 최고점 포장컷을 흰 배경 정사각(약 7% 여백)으로 배치

- 슬롯은 항상 4개 반환. 실패 시 `status: "error"`와 사유를 미리보기에 표시
- 선택 다운로드: PNG 개별·순차 저장 (ZIP 없음)
- 현재 Parser: **모노마트(Monomart)**. 확장은 `api/lib/product/` + `js/product/`에 Parser 추가 후 Factory 등록

---

## Vercel 배포

1. GitHub 저장소 연결 후 Import  
2. Framework Preset: Other, Node.js 20+  
3. 배포 후 `/api/product-capture` 동작  

> Hobby 플랜은 함수 실행 시간 최대 **60초**입니다. Chromium 콜드스타트 시 첫 요청이 타임아웃될 수 있으니, 실패 시 한 번 더 시도하세요.  
> 최종 업무용 이미지는 **로컬 실행**이 더 안정적입니다.

---

## 오류 · 개선 사항 (Changelog)

### Toolkit · 제품 정보 추출기

| 문제 | 조치 |
|------|------|
| 이미지가 2장만 생성됨 | 항상 4슬롯 반환, 실패 슬롯에 사유 표시 |
| 대표이미지가 상단 썸네일/마케팅 배너로 잡힘 | 「제품 스펙 총정리」 영역 `emono/product` 상세컷만 사용 |
| 대표이미지가 교환/환불·고객센터 안내로 잡힘 | `buyer-inform`·`/editor/policy/` 등 제외 + `looksLikePolicyBanner` 스킵 |
| 포장샷 대신 **소스 그릇·음식 연출컷**이 선택됨 | `scorePackageShot`에 라벨 띠·세로 실루엣 가점, 둥근 구도·음식색·고텍스처 감점. 점수 ≤44 후보는 1차 배제 |
| 대표이미지 상단 잘림 · 상하 여백 없음 | 포장 직전 흰 간격 검출 후 본체 bbox 크롭, 사방 ~7% 여백 |
| 여백이 회색으로 보임 | 캔버스 배경을 원본 스튜디오/흰색에 맞춤 |
| 팝업이 캡처에 포함됨 | 캡처 전 채팅·리치팝업·딤드 제거 |
| 선택 다운로드 시 저장 창이 여러 번 / `.tmp` 잔여 | PNG 순차 다운로드, FileSaver 미사용으로 임시파일 완화 |
| 폴더 선택 API(`showDirectoryPicker`) NotAllowedError | 일부 환경에서 API 차단 → PNG 직접 다운로드로 안정화 |
| 생성 속도가 느림 | `networkidle`→`load`, 스크롤·대기 단축, 후보 이미지 병렬 점수, 로컬 브라우저 재사용 |
| Vercel에서 Chromium 기동 실패·타임아웃 | `@sparticuz/chromium` + `LD_LIBRARY_PATH`, `maxDuration` 60, Vercel용 빠른 캡처 경로 |
| Vercel vs 로컬 결과 차이 (필수정보 등) | Vercel은 모바일 viewport·짧은 대기(60초 한도). 품질은 로컬 우선 |

### 주문내역 고객정보 추출기 (유지)

| 문제 | 조치 |
|------|------|
| 쿠팡 기본/상세주소 중복 | `joinAddressParts()`로 동일·포함 시 한 번만 사용 |
| 필드가 붙어 가독성 저하 | 블록 사이 빈 줄 |
| 네이버 상세주소 줄바꿈 분리 | 기본+상세를 한 줄로 결합 |

### 아키텍처

| 항목 | 내용 |
|------|------|
| SPA 툴킷 | 홈 → 도구 선택, 해시 라우팅 |
| 주문 추출기 분리 | `js/order/`로 이전, 기존 동작 유지 |
| Parser Pattern | Front/Server Factory 등록만으로 쇼핑몰 확장 |
| ES6 Modules | import/export, 계층 분리 |

---

## 보안

- 주문 Excel: 브라우저 메모리에서만 처리 (서버 미전송)
- 제품 캡처: URL만 전송, 결과 PNG만 반환, 서버 미저장
- Analytics 미사용
- LocalStorage에는 UI 테마 설정만 저장

---

## 라이선스

Private / 개인 업무용 프로젝트로 사용할 수 있습니다.
