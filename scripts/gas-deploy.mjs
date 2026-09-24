/* Apps Script 배포 갱신 — 항상 .env.local의 GAS_DEPLOYMENT_ID를 갱신한다.
   새 배포를 만들면 URL이 바뀌어 폰 자동화·연결 코드가 전부 끊기므로 금지.
   clasp v3는 update-deployment, v2는 deploy -i (CLAUDE.md 7번). */
import { spawnSync } from 'node:child_process';

const id = process.env.GAS_DEPLOYMENT_ID;
if (!id) {
  console.error('GAS_DEPLOYMENT_ID가 .env.local에 없습니다. 첫 배포 뒤 저장된 ID가 필요합니다.');
  process.exit(1);
}

const verOut = spawnSync('npx', ['clasp', '--version'], { encoding: 'utf8' });
const ver = (verOut.stdout || '').trim();
const major = parseInt(ver, 10);
const args = major >= 3
  ? ['clasp', 'update-deployment', id, '-d', '순소비 웹앱']
  : ['clasp', 'deploy', '-i', id, '-d', '순소비 웹앱'];

console.log(`기존 배포 갱신 (clasp ${ver || '?'}): npx ${args.join(' ')}`);
const r = spawnSync('npx', args, { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\n배포 갱신에 실패했습니다. 버전이 200개 한도에 걸렸다면 Apps Script 편집기의');
  console.error('[배포 › 배포 관리]에서 오래된 버전을 지운 뒤 다시 시도하세요. (새 배포 생성은 금지 — URL이 바뀝니다)');
  process.exit(r.status ?? 1);
}
