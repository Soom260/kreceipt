// 글자 인식(OCR) 결과에서 "가게명 · 금액 · 날짜 · 시간"만 뽑는 파일.
// 잔액·계좌번호·카드번호 같은 나머지 글자는 버리고 돌려주지 않는다.
//
// 지원하는 화면 모양 (MVP 범위):
//   10월 10일 토요일            ← 날짜 줄 (또는 2026.10.10 / 10.10 (토))
//   동네커피 연남점   -4,500원   ← 가게명과 금액이 한 줄 (금액이 다음 줄에 있어도 됨)
//   11:02 · 체크카드  잔액 ...   ← 시간 줄 (오전/오후 표기도 읽음), 잔액은 버림
// 입금(+), 환불·취소 줄은 쓴 돈이 아니므로 뺀다.

// 이 낱말 뒤에 나오는 금액은 결제 금액이 아니다 (잔액·한도 등)
const NOT_SPENDING = /(잔액|잔고|한도|포인트|적립|누적|합계|총\s*지출|총액|이번\s*달|사용\s*가능|출금\s*가능)/;
// 이 낱말이 있으면 들어온 돈이거나 취소된 거래
const INCOME = /(입금|환불|취소|이자|받은\s*돈|급여|월급|용돈)/;
// 가게명에서 지울 결제수단 낱말
const PAY_WORDS = /(체크카드|신용카드|일시불|할부|승인|결제|후불교통|교통카드결제|간편결제|카드)/g;

const AMOUNT = /([-−–~+]?)\s*(\d{1,3}(?:[,.]\d{3})+|\d{2,8})\s*[원윈웬]/g;
const HAS_AMOUNT = new RegExp(AMOUNT.source);
const TIME = /(오전|오후|AM|PM)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/i;
const DATE_FULL = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/;
const DATE_KO = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
// '월'을 '8'로 잘못 읽는 경우가 있어("10월" → "108"), 요일이 함께 있는 줄에서만 느슨하게 본다
const DATE_KO_LOOSE = /(\d{1,2})\s*[월윌8]\s*(\d{1,2})\s*일/;
const WEEKDAY = /([월화수목금토일]요일|\(\s*[월화수목금토일]\s*\))/;
const DATE_SHORT = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*(\(?\s*[월화수목금토일]\s*\)?)?\s*$/;

const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// 날짜 줄이면 'YYYY-MM-DD', 아니면 null. 연도가 없으면 기준 날짜의 연도 (미래가 되면 작년)
export function readDate(line, baseDate) {
  const [by, bm, bd] = baseDate.split('-').map(Number);
  let m = line.match(DATE_FULL);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = line.match(DATE_KO) || line.match(DATE_SHORT) || (WEEKDAY.test(line) ? line.match(DATE_KO_LOOSE) : null);
  if (!m) return null;
  const mo = +m[1], d = +m[2];
  let y = by;
  if (mo > bm || (mo === bm && d > bd + 1)) y = by - 1;
  return validDate(y, mo, d);
}

export function readTime(line) {
  const m = line.match(TIME);
  if (!m) return '';
  let h = +m[2];
  const min = +m[3];
  if (h > 23 || min > 59) return '';
  const ap = (m[1] || '').toUpperCase();
  if ((ap === '오후' || ap === 'PM') && h < 12) h += 12;
  if ((ap === '오전' || ap === 'AM') && h === 12) h = 0;
  return `${pad(h)}:${pad(min)}`;
}

// 가게명 다듬기: 시간·결제수단·잡문자 제거
export function cleanName(s) {
  let t = s
    .replace(new RegExp(TIME.source, 'gi'), ' ')
    .replace(PAY_WORDS, ' ')
    .replace(/[|·•ㆍ\[\]{}<>@©®°*_=~^"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 앞뒤의 기호 제거
  t = t.replace(/^[^가-힣A-Za-z0-9(]+/, '').replace(/[^가-힣A-Za-z0-9)]+$/, '');
  // 맨 앞 가게 아이콘을 글자로 잘못 읽은 경우 ("0 동네커피", "홍 동네편의점", "(0 빵집")
  // 한 글자짜리 낱말이나 0·O·® 같은 동그라미 모양 글자만 지운다 ("CU 연남점"의 CU 는 남김)
  const words = t.split(' ');
  if (words.length > 1) {
    const f = words[0];
    const rest = words.slice(1).join(' ');
    const iconLike = Array.from(f).length === 1 || /^[oO0QD()®©@°•]{1,3}$/.test(f);
    if (iconLike && Array.from(rest).length >= 2) t = rest;
  }
  return Array.from(t).slice(0, 20).join('').trim();
}

const hasLetters = (s) => /[가-힣A-Za-z]/.test(s);

// text: OCR 결과 전체, baseDate: 'YYYY-MM-DD' (연도 추정용)
// 돌려주는 값: [{ name, amount, date, time }]
export function parseTransactions(text, baseDate) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out = [];
  const used = new Set(); // 가게명으로 쓴 줄
  let curDate = null;

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];

    // 잔액 같은 낱말 앞부분만 본다
    const cut = line.search(NOT_SPENDING);
    const part = cut >= 0 ? line.slice(0, cut) : line;

    const amounts = [...part.matchAll(AMOUNT)];
    if (!amounts.length) {
      // 금액이 없는 짧은 줄은 날짜 줄일 수 있다
      if (cut < 0 && line.length <= 24) {
        const d = readDate(line, baseDate);
        if (d) curDate = d;
      }
      continue;
    }

    // 한 줄에 금액이 여럿이면 첫 번째만 결제 금액으로 본다
    const a = amounts[0];
    const sign = a[1];
    const value = Number(a[2].replace(/[,.]/g, ''));
    if (sign === '+' || INCOME.test(line) || !(value >= 10)) continue;

    // 가게명: 같은 줄 금액 앞 → 없으면 바로 윗줄
    let name = cleanName(part.slice(0, a.index));
    let nameLine = k;
    if (!hasLetters(name) && k > 0 && !used.has(k - 1)) {
      const prev = lines[k - 1];
      if (!HAS_AMOUNT.test(prev) && !readDate(prev, baseDate)) {
        name = cleanName(prev);
        nameLine = k - 1;
      }
    }
    if (!hasLetters(name) || INCOME.test(lines[nameLine])) continue;
    used.add(nameLine);

    // 시간: 같은 줄 → 다음 줄 → 윗줄
    const time = readTime(line) || (lines[k + 1] ? readTime(lines[k + 1]) : '') || (nameLine !== k ? readTime(lines[nameLine]) : '');

    out.push({ name, amount: value, date: curDate, time });
  }
  return out;
}
