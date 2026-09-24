# 순소비 캘린더 — Claude Code 작업 규칙

1인용 가계부 PWA. 카드·은행·페이 앱 알림 → 폰 자동화 → Apps Script → 구글 시트 → PWA(GitHub Pages).
전체 스펙: `docs/SPEC.md`. 이미 검증된 v2 원본: `reference/` (수정 금지, 옮길 때 참고만).

## 명령
- `npm test` — 해석·분류·집계(fixtures) + 서버 모의 테스트. 무엇을 고치든 커밋 전 통과.
- `npm run serve` — `web/`을 로컬 서버로 띄움 (의존성 없이 `scripts/serve.mjs`, http://localhost:8080)
- `npm run build:gas` — (P1) `web/core/*.js` → `apps-script/Core.gs`
- `npm run live-check` — `.env.local`의 실제 배포 URL로 적재·조회·거부·삭제 점검
- `npm run gas:push` — `clasp push --force` (확인 질문 없이. `--force`가 없으면 매니페스트가 바뀐 경우 조용히 건너뜀)
- `npm run gas:deploy` — push 후 **기존 배포 ID 갱신**(`GAS_DEPLOYMENT_ID`). 새 배포 금지
- 구글 로그인(`clasp login`)은 사용자가 `! npx clasp login`으로 직접 실행한다

## 지켜야 할 것
1. **원문이 원본이다.** 시트 '알림'의 행은 고치지 않는다. 해석은 브라우저(`web/core`)에서 매번 다시 한다.
2. **부호**: `amt` 음수 = 나간 돈, 양수 = 들어온 돈. 집계는 문자열 날짜(`yyyy-MM-dd`)로 묶는다 — Date 객체로 날짜를 다시 계산하지 않는다(시간대 문제).
3. **시간대**: 서버는 `Asia/Seoul`로 `yyyy-MM-dd HH:mm:ss` 텍스트를 쓴다. A열 텍스트 서식 유지.
4. **fixtures는 계약이다.** `test/fixtures/notifications.json`의 기대값을 바꾸려면 사용자 확인이 필요하다. 파서를 고칠 때는 케이스를 **추가**하고 기존 케이스는 그대로 통과시킨다.
5. **비밀 정보**: 토큰·스크립트 ID·배포 ID는 `.env.local`·`.clasp.json`·`apps-script/Secrets.gs`에만. 셋 다 `.gitignore`. 커밋 전 `git diff --cached`에 토큰 문자열이 없는지 확인.
6. **실제 알림 문구를 fixtures에 넣을 때 가명 처리** (저장소는 공개): 이름 → `홍*동`/`홍길동`, 계좌 → `123-45**-678`, 카드 끝자리 → `(1234)`, 날짜·시각 → 가상값(2026-09-24 기준), 금액·잔액·누적 → 임의 값, 지점명(○○점) → 삭제. 가맹점 상호와 문장 형식만 남긴다. 가명 처리 전 원문은 파일로 저장하지 않는다.
7. **배포 URL 고정**: Apps Script 업데이트 시 새 배포를 만들지 않는다. `clasp` 버전을 먼저 확인(`npx clasp --version`) — v3는 `update-deployment <id>`, v2는 `deploy -i <id>`.
8. `web/core/*.js`는 DOM·window를 쓰지 않는다. 최상위는 `export function` / `export const`만(서버 번들링 때 export만 지우면 되도록). import는 같은 폴더 파일끼리만.
9. 새 기능보다 **해석 정확도**가 우선. '인식 못 한 알림'이 생기면 먼저 파서를 고친다.
10. 알림 텍스트는 화면에 `esc()`/`textContent`로만 출력한다(WRITE 토큰만으로 넣을 수 있는 값이라 HTML로 넣으면 안 됨).
11. `apps-script/` 안에는 clasp로 올릴 파일만 둔다(예시 파일을 두면 함께 올라가 상수 중복 선언 오류). 서버 테스트는 Secrets.gs를 읽지 않고 가짜 토큰을 주입한다.

## 사용자가 알림 원문을 붙여넣으면 (/fix-parser)
1. 원문을 6번 규칙으로 가명 처리해 fixtures에 새 케이스로 추가(기대값은 사용자에게 한 줄씩 확인: 가맹점·금액·구분·항목).
2. `web/core/parse.js`(필요하면 classify) 수정 → `npm test` 전부 통과.
3. 커밋·푸시 → Pages 자동 배포. 서버 코드는 건드리지 않았다면 clasp 배포 불필요.
4. 무엇을 고쳤는지, 과거 내역 중 분류가 바뀌는 건이 있는지 한 줄로 보고.

## 용어 (화면 문구)
순소비 = 소비 + 고정지출 · 소비 · 고정지출 · 저축·투자 · 분류 필요 · 수입 · 제외 · 항목(식비·배달·카페/간식 …) · 인식 못 한 알림
