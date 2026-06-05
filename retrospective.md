# Retrospective

Project-specific learnings that carry across Claude Code sessions. Written by
`/wrapup` (with my approval), read at the start of relevant work.

This is NOT general task history or a changelog. It holds only durable,
project-specific knowledge: conventions, decisions, and anti-patterns.

---

## Conventions & decisions

- 상품 마스터 = `scm_global_move_master_item`; 입수량 = `box_count`, 조인키 `product_code` = cj_stock.`prodCd`; `pallet_load_count = box_count × full_pallet_box_count` (예: BA00021=108). cj_stock × 마스터 JOIN은 collation이 달라 양변에 `COLLATE utf8mb4_unicode_ci` 필수.
- 원본 CJ outbound 로직 출처 = 레포 `ysjeon-bstrs/scm_dashboard` → `scm_dashboard_v9/ui/cj_outbound.py` (SCM_GLOBAL 아님). 검증 코드 A~G, 배정 = 요청 유통기한 한정 + 같은 유통기한 잔여를 혼입 박스로 묶음.
- 회사 SCM MySQL은 read-only 풀(env `SCM_SOURCE_DB_*`, legacy `BOOSTERS_SCM_MYSQL_*`); `.env.local`에 실 자격증명 → 배포 사이클 대신 `node --env-file=.env.local`로 read-only SELECT 검증 (앱은 boosters.kr 인증 게이트라 로컬 브라우저 테스트 불가).
- 디자인 = impeccable(`.impeccable.md`): OKLCH tinted 팔레트 + Pretendard, 공유 프리미티브 `src/components/scm-dashboard/ui.tsx`, 토큰/공통 클래스 `globals.css`, AG 그리드는 flush + 전 컬럼 좌측정렬, 라이트 전용.
- Git: `main` 직접 push; push 전 `npm run lint && npx tsc --noEmit && npm run build`. 기능 커밋엔 기존 OSS 정리 변경(.env.example/README/docs/ 등) 섞지 말고 파일을 명시적으로 스테이징.

## Anti-patterns / gotchas

- CJ WMS 다운로드는 전량 배정(shortageEa === 0)일 때만 허용 — 부족분이 있으면 막아야 부분 파일이 안 나간다.

## Open threads

- 포털(`yoochiho/scm_portal`) 이식 보류 — 가능성 검증됨(WRITE 권한, 동일 스택, 같은 SCM DB). 작업: Supabase→`requireUser`/`withAuth`, DB→`queryMysqlScm`(positional `?`·제네릭 미지원), 포털 톤 리스킨, 네비 등록은 `automationNavigation.ts` 또는 `/settings/tabs`.
- 메인 SCM 대시보드 페이지는 CJ 페이지 수준의 정리(데이터·디자인)가 아직 미적용.
