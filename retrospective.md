# Retrospective

Project-specific learnings that carry across Codex/Claude Code sessions. Written by
`$wrapup` or `/wrapup` (with my approval), read at the start of relevant work.

This is NOT general task history or a changelog. It holds only durable,
project-specific knowledge: conventions, decisions, and anti-patterns.

---

## Conventions & decisions

- 상품 마스터 = `scm_global_move_master_item`; 입수량 = `box_count`, 조인키 `product_code` = cj_stock.`prodCd`; `pallet_load_count = box_count × full_pallet_box_count` (예: BA00021=108). cj_stock × 마스터 JOIN은 collation이 달라 양변에 `COLLATE utf8mb4_unicode_ci` 필수.
- 원본 CJ outbound 로직 출처 = 레포 `ysjeon-bstrs/scm_dashboard` → `scm_dashboard_v9/ui/cj_outbound.py` (SCM_GLOBAL 아님). 검증 코드 A~G, 배정 = 요청 유통기한 한정 + 같은 유통기한 잔여를 혼입 박스로 묶음.
- (SCM MySQL read-only 접근·boosters.kr 인증 게이트는 전역 회고로 이동 — `~/.claude/retrospective.md`)
- 디자인 = impeccable v3.9.1: 컨텍스트는 `PRODUCT.md`+`DESIGN.md`(+`.impeccable/design.json`), `.impeccable.md`는 삭제됨. 팔레트 = portal blue `#2563eb` + slate 중립 + ok/warn/danger 3-state + Pretendard, 공유 프리미티브 `src/components/scm-dashboard/ui.tsx`, 토큰/공통 클래스 `globals.css`, AG 그리드는 flush + 전 컬럼 좌측정렬, 라이트 전용.
- Amazon DOH: `fetchAmazonDohSummary`는 선택 센터여도 SQL 센터필터 없이 스냅샷 전체를 fetch → `buildAmazonDohSummary`가 actions/totals만 selectedCenter로 JS 스코프, 센터 요약은 항상 4개 전부 표시(라이브 mart로 검증).
- Amazon 페이지 표 = 핸드롤 우측정렬 + 클릭 정렬(`SortTh`, `aria-sort`) — 정산 콘솔과 동일한 **"AG Grid 좌측정렬 규칙의 의도적 예외"로 확정**(사용자 선택). AG 규칙은 AG 그리드에만 적용.
- Git: `main` 직접 push; push 전 `npm run lint && npx tsc --noEmit && npm run build && npm test`. 기능 커밋엔 기존 OSS 정리 변경(.env.example/README/docs/ 등) 섞지 말고 파일을 명시적으로 스테이징.
- Wrap-up 하네스는 Codex 전역 skill `C:\Users\BST-Desktop-051\.agents\skills\wrapup\SKILL.md`와 repo `AGENTS.md`의 Project memory 섹션으로 연결한다.
- 스택 = Next.js 16.2.4 / React 19.2.4(Turbopack). 동적 라우트 params는 Promise → `const { x } = await context.params` (AGENTS.md "this is NOT the Next.js you know"의 구체화).
- 단위 테스트는 **`npm test`(= `tsx --test tests/*.test.mts`, tsx=devDep)로 실행 — 44개**. (tsx가 확장자 없는 TS import를 해석)
- ocean 정산 Supabase **read는 항상 `getSupabaseRestEnv({ requireServiceRole: true })`**; `apply` 플래그는 mart write(upsert)만 게이트하고 read 자격은 게이트하지 않는다(커밋 `aab1fe1` 불변식, dry-run/validate도 service role 필요).
- `supabaseGetAll(env, table, query)`의 `limit`은 전체 행 상한(cap)으로 동작 — 호출자가 set하면 그 수까지만, 없으면 전량 페이지네이션하며 페이지 크기를 남은 cap에 맞춰 줄인다.
- ocean 배부 DUTY 환산: `amount_krw+tax_krw` 우선 → 없으면 `amount_orig×(line.exrate || BL exrate 최빈값)` → 둘 다 없으면 `MISSING_DUTY_AMOUNT` 경고(다른 charge와 동일하게 장부 KRW 우선).
- ocean recompute **stale-row cleanup은 full 런(month·limit 없음)에서만** (delete-after-upsert, `etl_run_id≠현재`, scope=`settlement_month`). month/limit 런은 cleanup skip + **month+apply 차단**(서버 `MONTH_SCOPED_APPLY_DISABLED` + UI 비활성) → 월 런은 dry-run/검증 전용.
- ocean mart 매핑(`toMartDocRow`/`buildMonthlyRows`/`summarizeAllocation`/etl-log row)은 **`oceanMart.ts` 단일 소스** — 웹 recompute(`oceanRecompute.ts`)와 CLI `sync-ocean-settlement.ts`가 공유(재복제 금지).
- 정산 콘솔 **canonical 라우트 = `/global/logistics-settlement`**(멀티모드 콘솔); `/ocean`은 거기로 redirect. 홈/overview 링크도 canonical을 가리킴.
- CJ 전체 재고 스냅샷 로드 = `/api/scm-dashboard/cj-lot-stock?latestOnly=true`, **cap 100000**; 클라이언트는 `rows.length===limit`이면 잘림으로 보고 **배정·다운로드를 차단**.

