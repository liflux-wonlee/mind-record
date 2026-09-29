# 리마인드 · 오늘의 브리핑

"말해 두면 기억하고, 필요할 때 알려주며, 눌러서 오늘 챙길 내용을 들을 수 있다."

이 문서는 리마인드 기능의 구조, 정책, 배포 순서, 검증 범위를 정리합니다. 요구사항 원문은
`Mind_Record_Reminders_Claude_Prompt.md`(2026-09-29)입니다.

---

## 1. 개념

| 개념 | 저장 위치 | 설명 |
| --- | --- | --- |
| 기록·아이디어·Task (대상) | `sessions` / `memories` / `tasks` | 리마인드 때문에 복제·삭제되지 않음 |
| 리마인드 규칙 | `reminders` | 대상 하나에 언제 다시 알릴지. `due`(마감 상대) · `daily`(완료까지 매일) · `once`(특정 시각) · `context`(상황: 집/사무실) |
| 반복 업무 | `tasks.recur_freq/interval/anchor` + `task_completions` | 이번 회차 완료 → 다음 회차로 이동, 이력 보존 |
| 발송 | `reminder_deliveries` | 설치 기기 × 대상 × 시각당 한 행 (중복 발송 방지 키) |
| 기기 | `push_installations` | 앱 설치 하나 = 한 행. 로그인한 계정 소유, 로그아웃 시 삭제 |
| 브리핑 | `reminder_briefings` | 같은 내용이면 대본 재사용, 마지막 브리핑 순서("두 번째") |

- **Task 하나에 규칙 여러 개**여도 홈 개수·목록·브리핑에서는 **항목 하나**입니다 (`reminder_agenda()`가 대상별로 묶음).
- 날짜가 있는 Task에는 **자동 알림(전날 + 당일, 기본 09:00)**이 트리거로 붙습니다. 사용자가 시각을 따로 정하면(특정 시각·매일) 자동 알림은 `replaced`로 멈춥니다.
- 기록/아이디어에 붙인 알림은 Task를 만들지 않습니다. "확인"하면 알림만 끝나고 원본은 그대로입니다.

## 2. 시간 계산 규칙 (`reminder_next_fire`)

모든 "다음 알림 시각"은 DB 함수 하나에서 계산하고 `reminders.next_fire_at`에 트리거로 유지합니다. 앱·발송 서버·음성 도구가 같은 답을 봅니다.

- 마감일은 **날짜만** (`tasks.due_date date`). 알림 시각 = `(현지 날짜 + 현지 시각) AT TIME ZONE 사용자 시간대`.
- "하루 전" = 현지 달력 하루 전. DST로 23/25시간인 날도 09:00 그대로 (테스트: 뉴욕 11/1 · 3/14).
- 이미 지난 시각은 다시 만들지 않음: 새 규칙·변경 시 기준은 "지금", 이미 보낸 회차 이후만 계산 → **과거 알림 폭주 없음**.
- 오늘 마감인데 09:00이 지난 뒤 만든 Task: 푸시는 없고 홈 "오늘 챙길 것"에 바로 표시.
- 날짜 변경 → 재계산. 날짜 삭제 → 마감 연동(`due`) 알림만 멈추고 따로 정한 알림은 유지.
- 완료·취소 → 모든 알림 종료. 다시 미완료 → 미래 회차만 되살림 (지난 회차 재발송 없음). 삭제 → 알림도 삭제.
- 시간대·기본 시각 변경 → 아직 안 보낸 회차만 재계산, 날짜는 그대로.
- 발송 서버가 6시간 넘게 멈췄다가 돌아오면 그 사이 회차는 보내지 않고 건너뜀(`stale`).

### 기본값과 방해 금지
- 기본 알림 시각 09:00, 전날·당일 둘 다 켜짐, 방해 금지 22:00~08:00, 잠금 화면 미리보기 켜짐 (`profiles` 컬럼, 설정 화면에서 변경).
- **자동 알림**은 방해 금지 시간에 걸리면 끝나는 시각으로 이동. 설정 화면은 기본 시각을 방해 금지 안으로 고르지 못하게 함.
- **사용자가 직접 정한 시각**은 그대로 지킴 (방해 금지와 겹치면 앱/음성이 그렇게 안내).
- **미루기**가 방해 금지에 걸리면 끝나는 시각으로 옮기고 실제 시각을 알려줌.

