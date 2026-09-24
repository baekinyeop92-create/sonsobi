# 순소비 캘린더 v3 — Build Spec

## 1. 목표
카드·은행·페이 앱 푸시 알림을 폰 자동화로 **본인 구글 시트**에 모으고, 카드대금·중복 알림·내 계좌 이체를 뺀 **순소비**를 항목별로 캘린더·비중 그래프로 보여주는 1인용 가계부 **PWA**(홈 화면 앱).

v2(`reference/`)는 이미 동작·검증된 단일 파일 버전이다. v3는 이것을 **저장소 구조 + GitHub Pages PWA + Apps Script API**로 옮기는 작업이다. 해석·분류 동작은 바꾸지 않는다(fixtures로 고정).

## 2. 스택 & 제약 (확정)

| 영역 | 확정값 |
|---|---|
| 수집·저장·API | Google Apps Script 웹앱(V8) + 시트에 붙은 스크립트. 배포 도구 `@google/clasp`(devDependency) |
| 화면 | 빌드 없는 정적 PWA: HTML + CSS + vanilla JS(ES modules). GitHub Pages `https://<계정>.github.io/sonsobi/` |
| 공통 로직 | `web/core/*.js` — DOM 없음. 브라우저와 Node 테스트가 같은 파일을 import |
| 런타임 의존성 | 0개. devDependencies는 `@google/clasp`, `playwright`(화면 점검)만. Node 22, `"type":"module"`, 테스트는 `node --test` |
| 폰트 | Google Fonts `IBM Plex Sans KR` + `IBM Plex Mono`, 시스템 폰트 폴백 |

금지:
- 저장소(공개)에 토큰·스크립트 ID·배포 ID·실제 알림 원문 커밋 금지. `.env.local`, `.clasp.json`, `apps-script/Secrets.gs`는 `.gitignore`.
- 거래 데이터를 Apps Script·시트 밖 서버로 보내지 않는다. 분석·추적 스크립트 금지.
- Apps Script 웹앱이 화면(HTML)을 제공하지 않는다. `doGet`은 짧은 안내 텍스트만.

## 3. 구조

```
카드·은행·페이 앱 알림
  → 폰 자동화 (iOS 27+ 단축어 '알림' 트리거 / Android MacroDroid '알림 수신')
  → POST {k: WRITE_TOKEN, app, title, body}          ─┐
PWA (GitHub Pages)                                     ├→ Apps Script doPost → 시트 '알림'·'설정'
  → POST text/plain {action, k: READ_TOKEN, ...}     ─┘
```

- **토큰 2개**: `WRITE_TOKEN`(폰 자동화, 적재만 가능) / `READ_TOKEN`(앱: 읽기·설정 저장·직접 추가). 서로 대체 불가. 폰 자동화 설정이 노출돼도 내역은 못 읽는다.
- 토큰은 로컬에서 생성(각 32자 이상, crypto 난수) → `.env.local`과 `apps-script/Secrets.gs`(gitignore, clasp로는 push)에 기록. 코드는 `Secrets.gs`의 상수를 읽는다.
- 브라우저 → Apps Script: 헤더 없이 `fetch(API_URL, {method:'POST', body: JSON.stringify(...)})` (text/plain 단순 요청 → preflight 없음). Apps Script는 요청 헤더를 읽을 수 없으므로 토큰은 본문에 둔다.
- 앱 연결: 앱 첫 실행 시 **연결 코드**(`SNS1.` + base64url(JSON `{api, k}`))를 붙여넣음 → localStorage 저장. iOS 홈 화면 앱은 Safari와 저장공간이 따로라서 **홈 화면에 추가한 뒤 앱 안에서** 연결해야 한다(안내 문구에 명시).

## 4. API 계약 (doPost)

| 요청 | 토큰 | 응답 |
|---|---|---|
| `{k, app, title, body}` (JSON 또는 form-urlencoded) — action 없음 = 적재 | WRITE | `{ok:true}` / 90초 내 같은 app+title+body면 `{ok:true,dup:true}` / `{ok:false,error:'token'\|'empty'}` |
| `{action:'getData', k, since?:'yyyy-MM-dd'}` | READ | `{ok:true, rows:[[ts,app,title,body,id,manual]], settings:'<json>', serverTime}` |
| `{action:'saveSettings', k, settings:'<json>'}` | READ | `{ok:true}` / 45,000자 초과·JSON 아님 → `{ok:false,error}` |
| `{action:'addManual', k, entry:{desc,amt,choice,method,date}}` | READ | `{ok:true, row}` |
| `{action:'deleteManual', k, id}` (P1) | READ | 앱 이름 '직접 입력'인 행만 삭제 |
| `{action:'purgeLiveCheck', k}` | READ | app이 `__live_check__`인 행 삭제, `{ok:true, removed:n}` |

