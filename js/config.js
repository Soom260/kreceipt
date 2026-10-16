// 앱 전체에서 쓰는 규칙(글자 수·금액 범위 등)과 외부 주소를 한곳에 모아 둔 파일.
// README와 검증 기록에 적는 숫자는 모두 이 파일의 값을 기준으로 한다.

export const LIMITS = {
  fileMaxMB: 10,          // 캡처 파일 최대 크기
  nameMin: 1,             // 항목 이름 글자 수
  nameMax: 20,
  amountMin: 1,           // 금액 범위 (원)
  amountMax: 10000000,
  itemsMin: 1,            // 영수증에 넣을 항목 수
  itemsMax: 10,
  rowsMax: 30,            // 확인 목록에 둘 수 있는 최대 행 수
  messageMax: 60,         // 한마디 글자 수
  nickMax: 10,            // 닉네임 글자 수
  songQueryMin: 2,        // 노래 검색어 최소 글자 수
  linkMax: 2000,          // 공유 링크에서 #r= 뒤에 붙는 글자 수 상한
};

// 올릴 수 있는 캡처 파일 종류
export const FILE_TYPES = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WEBP',
};

export const SEARCH_DEBOUNCE_MS = 400;

// iTunes Search API (인증키 없음)
// 2026-10-14 직접 확인: country=KR 은 lookup 은 되지만 search 결과가 늘 0건이라 US 스토어를 쓴다.
// US 스토어에서도 한국 노래가 검색된다 (곡명이 영어로 나오는 경우가 있음).
export const ITUNES = {
  search: 'https://itunes.apple.com/search',
  lookup: 'https://itunes.apple.com/lookup',
  country: 'US',
  limit: 5,
  timeoutMs: 8000,
};

// Deezer API (인증키 없음) — iTunes 검색이 실패할 때만 쓰는 예비 검색.
// 아이폰 브라우저인 척 보낸 요청에 Apple 이 음악 앱(musics://)으로 돌려보내는 경우가 확인돼서(2026-10-16) 대비해 둔다.
// 실제 아이폰에서는 iTunes 가 되는 경우도 있어 iTunes 를 늘 먼저 쓴다. 브라우저에서는 JSONP 로만 받을 수 있다.
export const DEEZER = {
  search: 'https://api.deezer.com/search',
  track: 'https://api.deezer.com/track/',
  limit: 5,
};

// 외부 라이브러리 (버전 고정)
export const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
  tesseractSri: 'sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM',
  tesseractWorker: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
  tesseractCore: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
  htmlToImage: 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js',
  htmlToImageSri: 'sha384-Tha/42qsYmpYmQ07pX+nJzkKumO0BzKJxK/uzVc7xyBQxVCUgQBhQIG8L7vXK+9C',
};

// 한국어·영어 인식 데이터는 저장소 안에 함께 둔다 (@tesseract.js-data/kor·eng 1.0.0, 4.0.0_best_int)
export const TESSDATA_PATH = new URL('../assets/tessdata', import.meta.url).href;

// 상태 재현용 주소 조건: ?sim=slow / error / empty / nostorage (쉼표로 여러 개 가능)
const params = new URLSearchParams(location.search);
const simList = (params.get('sim') || '').split(',').map((s) => s.trim()).filter(Boolean);
export const SIM = {
  slow: simList.includes('slow'),           // 로딩 3초 더 보여 주기
  error: simList.includes('error'),         // OCR·노래 불러오기 실패
  empty: simList.includes('empty'),         // OCR·노래 검색 결과 없음
  nostorage: simList.includes('nostorage'), // 보관함(localStorage) 사용 불가
};
export const SIM_SLOW_MS = 3000;
export const DEBUG = params.get('debug') === '1';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