### 계속 챙기기 · 무응답 · 반복 업무
- "완료할 때까지 계속" = **하루 한 번 기본 시각** (`daily`). 전날/당일/매일이 같은 시각에 겹치면 기기당 한 번.
- 무응답이라고 자동으로 멈추거나 빈도를 바꾸지 않음. 읽거나 들었다고 완료 처리하지 않음.
- 반복 업무(매일/매주/매월): 완료하면 기준일(anchor)에서 다음 회차 계산 — 31일 기준 월 반복은 2월 28(29)일 → 3월 31일 (완료한 날로 기준이 옮겨지지 않음). "반복 중단" 후 완료하면 Task가 닫힘.
- 선행 마감("생신 3일 전까지 주문"): 생신 날짜 − 3 **달력일**을 Task 마감으로 저장하고 근거를 메모로 남김. 이미 지났으면 날짜를 옮기지 않고 늦었다고 표시.

## 3. 발송 구조 (서버 기준 + Expo Push)

```
pg_cron (1분) ──> reminders_cron_tick() ──(pg_net)──> reminders-dispatch
                     └ 할 일 없으면 호출 안 함
reminders-dispatch:
  1) reminders_claim_due(): 도래한 규칙을 임대(lease)로 가져옴 (두 실행이 같은 것을 못 가져감)
  2) 최신 상태 재확인 (완료/삭제/변경됐으면 건너뜀)
  3) 사용자의 알림 허용 기기마다 reminder_deliveries 행 생성 (중복 키: 기기·대상·시각)
  4) Expo Push 전송 → 접수(accepted) / 오류(error, 제한 재시도) / 응답 없음(uncertain, 재시도 안 함)
  5) reminders_mark_fired(): 다음 회차 계산 (그 사이 일정이 바뀌었으면 새 일정 유지)
  6) 15분 뒤 영수증 확인 → delivered(FCM/APNs 전달) / failed. DeviceNotRegistered면 기기 비활성화
```

- `accepted`/`delivered`는 "Expo·FCM이 받았다"는 뜻이지 **사용자가 봤다는 뜻이 아님**.
- 같은 회차를 서버 푸시와 기기 로컬 예약으로 이중 발송하지 않음 (로컬 예약 없음).
- 여러 기기: 알림 허용한 기기마다 한 번. 어느 기기에서든 완료하면 이후 발송 중단.
- 계정 전환: 설치 행이 새 계정으로 옮겨지고, 로그아웃 시 삭제 → 이전 계정 알림이 오지 않음.
- 잠금 화면 미리보기 끔 → 푸시에 제목·원문 없이 "리마인드가 있어요"만.

### 전달 한계 (보장하지 않는 것)
- 초 단위 정확성, 100% 전달, 오프라인 수신은 보장하지 않습니다. 통신·OS 절전(Doze)·알림 권한·FCM 상태에 따라 늦거나 빠질 수 있습니다.
- 알림시계 수준 권한이나 상시 백그라운드 서비스는 추가하지 않았습니다.

## 4. 배포 순서

1. **DB** (마이그레이션 3개: `20260929000001_reminders`, `…02_reminders_cron`, `…03_usage_source_reminder_briefing`)
   ```powershell
   npx supabase db push --project-ref wngsbfoiqdonjobbunyi
   ```
2. **스케줄러 비밀값** (Supabase SQL Editor, 한 번만. 값은 직접 생성 — 저장소에 넣지 않음)
   ```sql
   select vault.create_secret('https://wngsbfoiqdonjobbunyi.supabase.co/functions/v1/reminders-dispatch', 'reminders_dispatch_url');
   select vault.create_secret('<긴 임의 문자열>', 'reminders_cron_secret');
   ```
   ```powershell
   npx supabase secrets set REMINDERS_CRON_SECRET=<같은 문자열> --project-ref wngsbfoiqdonjobbunyi
   # 선택: Expo 푸시 보안(Enhanced security)을 켰다면
   npx supabase secrets set EXPO_ACCESS_TOKEN=<Expo access token> --project-ref wngsbfoiqdonjobbunyi
   ```
   `pg_cron`/`pg_net` 확장은 마이그레이션이 켭니다 (Dashboard → Database → Extensions에서 확인).
