# Retrospective

Project-specific learnings that carry across Codex/Claude Code sessions. Written by
`$wrapup` or `/wrapup` (with my approval), read at the start of relevant work.

This is NOT general task history or a changelog. It holds only durable,
project-specific knowledge: conventions, decisions, and anti-patterns.

---

## Conventions & decisions

- 상품 마스터 = `scm_global_move_master_item`; 입수량 = `box_count`, 조인키 `product_code` = cj_stock.`prodCd`; `pallet_load_count = box_count × full_pallet_box_count` (예: BA00021=108). cj_stock × 마스터 JOIN은 collation이 달라 양변에 `COLLATE utf8mb4_unicode_ci` 필수.
- 원본 CJ outbound 로직 출처 = 레포 `ysjeon-bstrs/scm_dashboard` → `scm_dashboard_v9/ui/cj_outbound.py` (SCM_GLOBAL 아님). 검증 코드 A~G, 배정 = 요청 유통기한 한정 + 같은 유통기한 잔여를 혼입 박스로 묶음.
- 회사 SCM MySQL은 read-only 풀(env `SCM_SOURCE_DB_*`, legacy `BOOSTERS_SCM_MYSQL_*`); `.env.local`에 실 자격증명 → 배포 사이클 대신 `node --env-file=.env.local`로 read-only SELECT 검증 (앱은 boosters.kr 인증 게이트라 로컬 브라우저 테스트 불가).
- 디자인 = impeccable(`.impeccable.md`): OKLCH tinted 팔레트 + Pretendard, 공유 프리미티브 `src/components/scm-dashboard/ui.tsx`, 토큰/공통 클래스 `globals.css`, AG 그리드는 flush + 전 컬럼 좌측정렬, 라이트 전용.
- Git: `main` 직접 push; push 전 `npm run lint && npx tsc --noEmit && npm run build`. 기능 커밋엔 기존 OSS 정리 변경(.env.example/README/docs/ 등) 섞지 말고 파일을 명시적으로 스테이징.
- Wrap-up 하네스는 Codex 전역 skill `C:\Users\BST-Desktop-051\.agents\skills\wrapup\SKILL.md`와 repo `AGENTS.md`의 Project memory 섹션으로 연결한다.
- 스택 = Next.js 16.2.4 / React 19.2.4(Turbopack). 동적 라우트 params는 Promise → `const { x } = await context.params` (AGENTS.md "this is NOT the Next.js you know"의 구체화).
- 단위 테스트는 `node --test --experimental-strip-types tests/X.test.mts` (Node 24)로 실행 — package.json엔 test 스크립트가 없다.
- ocean 정산 Supabase **read는 항상 `getSupabaseRestEnv({ requireServiceRole: true })`**; `apply` 플래그는 mart write(upsert)만 게이트하고 read 자격은 게이트하지 않는다(커밋 `aab1fe1` 불변식, dry-run/validate도 service role 필요).
- `supabaseGetAll(env, table, query)`의 `limit`은 전체 행 상한(cap)으로 동작 — 호출자가 set하면 그 수까지만, 없으면 전량 페이지네이션하며 페이지 크기를 남은 cap에 맞춰 줄인다.
- ocean 배부 DUTY 환산: `amount_krw+tax_krw` 우선 → 없으면 `amount_orig×(line.exrate || BL exrate 최빈값)` → 둘 다 없으면 `MISSING_DUTY_AMOUNT` 경고(다른 charge와 동일하게 장부 KRW 우선).

## Anti-patterns / gotchas

- CJ WMS 다운로드는 전량 배정(shortageEa === 0)일 때만 허용 — 부족분이 있으면 막아야 부분 파일이 안 나간다.
- Windows PowerShell `Get-Content` 출력이 한글 mojibake처럼 보여도 파일 인코딩 문제로 단정하지 말고 IDE/UTF-8 검사 결과를 우선 확인한다.
- `.claude/worktrees/*` worktree엔 node_modules가 없다 → 빌드 전 `npm ci` 필수. 부모 node_modules를 junction으로 연결하면 Turbopack이 "Symlink points out of filesystem root"로 패닉하니 금지.
- `.mts` 테스트가 확장자 없는 값 import를 하는 소스(예: `stagingStatus.ts`→`./supabaseRest`)를 거치면 strip-types에서 `ERR_MODULE_NOT_FOUND`; type-only import만 타는 테스트(allocation)는 통과한다.

## Open threads

- `AGENTS.md`의 Project memory 섹션 추가분은 아직 미커밋 상태이므로 사용자가 검토 후 커밋 여부를 결정한다.
- 정산 콘솔(ocean) 리뷰 잔여(P2/P3): stale mart 행 미삭제(upsert-only), orphaned `ocean/summary`·`ocean/bl/[blNo]` 라우트, `scripts/etl/.../sync-ocean-settlement.ts`와 `oceanRecompute.ts` 로직 중복+드리프트(etl_run_logs source/raw_rows), 반올림 정합·월별 재구성·month 필터, 파괴적 1클릭 재계산(dry-run 프리뷰 부재), raw JSON 피드백, 에러 메시지 노출, a11y, 중복 라우트(`/logistics-settlement`=`/ocean`), jobTypes 잔여 enum, test 스크립트 부재.
- 정산 콘솔은 AG Grid/GridFrame 대신 핸드롤 HTML 테이블(우측정렬 숫자) 사용 → 디자인 규칙(좌측정렬 AG Grid) 밖. 의도적 예외인지 결정 필요.
- 포털(`yoochiho/scm_portal`) 이식 보류 — 가능성 검증됨(WRITE 권한, 동일 스택, 같은 SCM DB). 작업: Supabase→`requireUser`/`withAuth`, DB→`queryMysqlScm`(positional `?`·제네릭 미지원), 포털 톤 리스킨, 네비 등록은 `automationNavigation.ts` 또는 `/settings/tabs`.
- 메인 SCM 대시보드 페이지는 CJ 페이지 수준의 정리(데이터·디자인)가 아직 미적용.
