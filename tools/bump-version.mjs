// index.html 안의 ?v= 값을 지금 시각으로 바꾸는 스크립트.
// 새로 올리기 전에 한 번 돌리면, 휴대전화 브라우저가 기억해 둔 옛 파일 대신 새 파일을 받는다.
// 쓰는 법: tools 폴더에서 `node bump-version.mjs`
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const v = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
const html = readFileSync(file, 'utf8');
const next = html.replace(/\?v=[0-9a-z]+/g, `?v=${v}`);
writeFileSync(file, next);
console.log(`버전을 ${v} 로 바꿨어요 (${(html.match(/\?v=[0-9a-z]+/g) || []).length}곳)`);