3. **서버 함수**
   ```powershell
   npx supabase functions deploy reminders-dispatch --no-verify-jwt --project-ref wngsbfoiqdonjobbunyi
   npx supabase functions deploy reminder-briefing --project-ref wngsbfoiqdonjobbunyi
   npx supabase functions deploy converse --project-ref wngsbfoiqdonjobbunyi
   npx supabase functions deploy process-session --project-ref wngsbfoiqdonjobbunyi
   ```
   `reminders-dispatch`는 크론이 JWT 없이 비밀 헤더로 부르므로 `--no-verify-jwt`로 배포하고, 함수 안에서 비밀값/사용자 JWT를 직접 검사합니다.
4. **Android 푸시 (FCM)**: Firebase 프로젝트에 Android 앱(`com.liflux.mindrecord`) 추가 → `google-services.json`을 저장소 루트에 저장(커밋하지 않음). FCM V1 서비스 계정 키를 EAS에 등록: `npx eas-cli credentials` → Android → Push Notifications (FCM V1). `app.config.js`가 파일이 있을 때만 연결합니다.
5. **iOS 푸시 (APNs)**: `npx eas-cli credentials` → iOS → Push Notifications 키 생성/등록 (기존 bundle id `com.liflux.mindrecord`).
6. **네이티브 재빌드** (새 모듈·권한·google-services 반영)
   ```powershell
   npx expo prebuild -p android
   cd android
   .\gradlew app:assembleRelease -x lint -x test -PreactNativeArchitectures=arm64-v8a
   ```

## 5. 검증

| 항목 | 방법 | 결과 |
| --- | --- | --- |
| 날짜·DST·월말·윤년·시간대 변경·상태 전이·중복·RLS·undo 복원 | `scripts/test-reminders-sql.sh` (로컬 Postgres 16, 모든 마이그레이션 적용 후) | 통과 |
| 서버 순수 로직 (푸시 문구·미리보기 끔·청크·영수증 분류·재시도·선행 마감·DST·브리핑 템플릿·테스트 알림 원인) | `node --test supabase/tests/reminders_pure.test.ts` | 37/37 통과 |
| 서버 함수 타입 검사 (14개 전부) | `npx -y deno@2 check supabase/functions/*/index.ts` | 통과 |
| 앱 타입 검사 / Android·Web 번들 | `npx tsc --noEmit`, `npx expo export` | 통과 (웹 번들에 알림 모듈 없음) |
| 실제 Expo 발송·OpenAI 대본·TTS | 운영 키 필요 | **미검증** |
| 실제 푸시 수신·알림 탭·종료 상태 진입·오디오 | 실기기 필요 | **미검증** |

실기기 시험 절차: 설정 → 리마인드 → 알림 켜기 → "테스트 알림 보내기" → 수신 확인 → 알림 탭 → 목록 이동. 내일 마감 Task를 만들고 기본 시각을 몇 분 뒤로 바꿔 실제 발송 확인 (운영 데이터 대신 테스트 계정 권장).

### "테스트 알림 보내기"가 안 될 때
테스트는 이 폰의 설치 id를 함께 보내고, 서버는 발송 후 약 6초 동안 영수증(FCM/APNs 응답)을 기다려 결과를 돌려줍니다. 화면 문구 아래 작은 글씨("Details:")가 원래 오류 코드입니다.

