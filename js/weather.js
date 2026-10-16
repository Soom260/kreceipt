// "그날의 날씨" — 위치(또는 고른 지역)와 영수증 날짜로 우리 서버(/weather)에 날씨를 묻는 파일.
// 정확한 위치는 이 파일 안에서 격자 번호·관측소 번호로 바꾼 뒤 바로 버린다 (서버·링크·보관함에 남기지 않음).

import { API_BASE, API_TIMEOUT_MS, SIM, SIM_SLOW_MS, wait } from './config.js';
import { toGrid, nearestStation, stationById, inKorea } from './places.js';

// 위치 권한 → 좌표 (정확도 낮게: 약 수 km 면 충분)
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(Object.assign(new Error('no-geo'), { kind: 'unsupported' }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(Object.assign(new Error(e.message), { kind: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' })),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

// 좌표 → 서버에 보낼 값 (격자 + 관측소). 좌표 자체는 돌려주지 않는다
export function placeFromCoords(lat, lon) {
  if (!inKorea(lat, lon)) throw Object.assign(new Error('outside'), { kind: 'outside' });
  const { nx, ny } = toGrid(lat, lon);
  const st = nearestStation(lat, lon);
  return { nx, ny, stn: st[0], name: st[1] };
}

export function placeFromStation(id) {
  const st = stationById(id);
  const { nx, ny } = toGrid(st[2], st[3]);
  return { nx, ny, stn: st[0], name: st[1] };
}

// 서버에 날씨 묻기. 결과: { c, t, kind } 또는 null(그날 기록 없음)
export async function fetchWeather(date, place) {
  if (SIM.slow) await wait(SIM_SLOW_MS);
  if (SIM.error) throw Object.assign(new Error('sim-error'), { kind: 'network' });
  if (SIM.empty) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const q = new URLSearchParams({ date, nx: String(place.nx), ny: String(place.ny), stn: String(place.stn) });
    const res = await fetch(`${API_BASE}/weather?${q}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) throw Object.assign(new Error((data && data.code) || 'HTTP ' + res.status), { kind: res.status === 400 ? 'bad' : 'server' });
    return data.weather || null;
  } catch (e) {
    if (!e.kind) e.kind = e.name === 'AbortError' ? 'timeout' : navigator.onLine === false ? 'offline' : 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
