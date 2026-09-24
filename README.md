# 순소비 캘린더 v3 — 인계 패키지

카드·은행 앱 알림을 자동으로 모아, 카드대금·중복 알림·내 계좌 이체를 빼고 실제 소비를 항목별로 보여주는 가계부 앱을 Claude Code로 만들기 위한 폴더입니다.

| 파일 | 용도 |
|---|---|
| `HANDOFF.md` | **여기부터.** 사람이 할 준비 5가지 + Claude Code에 붙여넣을 프롬프트 |
| `CLAUDE.md` | Claude Code가 매번 자동으로 읽는 작업 규칙 |
| `docs/SPEC.md` | 전체 설계서 (구조·API·분류 규칙·완성 기준) |
| `test/fixtures/notifications.json` | 알림 28개 예시와 기대 결과 — 파서가 지켜야 할 기준 |
| `reference/` | 이미 동작·검증된 v2 (화면 + 서버 + 서버 테스트). Claude Code가 옮겨 쓸 원본 |
| `.claude/commands/fix-parser.md` | 나중에 실제 알림으로 파서를 고칠 때 쓰는 `/fix-parser` 명령 |

완성되면: 폰 홈 화면의 '순소비' 앱 + 내 구글 시트(원본 데이터) + 공개 GitHub 저장소(코드만, 데이터·토큰 없음).
