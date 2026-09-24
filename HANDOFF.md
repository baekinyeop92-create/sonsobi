# Claude Code 인계

## 사람이 먼저 할 것 (5분)
1. 이 폴더 압축을 풀고 터미널에서 폴더로 이동 → `claude` 실행
2. Node 22 이상 (`node -v`)
3. GitHub 로그인: `gh auth login`
4. 구글: https://script.google.com/home/usersettings 에서 **Google Apps Script API** 켜기
5. 폰 기종 확인: 아이폰이면 iOS 27 이상이어야 알림 자동화가 됩니다

Claude Code가 중간에 두 번 멈추고 부탁합니다.
- ① 구글 로그인: Claude Code 입력창에 `! npx clasp login` 을 직접 입력 → 브라우저에서 허용
- ② Apps Script 편집기에서 `setup` 함수를 한 번 실행 → 권한 허용

## 붙여넣을 프롬프트

```
이 폴더는 '순소비 캘린더' v3 인계 패키지야. CLAUDE.md와 docs/SPEC.md를 먼저 끝까지 읽고, reference/(검증된 v2 원본)를 이식 기준으로 삼아 아래 순서대로 만들어줘. 각 단계 끝의 확인이 통과해야 다음 단계로 가. 막히면 추측하지 말고 멈춰서 물어봐.

0. 확인: node reference/server.test.v2.cjs → ALL PASS.

1. 저장소 뼈대
   - git init -b main
   - package.json: "type":"module", 런타임 의존성 0. devDependencies는 @google/clasp와 playwright만.
     scripts: "test":"node --test test/*.test.mjs", "serve":"node scripts/serve.mjs", "live-check":"node --env-file=.env.local scripts/live-check.mjs", "gas:push":"clasp push --force", "gas:deploy":"clasp push --force && node --env-file=.env.local scripts/gas-deploy.mjs", "icons":"node scripts/make-icons.mjs" (P1 때 "build:gas":"node scripts/build-gas.mjs" 추가)
   - .gitignore: .env.local, .clasp.json, apps-script/Secrets.gs, node_modules, .claude/settings.local.json, private/
   - 폴더: web/(index.html, app.js, styles.css, setup.html, manifest.webmanifest, sw.js, icons/), web/core/, apps-script/(Code.gs, appsscript.json), scripts/, test/, .github/workflows/pages.yml

2. 공통 로직 이식: reference/app.html의 해석·분류·중복·집계 코드를 동작 변경 없이 web/core/{categories,parse,classify,dedupe,aggregate}.js로 옮겨.
   test/core.test.mjs: fixtures 28개 전부 일치 + aggregate_2026_09 기대값 일치. 필드 대응은 SPEC 6장 '테스트 필드 대응' 표대로.
   확인: npm test 통과.

3. 서버: reference/Code.gs를 SPEC 4장 API로 바꿔. 토큰은 apps-script/Secrets.gs의 `const WRITE_TOKEN = '…'; const READ_TOKEN = '…';`에서 읽어(이 파일은 5단계에서 생성). doGet은 안내 문구만. doPost 전체 try/catch, 잠금은 tryLock(10000).
   appsscript.json: timeZone Asia/Seoul, runtimeVersion V8, webapp {executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS}, 필요한 최소 oauthScopes.
   test/server.test.mjs: reference/server.test.v2.cjs를 옮기되 Secrets.gs를 읽지 말고 vm 컨텍스트에 가짜 토큰을 주입해. 토큰 분리·action 라우팅·purgeLiveCheck·예외 시 {ok:false,error:'server'} 케이스 추가.
   확인: npm test 통과.

4. PWA 화면: reference/app.html의 화면·디자인을 web/으로 옮기고 google.script.run 대신 fetch API 클라이언트(헤더 없는 text/plain POST)로 바꿔. 연결 화면(연결 코드 SNS1.…), 연결 전 예시 데이터 모드, 마지막 데이터 캐시·오프라인 표시, manifest, sw.js(SPEC F8대로 버전 치환), 아이콘(scripts/make-icons.mjs가 Node 내장 zlib만으로 PNG 생성), setup.html(SPEC F10대로).
   알림 텍스트는 v2처럼 esc()/textContent로만 출력해.
   확인: npm run serve 후 playwright로 390px·다크·예시 모드에서 콘솔 에러 0, 가로 스크롤 0.

5. Apps Script 배포
   - 토큰 2개를 crypto 난수(각 32자 이상)로 만들어 .env.local(WRITE_TOKEN, READ_TOKEN)과 apps-script/Secrets.gs에 써.
   - npx clasp --version 확인. 여기서 멈추고 나한테 로그인을 부탁해(내가 `! npx clasp login` 실행).
   - cp apps-script/appsscript.json /tmp/manifest.keep → 시트에 붙은 새 프로젝트 생성(npx clasp create --type sheets --title "순소비" --rootDir apps-script, v3 명령 이름이 다르면 맞춰서) → cp /tmp/manifest.keep apps-script/appsscript.json → npm run gas:push. 출력에 Code.gs·Secrets.gs·appsscript.json이 모두 있어야 해. (clasp create가 매니페스트를 덮어쓰고, 확인 질문이 뜨면 push가 조용히 건너뛰기 때문)
   - 여기서 멈추고 나한테 "편집기에서 setup 실행"을 부탁해. 끝났다고 하면 웹 앱 배포 → API_URL(…/exec)과 GAS_DEPLOYMENT_ID를 .env.local에 저장. scripts/gas-deploy.mjs는 이후 업데이트 때 항상 이 ID를 갱신(새 배포 금지).
   - npm run live-check 전부 ✓ (적재 → 조회 포함 → WRITE로 조회 거부 → READ로 적재 거부 → 테스트 행 삭제).

6. GitHub Pages
   - pages.yml: on push(main) + workflow_dispatch, sw.js의 __BUILD__를 ${GITHUB_SHA}로 치환, actions/upload-pages-artifact의 path는 web.
   - 순서: gh repo create sonsobi --public --source . --remote origin → gh api -X POST repos/{owner}/sonsobi/pages -f build_type=workflow → git diff --cached에 토큰·배포 ID가 없는지 확인 → 커밋 → git push -u origin main → 워크플로 성공 → https://<계정>.github.io/sonsobi/ 가 200인지 확인.

7. 마지막 보고 (이것만, 짧게)
   - 앱 주소 (Pages)
   - 연결 코드 (SNS1.…) — 폰 홈 화면에 추가한 뒤 앱 안에서 붙여넣을 값
   - 폰 자동화용: 받기 주소(API_URL)와 WRITE_TOKEN
   - DoD(SPEC 9장) 항목별 통과 여부, 못 한 것과 이유

P1(주간 요약 메일, 원문 복사, 직접 입력 삭제)은 P0가 모두 끝나고 내가 요청하면 해.
```

## 끝난 뒤 사람이 할 것
1. 폰 Safari(또는 크롬)로 앱 주소 열기 → 공유 › **홈 화면에 추가** → 홈 화면 아이콘으로 열고 연결 코드 붙여넣기 (아이폰은 홈 화면 앱과 Safari의 저장공간이 따로라서 꼭 앱 안에서)
2. 앱의 설치 안내(setup.html)대로 카드·은행 앱마다 폰 자동화 만들기 (받기 주소 + WRITE_TOKEN)
3. 카드로 한 번 결제 → 1분 안에 오늘 칸에 뜨는지 확인
4. 1주일 뒤 '인식 못 한 알림'·'기타' 원문을 Claude Code에 `/fix-parser 원문…` 으로 붙여넣기 (가명 처리 후 파서 보정)
