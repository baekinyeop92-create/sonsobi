/* 화면 점검 (devDependency playwright 사용, DoD 3):
   390px 폭 · 라이트/다크 · 예시 모드에서 콘솔 에러 0, 가로 스크롤 0을 확인한다.
   서버를 직접 띄우므로 그냥 `node scripts/ui-check.mjs` 로 실행. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 8090;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
});
const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { try { return await fn(); } catch (e) { if (Date.now() - t0 > ms) throw e; await new Promise(r => setTimeout(r, 120)); } } };
await until(() => fetch(BASE + '/').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); }));

const problems = [];
const browser = await chromium.launch();

async function checkPage(context, label, url, prepare) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  if (prepare) await prepare(page);
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(d.scrollWidth - d.clientWidth, document.body.scrollWidth - window.innerWidth);
  });
  if (errors.length) problems.push(`[${label}] 콘솔 에러 ${errors.length}건: ${errors.slice(0, 3).join(' | ')}`);
  if (overflow > 0) problems.push(`[${label}] 가로 스크롤 ${overflow}px`);
  console.log(`${errors.length || overflow > 0 ? '✗' : '✓'} ${label} — 콘솔 에러 ${errors.length}, 가로 넘침 ${overflow}px`);
  await page.close();
}

for (const scheme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, serviceWorkers: 'block' });

  // 연결 화면(gate) → 예시 모드 진입 → 상호작용
  await checkPage(context, `${scheme} · 연결 화면`, BASE + '/', async page => {
    await page.waitForSelector('#connect:not([hidden])');
  });
  await checkPage(context, `${scheme} · 예시 모드`, BASE + '/', async page => {
    if (await page.isVisible('#connDemo')) {
      await page.click('#connDemo');
      await page.waitForLoadState('networkidle');
    }
    await page.waitForSelector('#calGrid .day');
    await page.click('#calGrid .day[data-date]');                    // 날짜 선택
    await page.click('#openSettings');                               // 분류 설정 열기
    await page.waitForSelector('#settings:not([hidden])');
    await page.click('#openSettings');
    await page.click('#allSummary');                                 // 전체 거래표 열기
    await page.waitForSelector('#allTable table');
    const cat = page.locator('.catbtn').first();                     // 항목 필터
    if (await cat.count()) { await cat.click(); await page.waitForSelector('#catRows .catrows'); }
    await page.waitForTimeout(150);
  });
  await checkPage(context, `${scheme} · 설치 안내`, BASE + '/setup.html', async page => {
    await page.click('[data-ostab="and"]');
    await page.waitForSelector('[data-os="and"]:not([hidden])');
  });
  await context.close();
}

// 잘못된 연결 코드 → 한국어 안내 (네트워크 없이 판정되는 케이스)
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('#connCode', 'SNS1.zzz-not-base64');
  await page.click('#connGo');
  const msg = await page.textContent('#connMsg');
  if (!/연결 코드/.test(msg || '')) problems.push(`[연결 오류 안내] 예상 문구 없음: "${msg}"`);
  else console.log('✓ 잘못된 연결 코드 → 한국어 안내');
  await context.close();
}

await browser.close();
server.kill();

if (problems.length) {
  console.error('\nFAIL:\n' + problems.map(p => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nALL PASS — 390px 라이트/다크/예시 모드에서 콘솔 에러 0 · 가로 스크롤 0');