| 화면 안내 | 서버 `reason` / 영수증 | 원인 · 조치 |
| --- | --- | --- |
| "couldn't get a push address from Google … Firebase" | `no_token` | 빌드에 `google-services.json`이 없음 → 4번(FCM) 설정 후 **재빌드** |
| "The server doesn't have this phone's current push address" | `no_token` (이 폰은 토큰을 받음) | 서버 행이 예전 상태 — 재등록이 서버에 안 닿음 → 연결 확인 후 다시 시도 |
| "isn't registered for notifications yet" | `not_registered` | 앱이 이 계정으로 등록 못 함 (앱이 한 번 재등록·재시도한 뒤에도) → 연결 확인, 앱 재실행 |
| "Notifications are off for this phone" | `permission_off` | OS 알림 권한 꺼짐 → 화면의 켜기 버튼 / 시스템 설정 |
| "Google rejected this phone's push address" | `disabled` 또는 `DeviceNotRegistered` | 토큰 무효 → 앱 재실행(재등록), 계속되면 재설치. "…and updating it didn't work"면 재등록 실패 → 연결 확인 |
| "the FCM key on Expo is missing or invalid" | 영수증 `InvalidCredentials` | FCM V1 서비스 계정 키가 없거나 무효(폐기됨, FCM 권한 없는 서비스 계정 등) → `npx eas-cli credentials` → Android → FCM V1 키 확인·재등록 (iOS는 APNs 키) |
| "google-services.json … doesn't match the FCM key" | 영수증 `MismatchSenderId` | `google-services.json`과 EAS의 FCM 키가 다른 Firebase 프로젝트 |
| "Sent — it should appear in a few seconds" | 영수증 `delivered` | FCM/APNs까지 전달됨. 안 보이면 앱 알림 설정·배터리 절약 확인 |
| "notification function isn't reachable" | HTTP 404 | `reminders-dispatch` 미배포 → 3번 |

테스트에서 받은 영수증은 크론의 영수증 확인과 같은 방식으로 기록되므로(`delivered`/`failed` + `receipt_checked_at`) 크론이 다시 처리하지 않습니다.

## 6. 보류한 확장 (후속)
- **자동 위치 감지**: 지금은 `context_tag`(home/office 등)로 저장하고 "집에 왔어/집에서 할 일" 요청이나 목록에서 보여줌. 지오펜싱을 붙일 때는 기기에서 장소 진입 이벤트 → `reminder_agenda(... ) where context_tag = ?` 조회 → 로컬 알림 또는 서버 호출로 확장.
- **외부 상태 감지** (이메일 답장, 캘린더): `purpose = 'waiting'` 항목을 연동 결과로 `acknowledge` 처리하는 지점. 지금은 사용자가 "답 받았어"라고 말해야 종료.
- **오프라인 보류 큐**: 완료·미루기는 온라인에서만 저장. 실패 시 성공한 척하지 않고 오류 표시.
- **주간 회고**: 기존 요약·검색 위에서 `task_completions`·`reminder_briefings`를 읽어 생성하는 방식으로 확장 가능.

## 7. 앱 이름 변경 영향 목록 (이번엔 바꾸지 않음)

새 이름이 정해지면 아래만 바꾸면 됩니다. **식별자는 바꾸지 않습니다.**

**표시 이름·문구 (바꿈)**
- `app.json` `name`, 권한 설명 문구(마이크·Face ID·알림), 스플래시/아이콘
- `src/content/legal.ts` `APP_NAME`, `docs/legal/*.html`, 로그인 워드마크(`app/login.tsx`), 온보딩(`app/onboarding.tsx`), 잠금 해제 문구(`src/components/LockScreen.tsx`), 마이크 권한 안내(`useCaptureSession`/`useConversationSession`/`useVoiceSearch`), 백그라운드 녹음 알림 문구(`src/lib/backgroundRecording.ts`)
- 웹 제목·문구(`app/_layout.tsx` 웹 title, `app/records/*`, `src/web/WebPage.tsx`)
- 서버 프롬프트의 앱 이름(`converse`, `search-ask`) — AI 이름(Lina 등, `profiles.ai_name`)과 분리 유지
- 리마인드 알림 채널 표시명·푸시 문구 (브랜드명을 넣지 않음)
- 스토어 문구, 공유 문구

**바꾸지 않음 (식별자)**
- Android `package` / iOS `bundleIdentifier` `com.liflux.mindrecord`, EAS `projectId`, Supabase project ref/URL·키, DB 테이블·버킷, 로컬 저장 키(`mindrecord.*`), FCM/APNs 자격 증명

**별도 검토 후에만 (호환성 영향)**
- URL scheme `mindrecord://` (Supabase Auth Redirect URL, Google Tasks 콜백 `google-tasks-callback`), Expo `slug`, 저장소 이름·도메인 — 바꾸면 신·구 콜백을 한동안 같이 등록하는 전환 계획 필요
- 표시 이름·권한 문구·알림 채널 이름은 **네이티브 재빌드**가 필요 (JS 업데이트만으로 안 바뀜)