- 잘못된 토큰 조합(WRITE로 action, READ로 적재)은 모두 `{ok:false,error:'token'}`.
- 시트 '알림' 열: `받은시각(텍스트 'yyyy-MM-dd HH:mm:ss', Asia/Seoul) | 앱 | 제목 | 내용 | ID(uuid) | 직접입력(JSON 또는 '')`. A열은 텍스트 서식 — 날짜로 자동 변환되면 안 된다. 읽을 때는 `getDisplayValues()`.
- 시트 '설정' A1: Settings JSON.
- 동시 쓰기는 `LockService.getScriptLock().tryLock(10000)` — 실패 시 `{ok:false,error:'busy'}`.
- doPost 전체를 try/catch로 감싸 예외 시 `{ok:false,error:'server'}` JSON을 돌려준다(처리 안 된 예외는 CORS 헤더 없는 구글 오류 페이지가 되어 앱이 이유를 표시할 수 없다).
- `setup()`: 탭 생성 + 권한 승인용. 사람이 편집기에서 한 번 실행.
- **배포 URL 고정**: 업데이트는 항상 기존 배포 ID를 갱신한다(새 배포를 만들면 URL이 바뀌어 폰 자동화가 끊긴다). 배포할 때마다 버전이 하나씩 쌓이고 프로젝트당 200개가 한도다 — 갱신이 실패하면 편집기 '버전 관리'에서 오래된 버전을 지운 뒤 다시 시도.

## 5. 기능 명세

### P0 (없으면 실패)
- **[F1] 알림 적재** — 4장 표대로. AC: 테스트가 토큰 거부·중복 차단·JSON/form·토큰 분리를 모두 확인.
- **[F2] 알림 해석** `core/parse.js` — `test/fixtures/notifications.json`의 28개 케이스와 100% 일치. 규칙(v2와 동일):
  - 금액: 본문에서 먼저 찾고 없으면 제목+본문. `N원` 중 앞 12자 안에 `누적|잔액|한도|포인트|적립|가능|예정|청구|최소`가 붙은 것은 건너뜀. 없으면 '인식 못 한 알림'(USD·JPY·EUR·달러면 사유 '해외 결제').
  - 방향: `님이 …보냈|받았|입금|들어왔|환급|캐시백`(단 `출금|님에게` 없을 때) 또는 `취소` → 들어온 돈(+). 나머지 나간 돈(−).
  - 종류: `승인|일시불|할부|신용|체크`(체크카드출금 제외)이고 `출금|입금` 없음 → card / `출금|입금|이체|보냈|받았|잔액|송금` → bank / `결제|충전` → pay / 그 외 card. 직접 입력은 manual.
  - 가맹점: ① `X님에게 N원` ② `X님이 N원` ③ `X에서 N원` ④ `X N원 충전` → 'X 충전' ⑤ 마지막 `HH:MM` 뒤 ~ `누적|잔액…` 앞 ⑥ 금액 뒤 ⑦ 금액 앞 마지막 두 단어. 토큰 제거 목록은 v2 `stripTokens` 그대로(bank는 카드사 이름을 지우지 않음 — 카드대금 판별에 필요).
  - 결제수단: card는 본문의 카드사명(`현대카드`, `KB국민체크카드` …), 없으면 앱 이름. bank·pay는 앱 이름.
- **[F3] 분류** `core/classify.js` — 먼저 맞는 규칙이 이긴다:

  | 순서 | 조건 | 결과 |
  |---|---|---|
  | 1 | 사용자가 그 거래를 직접 지정 | 지정값 |
  | 2 | 사용자 규칙(가맹점에 문구 포함) | 규칙값 |
  | 3 | 직접 입력 | 입력한 항목 |
  | 4 | `카드대금·카드결제대금·카드이용대금` | 제외: 카드대금 |
  | 5 | 내 이름 포함 & card/pay 아님 | 제외: 내 계좌 간 이체 |
  | 6 | `머니…충전`, 가맹점이 `토스·카카오페이·네이버페이…` & card/pay 아님 | 제외: 페이머니 충전 |
  | 7 | card/pay 아님 & 가맹점이 `○○카드` | 제외: 카드대금 |
  | 8 | 들어온 돈 & `이자·배당` / `급여·월급·상여·환급` | 수입 |
  | 9 | card/pay 아님 & 가맹점이 적금·청약·증권·ISA·IRP… | 나감→저축·투자 / 들어옴→제외 |
  | 10 | 나감 & 가맹점이 월세·관리비·통신·보험·OTT·구독·공과금 | 고정지출(세부: 월세/관리비/통신/보험/공과금/구독) |
  | 11 | card/pay | 소비(항목은 가맹점 키워드, 모르면 기타). 들어옴=취소·환불(소비에서 차감) |
  | 12 | bank 들어옴 | 제외: 들어온 돈 |
  | 13 | bank 나감 & 원문에 `체크·카드·페이·결제·승인` | 소비 |
  | 14 | 나머지 bank 나감 | 분류 필요 |
