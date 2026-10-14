// 캡처 이미지에서 글자를 읽는 파일 (Tesseract.js, 브라우저 안에서만 실행).
// 이미지는 어디로도 보내지 않는다. 처음 한 번 인식 도구(약 4MB)와 한국어·영어 데이터(약 4.5MB)를 받는다.

import { CDN, TESSDATA_PATH, SIM, SIM_SLOW_MS, wait } from './config.js';

let workerPromise = null;
let progressCb = null;

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.onload = resolve;
    s.onerror = () => reject(new Error('script-load-failed'));
    document.head.append(s);
  });
}

// Tesseract 진행 상태 → 화면에 보여 줄 한국어 문장
const STATUS_KO = {
  'loading tesseract core': '글자 인식 도구를 받는 중…',
  'initializing tesseract': '글자 인식 도구를 준비하는 중…',
  'loading language traineddata': '한국어 인식 데이터를 받는 중… (처음 한 번, 약 4.5MB)',
  'loading language traineddata (from cache)': '한국어 인식 데이터를 불러오는 중…',
  'initializing api': '인식 준비를 마무리하는 중…',
  'recognizing text': '캡처에서 글자를 읽는 중…',
};

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(CDN.tesseract, CDN.tesseractSri);
      return window.Tesseract.createWorker('kor+eng', 1, {
        workerPath: CDN.tesseractWorker,
        corePath: CDN.tesseractCore,
        langPath: TESSDATA_PATH,
        logger: (m) => {
          if (progressCb) progressCb(STATUS_KO[m.status] || '준비하는 중…', m.progress, m.status);
        },
      });
    })();
    // 실패하면 다음 시도 때 처음부터 다시 받도록 비워 둔다
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// 작은 캡처는 2배로 키워야 한글을 더 잘 읽는다. 캔버스로 옮겨 그린 뒤 원본 주소는 바로 버린다.
async function prepare(image) {
  const url = URL.createObjectURL(image);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = img.naturalWidth < 1000 ? 2 : 1;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth * scale;
    c.height = img.naturalHeight * scale;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// image: File 또는 Blob. 돌려주는 값: 인식된 글자 전체 (부르는 쪽에서 필요한 것만 뽑고 버린다)
export async function recognizeImage(image, onProgress) {
  progressCb = onProgress;
  try {
    if (SIM.slow) {
      onProgress && onProgress('(?sim=slow) 일부러 3초 늦추는 중…', 0.2);
      await wait(SIM_SLOW_MS);
    }
    if (SIM.error) throw new Error('sim-error');
    if (SIM.empty) return '';
    const canvas = await prepare(image);
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    canvas.width = canvas.height = 0; // 그린 이미지도 비운다
    return data.text || '';
  } finally {
    progressCb = null;
  }
}