## Anti-patterns / gotchas

- CJ WMS 다운로드는 전량 배정(shortageEa === 0)일 때만 허용 — 부족분이 있으면 막아야 부분 파일이 안 나간다.
- `.claude/worktrees/*` worktree엔 node_modules가 없다 → 빌드 전 `npm ci` 필수. 부모 node_modules를 junction으로 연결하면 Turbopack이 "Symlink points out of filesystem root"로 패닉하니 금지.
- 테스트는 `npm test`(tsx)로 — tsx는 확장자 없는 TS import를 해석하지만, raw `node --test --experimental-strip-types`는 그런 소스 값-import(예: `stagingStatus.ts`→`./supabaseRest`)에서 `ERR_MODULE_NOT_FOUND`로 깨진다.
- **month-scoped ocean recompute는 불완전** — moves는 `onboard_date` 월로, settlement는 `invoice_date` 월로 필터해서 월 경계 BL(onboard M·invoice M+1)이 어느 월 런에서도 배정 안 됨. 그래서 월 cleanup/apply를 막아둠(정식화는 open thread ①).
- CJ 배정 입력(depot/outboundType/업로드/manualLots/selectedLotSet) 변경 시 **`allocResult`를 비워야** — 안 그러면 동결된 배정 결과로 라이브 validRows를 다운로드해 잘못된 창고로 나갈 수 있다.
- **Edit 툴 phantom-write**: 이 레포(Windows) 일부 소스에서 Edit이 "성공"을 보고하고 Read가 수정본을 보여줘도 디스크 미반영(CRLF↔LF 정규화로 도구별 파일 뷰가 갈리는 것으로 추정). → "빌드 green = 반영됨"으로 믿지 말 것. 편집은 `git diff`/`grep`(디스크 직접)/라이브 렌더로 검증하고, 안 맞으면 node fs나 whitespace-tolerant 정규식으로 한 뷰 안에서 편집 후 재확인. 데이터 로직도 gate green≠correct — 서비스롤 CLI로 실증.

## Open threads

- `AGENTS.md`의 Project memory 섹션 추가분은 아직 미커밋 상태이므로 사용자가 검토 후 커밋 여부를 결정한다.
- 정산 콘솔(ocean) P2/P3는 대부분 해결됨(stale cleanup band-aid·라우트 삭제/통합·CLI 단일화·반올림/월별/month 필터·confirm+dry-run·구조화 결과·에러 위생·a11y·jobTypes 정리·test 스크립트). 남은 후속 = ① 월별 recompute 정식화.
- **① 월별 ocean recompute 정식화** (데이터 커지면): BL 소속월 = `max(invoice_date)`의 YYYY-MM · 대상월 후보 = 그 max가 M인 BL("M월 라인 있는 BL" 아님) · 확정 BL은 settlement 라인 전월 포함 전량 fetch · moves는 `bl_no IN (...)`(onboard 무관) · 그때 month-scoped cleanup/apply 재활성.
- 레포 전체 리뷰 백로그(비정산 P2/P3): **CJ**(혼합박스 주문번호·PDF명 중복, `selectedLotSet` `lot_no`-only 키 충돌, BoxID 거대범위 hang, SKU 대소문자) · **Amazon**(DOH stale 행 미삭제, 미출고 수량이 velocity에 포함) · **domestic**(summary가 cap된 페이지로 집계, 버킷 페이지네이션 ORDER BY 부재, 제외버킷 만료 blind) · **scm-core**(공유 컴포넌트 6종 + `/api/scm-dashboard` GET·transform/queries/excel 데드, overview KPI 5000 cap 합산) · **platform**(`assertReadOnlySql`가 `INTO OUTFILE`/내부 세미콜론 허용, signout POST CSRF 없음, forbidden-domain signOut이 SC 렌더 중 쿠키 미삭제).
- 메인 SCM 대시보드 페이지는 CJ 페이지 수준의 정리(데이터·디자인)가 아직 미적용.