- **[F4] 중복 제거** `core/dedupe.js` — 나간 돈 중(제외·저축·직접입력·직접지정 제외) 같은 금액이 ① 다른 앱에서 15분 안 → 우선순위 card > pay > bank 로 하나만 남김 ② 같은 앱에서 2분 안 & 같은 가맹점 → 뒤의 것 제외.
- **[F5] 집계·화면** — v2 화면 구성 그대로(요약·캘린더·날짜 패널·항목별 소비·최근 6개월·고정/저축 목록·확인할 것·전체 거래표). 산식:
  - 소비 = Σ(−금액) [소비] (환불은 음수로 차감) · 고정 · 저축 · 분류 필요도 같은 방식
  - 수입 = Σ금액 [수입] · 제외(나간) = Σ(−금액) [제외 & 나감]
  - **순소비 = 소비 + 고정지출** · 저축률 = 저축 ÷ 수입
  - 지난달 비교: 이번 달이 진행 중이면 지난달 1일~오늘 날짜까지와 비교
  - 캘린더 농도: 그 달 소비>0인 날들의 25·50·80 백분위로 4단계
  - fixtures 기준 기대값(`aggregate_2026_09`): 소비 407,900 / 고정 269,000 / 저축 800,000 / 분류 필요 682,000 / 수입 3,851,250 / 제외(나간) 2,302,340 / 순소비 676,900
- **[F6] 항목 수정·규칙 학습** — 거래마다 선택 상자(소비 17개 항목 + 고정지출·저축·투자·수입·제외). 바꾸면 그 거래만 지정 → "‘가맹점’ N건도 바꿀까요? [모두 적용]" → 규칙 저장. 설정은 `saveSettings`로 500ms 디바운스, 실패 시 안내.
- **[F7] 직접 추가** — 날짜·금액·내용·항목·결제수단.
- **[F8] PWA** — `manifest.webmanifest`(name 순소비 캘린더, short_name 순소비, start_url `./`, scope `./`, display standalone, theme/background 색, 아이콘 180·192·512 PNG + maskable, `apple-touch-icon` 링크). `sw.js`: `const VERSION = '__BUILD__'` — pages.yml이 배포 전에 커밋 해시로 치환하므로 배포마다 캐시가 바뀐다. 같은 출처 GET만 캐시하고 API(POST·다른 출처)는 건드리지 않는다. 새 버전이 설치되면 다음 실행에 반영. 마지막 `getData` 결과는 localStorage에 캐시 → 앱을 열면 캐시로 먼저 그리고 새로 불러옴. 오프라인이면 "오프라인 — 마지막 불러온 시각 표시".
- **[F9] 연결 화면** — 연결 전: "예시 데이터 보기" + "연결 코드 붙여넣기". 잘못된 코드/토큰이면 이유를 한국어로. 설정에 "연결 해제"(연결 정보·캐시 삭제).
- **[F10] 설치 안내 페이지** `web/setup.html` — v2 `renderSetup()`에서 **‘폰 자동화 만들기’ 탭만** 옮긴다(시트 만들기·코드 붙여넣기·두 번 배포·testPost·브라우저 토큰 생성은 v3에 해당 없음 — 옮기지 않는다). 주소는 ‘받기 주소’ 하나, 값은 "Claude Code가 마지막에 알려준 받기 주소와 WRITE_TOKEN"을 쓰라고 안내. 아이폰: JSON 본문 `{k, app, title, body}`. 안드로이드(MacroDroid): 본문을 form(키-값) 방식으로 `k, app, title, body` — k를 URL 쿼리에 넣지 않는다. setup.html에 API_URL·토큰·배포 ID를 넣지 않는다.

### P1
- **[F11] 주간 요약 메일** — 월요일 08:00 Apps Script 시간 트리거 → 지난주 순소비·상위 3개 항목·분류 필요 건수를 본인 Gmail로. `core/*.js`를 `scripts/build-gas.mjs`가 `apps-script/Core.gs`로 합쳐 서버에서도 같은 분류를 쓴다.
- **[F12] 원문 복사** — '인식 못 한 알림'과 '가맹점 미확인' 행에 "원문 복사" 버튼 (파서 보정 요청용).
- **[F13] 직접 입력 삭제** — `deleteManual`.

