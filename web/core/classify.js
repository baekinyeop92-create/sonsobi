/* 분류 — reference/app.html(v2)에서 동작 그대로 이식. 먼저 맞는 규칙이 이긴다 */
import { BUCKETS, CATS, catOf, FIX_CAT } from './categories.js';

export const RX_BILL_STRONG = /카드\s*(?:대금|결제대금|이용대금|청구대금)|카드대금/;
export const RX_BILL_WEAK = /(?:신한|삼성|현대|국민|KB|롯데|하나|우리|비씨|BC|농협|NH|씨티|IBK|기업)\s*(?:은행)?\s*카드/i;
export const RX_PAY = /머니.{0,20}충전|충전.{0,10}머니|페이\s*충전|포인트\s*충전/;
export const RX_PAY_DESC = /^(토스|토스페이|카카오페이|네이버페이|비바리퍼블리카|카카오페이머니|페이코)$/;
export const RX_SAVE = /적금|저축|청약|정기예금|펀드|증권|ISA|IRP|연금저축|퇴직연금|CMA|파킹|주식|투자|업비트|빗썸|코인원|금\s*현물/i;
export const RX_FIXED = /월세|관리비|임대료|통신|휴대폰|핸드폰|SKT|SK텔레콤|\bKT\b(?!X)|LG\s*U\+|LGU\+|유플러스|알뜰폰|보험|생명|화재|손해|넷플릭스|netflix|유튜브|youtube|spotify|스포티파이|멜론|웨이브|티빙|왓챠|디즈니|쿠팡\s*와우|와우\s*멤버십|네이버\s*플러스|구독|정기결제|도시가스|가스요금|전기요금|한국전력|수도요금|인터넷요금/i;

export const excl = why => ({ b: 'excl', why });

export function classify(r, st) {
  const ov = st.overrides[r.key];
  if (ov) { const [b, c] = ov.split(':'); if (BUCKETS.includes(b)) return { b, cat: b === 'spend' ? (CATS.includes(c) ? c : catOf(r.desc)) : '', why: '직접 지정', ov: true }; }
  const desc = r.desc || '';
  for (const rule of st.rules) if (rule.value && desc.includes(rule.value)) return { b: rule.bucket, cat: rule.bucket === 'spend' ? (rule.cat || catOf(desc)) : (rule.bucket === 'fixed' ? FIX_CAT(desc + ' ' + rule.value) : ''), why: `내 규칙 ‘${rule.value}’` };
  if (r.kind === 'manual') return { b: r.mb, cat: r.mb === 'spend' ? (r.mcat || catOf(desc)) : '', why: '직접 입력' };
  const out = r.amt < 0, all = desc + ' ' + (r.raw || '');
  const isPay = r.kind === 'card' || r.kind === 'pay';
  if (RX_BILL_STRONG.test(all)) return excl('카드대금 — 카드 사용 내역과 이중계산');
  const myName = (st.myName || '').replace(/\s/g, '');
  if (myName.length >= 2 && !isPay && desc.replace(/\s/g, '').includes(myName)) return excl('내 계좌 간 이체');
  if (RX_PAY.test(all) || (!isPay && RX_PAY_DESC.test(desc))) return excl('페이머니 충전 — 실제 결제는 따로 잡힘');
  if (!isPay && RX_BILL_WEAK.test(desc)) return excl('카드대금 — 카드 사용 내역과 이중계산');
  if (!out && /이자|배당/.test(all)) return { b: 'income', why: '이자·배당' };
  if (!out && /급여|월급|상여|보너스|성과급|환급/.test(all)) return { b: 'income', why: '급여·환급' };
  if (!isPay && RX_SAVE.test(desc)) return out ? { b: 'save', why: '저축·투자 이체' } : excl('저축·투자에서 돌아온 돈');
  if (out && RX_FIXED.test(desc)) return { b: 'fixed', cat: FIX_CAT(desc), why: '매달 나가는 돈' };
  if (isPay) return { b: 'spend', cat: catOf(desc), why: out ? '' : '결제 취소·환불' };
  if (!out) return excl('들어온 돈 — 수입이면 바꿔주세요');
  return /체크|카드|페이|결제|승인/.test(r.raw || '') ? { b: 'spend', cat: catOf(desc), why: '통장 출금 결제' } : { b: 'review', why: '누구에게 보낸 돈인지 확인 필요' };
}

/** FNV-1a 해시 — 규칙 id 생성용 (v2와 동일) */
export function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); }

/** 저장된 설정 JSON → 안전한 Settings 객체 (v2 normSettings와 동일) */
export function normSettings(d) {
  const s = { myName: '', rules: [], overrides: {} };
  if (d && typeof d === 'object') {
    if (typeof d.myName === 'string') s.myName = d.myName;
    if (Array.isArray(d.rules)) s.rules = d.rules.filter(r => r && r.value && BUCKETS.includes(r.bucket)).map(r => ({ id: String(r.id || fnv(r.value + r.bucket)), value: String(r.value), bucket: r.bucket, cat: CATS.includes(r.cat) ? r.cat : '' }));
    if (d.overrides && typeof d.overrides === 'object') for (const k in d.overrides) { const b = String(d.overrides[k]).split(':')[0]; if (BUCKETS.includes(b)) s.overrides[k] = String(d.overrides[k]); }
  }
  return s;
}
