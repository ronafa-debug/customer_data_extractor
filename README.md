# 주문내역 고객정보 추출기 (Order Customer Extractor)

쿠팡 · 네이버 스마트스토어 주문 Excel을 업로드하면 고객별 주문정보를 읽기 쉬운 텍스트로 자동 변환하는 **100% Client-side SPA**입니다.

개인정보는 브라우저 메모리에서만 처리하며, 외부 서버로 전송하지 않습니다.

---

## 주요 기능

- **쇼핑몰 자동 인식**: 쿠팡 / 네이버 스마트스토어 (UI에서 선택하지 않음)
- **네이버 암호 파일 자동 해제**: 비밀번호 `1108`로 자동 열기
- **고객 그룹화**: 이름 + 전화번호 + 주소가 같으면 한 고객으로 병합
- **동일 상품 수량 합산**: 같은 고객·같은 상품명이면 수량 합산
- **상품명 정규화**: 용량 단위(`kg` / `g` / `ml` / `L` 등)까지만 추출
- **출력 모드**
  - 기본: 고객별 (이름 / 전화 / 주소 / 배송메시지 / 상품)
  - 택배기사용: 이름 / 주소 / 배송메시지
  - 피킹용: 상품별 총합
- **검색**: 고객명 · 전화번호 · 주소 · 상품명 (debounce 300ms)
- **통계**: 총 고객 / 상품 종류 / 총 수량 / 배송메시지 수
- **복사 · TXT 다운로드 · 초기화**
- **다크모드 · 모바일 대응**

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| UI | HTML5, CSS3, Bootstrap 5 |
| 로직 | Vanilla JavaScript (ES6 Modules) |
| Excel | SheetJS (xlsx), xlsx-populate |
| 기타 | FileSaver.js, JSZip, CryptoJS |

빌드 도구 없이 브라우저에서 바로 실행 가능합니다.

---

## 프로젝트 구조

```text
index.html
css/style.css
js/
  app.js                 # SPA 엔트리 (UI 이벤트 연결)
  constants.js           # 상수 · 에러 메시지
  model/
    Customer.js
    Product.js
  parser/
    BaseParser.js
    CoupangParser.js
    NaverParser.js
    ParserFactory.js     # Parser 자동 선택 (확장 포인트)
  services/
    ExcelService.js
    ExportService.js
    SearchService.js
    StatisticsService.js
  utils/
    ProductExtractor.js
    GroupCustomer.js
    MergeProduct.js
    Clipboard.js
    DateUtil.js
  views/
    Renderer.js
tests/
  run-tests.mjs
```

신규 쇼핑몰 지원 시 **Parser만 추가**하고 `ParserFactory`에 등록하면 됩니다 (Open/Closed Principle).

---

## 로컬 실행

ES Module을 사용하므로 `file://`이 아닌 HTTP 서버로 열어야 합니다.

```bash
# 예: serve (포트 5151)
npx --yes serve -l 5151
```

브라우저에서 [http://localhost:5151](http://localhost:5151) 접속

Netlify / Vercel 등 정적 호스팅에도 그대로 배포할 수 있습니다.

---

## 단위 테스트

```bash
node tests/run-tests.mjs
```

포함 시나리오:

1. 쿠팡 주문서 자동 인식 · 파싱
2. 네이버 주문서 자동 인식 · 파싱
3. 동일 고객 그룹화
4. 동일 상품 수량 합산
5. 출력 형식 (필드 간 빈 줄, 배송메시지 없을 때 블록 생략)
6. 미지원 주문서 에러 메시지

---

## 출력 예시 (기본 모드)

```text
서선일

010-9414-7127

18034 경기도 평택시 소사3로 22 (소사동, 평택 효성해링턴 플레이스 2단지) 208-1302

핑크 나루토마키 어묵 160g 5개

-------------------
```

- 이름 / 전화 / 주소 / 상품 사이에 **빈 줄**을 둡니다.
- 기본주소와 상세주소는 **한 줄**로 합칩니다.
- 배송메시지가 없으면 해당 블록을 출력하지 않습니다.

---

## 오류 · 개선 사항 (Changelog)

### 출력 형식 수정

| 문제 | 조치 |
|------|------|
| 필드가 줄바꿈만으로 붙어 가독성이 떨어짐 | 이름·전화·주소·상품 블록 사이를 빈 줄(`\\n\\n`)로 구분 |
| 네이버 상세주소(`208-1302` 등)가 다음 줄로 분리됨 | 기본주소 + 상세주소를 공백으로 한 줄 결합 |
| 주소에 남아 있던 줄바꿈이 출력에 노출됨 | 출력 시 주소 내 줄바꿈을 공백으로 평탄화 |

### 아키텍처 (v3)

| 항목 | 내용 |
|------|------|
| ES6 Module 전환 | IIFE/전역 변수 방식 제거, `import`/`export` 사용 |
| 계층 분리 | Parser / Service / Utility / View 분리 |
| 공통 모델 | 모든 Parser가 `Customer` · `Product` 반환 |
| 에러 UX | 사용자 메시지와 `console.error` 상세 로그 분리 |
| 보안 | 개인정보 서버 전송·영구 저장 없음 (테마 설정만 LocalStorage) |

### Excel / 파서

| 항목 | 내용 |
|------|------|
| 암호화 파일 | OLE 래퍼 감지 후 비밀번호 `1108`로 자동 해제 시도 |
| 손상·미지원 파일 | `손상된 Excel 파일입니다.` / `지원하지 않는 주문서입니다.` 등 안내 |
| 컬럼 매핑 | 쇼핑몰별 헤더명 차이를 `findColumnIndex`로 흡수 |

---

## 보안

- 주문·고객 데이터는 **브라우저 메모리에서만** 처리합니다.
- Analytics / 외부 API 전송을 사용하지 않습니다.
- LocalStorage에는 UI 테마 설정만 저장합니다.

---

## 라이선스

Private / 개인 업무용 프로젝트로 사용할 수 있습니다.