### P2
- 뱅크샐러드 엑셀로 과거 1년 채우기(v1 방식, 날짜+금액 중복 제거) · 월 예산 · 설정 백업 파일

## 6. 데이터 모델
```
Raw row   [ts:string, app, title, body, id:uuid, manual:JSON|'']
Tx        {key:id, ts, date:'yyyy-MM-dd', time:'HH:MM', desc, amt:number(나감 −, 들어옴 +), method, kind:'card'|'bank'|'pay'|'manual', src:app, raw}
Row       Tx + {b:'spend'|'fixed'|'save'|'review'|'income'|'excl', cat, why, ov:boolean}
Settings  {myName, rules:[{id, value, bucket, cat}], overrides:{[id]: 'spend:식비'|'fixed'|'save'|'income'|'excl'}}
CATS      식비·배달·카페/간식·편의점/마트·온라인쇼핑·교통·자동차·생활·뷰티/미용·의료/건강·문화/여가·술/유흥·여행/숙박·교육·경조/선물·반려동물·기타
```
원문(Raw)이 유일한 원본이다. 해석 결과는 저장하지 않는다 → 파서를 고치면 과거 내역에도 다시 적용된다.

**테스트 필드 대응** (fixtures ↔ 코드)

| fixtures | 코드 |
|---|---|
| `cases[].id` | 원문 행 ID(`raw[4]`)로 사용 |
| `input.{ts,app,title,body}` | `raw[0..3]`, `raw[5]=''` |
| `expect.amount` | `amt` |
| `expect.bucket` | `b` |
| `expect.category` | `cat`, 빈 값이면 `null` |
| `expect.reason` | `why`, 빈 값이면 `null` |
| `expect.unrecognized` / `reason` | 해석 결과 `unrec` / `why` |
| `settings` | 분류·중복 제거에 쓰는 설정(myName=홍길동). 28개를 한 묶음으로 해석→분류→중복 제거한 뒤 비교 |
| `aggregate_2026_09.outTotal` | max(0,소비)+max(0,고정)+max(0,저축)+max(0,분류 필요)+제외(나간) — v2 `renderHero`와 같음 |

## 7. UI 디렉션
`reference/app.html`의 디자인을 그대로 옮긴다: 색 토큰(라이트/다크), 검증된 계열 색(소비 #2a78d6 · 고정 #eb6834 · 저축 #1baf7a · 분류 필요 #eda100, 다크 단계값 포함), 기호 모양(막대·원·네모·세모·+·×)으로 색 없이도 구분, 달력 일요일 빨강·토요일 파랑, 금액 칸은 만원 단위 축약(`3.2만`). 390px 폭에서 가로 스크롤 0. 홈 화면 앱이므로 상단에 `env(safe-area-inset-top)` 여백.

## 8. 비기능
- 캐시가 있으면 첫 화면 1초 안에 표시, 새로 불러오기는 뒤에서.
- 2,000행(1년치) 해석+집계 200ms 이하(데스크톱 기준).
- 보안: 알림 텍스트(가맹점·원문·앱 이름)는 WRITE 토큰만 있으면 누구나 넣을 수 있는 값이다. 화면에는 `esc()` 또는 `textContent`로만 출력한다(v2 방식 유지).
- 접근성: 버튼 aria-label, 키보드로 캘린더·막대 조작, 색만으로 구분 금지.
- 엣지: 알림 0건 / 금액 없는 알림 / 해외 결제 / 같은 금액 연속 결제(2분 넘으면 둘 다 인정) / 취소(+) / 월 경계 / 미래 날짜 / 긴 가맹점명 / 이모지 / 네트워크 실패 / 토큰 틀림.

## 9. 완성 기준 (DoD)
1. `npm test` 통과 — fixtures 28/28, 집계 기대값 일치, 서버 모의 테스트(토큰 분리·중복·JSON/form·action 라우팅·purge) 통과.
2. `npm run live-check` 전부 ✓ — 실제 배포 URL에 WRITE로 적재 → READ로 조회 시 포함 → WRITE로 조회 거부 → READ로 적재 거부 → 테스트 행 삭제.
3. GitHub Pages 주소가 200, 헤드리스 브라우저(390px·다크·예시 모드)에서 콘솔 에러 0, 가로 스크롤 0.
4. 연결 코드로 PWA를 연결하면 오류 없이 "아직 받은 알림이 없어요" 안내가 보인다(live-check 테스트 행은 이미 삭제된 상태).
5. (사람) 실제 결제 1건 → 1분 안에 앱 오늘 칸에 표시.
