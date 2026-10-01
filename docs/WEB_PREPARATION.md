# JoaAssistant — 웹 확장 준비 (모바일 우선)

작성: 2026-09-26 · 기준 커밋 `1ba9b5e` 이후 작업

**개발 방향**
- 모바일을 먼저 개발하고, 웹은 같은 계정·같은 백엔드로 확장할 수 있는 구조만 지금 준비한다.
- 웹 전체 기능은 모바일 핵심 기능이 안정된 베타 단계 이후에 개발한다.

**이번 범위:** 웹 빌드 → 로그인 → 기존 기록 목록 → 기록 상세(읽기 전용) → 로그아웃까지 실제로 동작하는 최소 경로.

---

## 1. 지금 웹에서 되는 것

| 흐름 | 상태 |
| --- | --- |
| 웹 production 빌드 (`npx expo export --platform web`) | 성공 |
| 이메일/비밀번호 로그인 | 구현·브라우저 검증 (가짜 백엔드) |
| Google 로그인 (Supabase OAuth, PKCE) | 구현·브라우저 검증 (가짜 백엔드). **실제 Google·Supabase 설정 필요** (§4) |
| Apple 로그인 | 웹에서는 **제공하지 않음** (버튼 숨김). Apple로만 가입한 계정은 웹에 들어올 수 없음 |
| 기록 목록 `/records` | 최신순, 20개씩 "Load more", 새로고침, 빈 상태, 오류/재시도 |
| 기록 상세 `/records/<id>` | 제목·날짜·모드·처리 상태·요약·아웃라인·인용·전사. 새로고침·URL 직접 접근 가능 |
| 로그아웃 / 계정 전환 | 세션 삭제 후 로그인 화면으로 이동. 이전 사용자의 화면이 남지 않음 |
| 모바일 전용 화면 URL (`/talk`, `/settings/ai`, `/summary`, `/topic` 등) | 웹에서는 열리지 않고 로그인 또는 `/records`로 이동. 마이크 권한도 요청하지 않음 |

**웹은 읽기 전용이다.**
- 수정·삭제·Google Tasks 전송·녹음·AI 재처리를 부르는 코드 경로가 웹 화면에 없다.
- 기록을 열어 볼 때는 `sessions` 테이블 select만 한다.
- AI 함수(`functions/v1/*`) 호출, 사용량 차감, 원본 오디오 다운로드는 일어나지 않는다. 브라우저 검증에서 요청 목록으로 확인했다.

## 2. 구조: 무엇을 공유하고 무엇을 나눴나

**그대로 공유하는 것**
- Supabase 프로젝트, 사용자 ID, 테이블, RLS
- Edge Function과 서비스 함수, 타입
- 테마와 공용 UI 컴포넌트

**웹 전용 테이블, 복제 데이터, 별도 프로젝트는 없다.**

플랫폼별로 나눈 부분은 Metro가 자동으로 고르는 `.web.ts` 파일로 처리했다. 모바일 파일은 수정하지 않았다.

| 파일 | 모바일(iOS/Android) | 웹 |
| --- | --- | --- |
| `src/lib/secureStorage.ts` / `.web.ts` | SecureStore(Keychain/Keystore) 세션 저장, 기존 그대로 | 브라우저 `localStorage` (supabase-js 웹 기본값과 같은 방식) |
| `src/services/socialAuth.ts` / `.web.ts` | 네이티브 Google 로그인·Sign in with Apple (코드는 `auth.ts`에서 그대로 이동) | Supabase OAuth 리디렉션(Google). Apple은 미제공 |
| `src/lib/biometricLock.ts` / `.web.ts` | 기존 생체잠금 | 항상 "지원 안 함·꺼짐". 웹이 잠금 화면에 갇히지 않고, 폰의 잠금 설정은 건드리지 않음 |

플랫폼별로 한 번만 분기하는 곳은 아래와 같다.
- **`app/_layout.tsx`:** 웹에서는 `WebRootNavigator`가 동작한다.
  - 로그아웃 상태에서는 로그인 화면만, 로그인 상태에서는 `/records`만 열린다.
  - 모바일 전용 화면은 모두 `Stack.Protected guard={false}` 그룹에 등록해 URL로도 열리지 않게 했다.
  - 모바일에서는 반대로 `records/*`가 같은 방식으로 막혀 있다.
  - **새 화면(route)을 추가하면 웹에서 열어도 되는 화면인지 판단해서 이 목록에 반영해야 한다.**
- **`app/login.tsx`:** 웹에서 Apple 버튼을 숨기고, 로그인·이메일 화면 폭을 480px로 제한했다(`src/web/webColumn.ts`, 모바일에서는 undefined).
- **`src/lib/supabase.ts`:** 웹에서만 `flowType: 'pkce'`를 쓴다. 모바일은 기존 기본값(implicit) 그대로다.
  - `detectSessionInUrl`은 모든 플랫폼에서 계속 `false`다.
  - 리디렉션 코드·토큰은 `AuthProvider`의 `processAuthDeepLink` 한 곳에서만 처리한다. 모바일은 딥링크에서, 웹은 `/auth/callback` 페이지 URL에서 읽는다.
  - 같은 URL은 한 번만 처리하고, 처리 뒤에는 주소창에서 코드·토큰을 지운다.
  - 웹에서는 Alert가 동작하지 않으므로 오류를 `/auth/callback` 화면에 보여 준다.

"버튼을 숨기거나 `Platform.OS`로 분기하면 네이티브 모듈이 웹 번들에서 빠진다"고 가정하지 않았다. 실제 번들로 확인한 결과는 다음과 같다.
- **웹 번들:** 네이티브 Google SDK 호출(`hasPlayServices`)과 생체잠금 저장 키가 없다.
- **Android 번들:** 둘 다 들어 있다.

새로 추가한 웹 전용 코드:
- `app/records/index.tsx`, `app/records/[id].tsx`
- `src/web/WebPage.tsx`: 최대 너비 760px의 페이지 틀과 로그아웃
- `src/web/recordFormat.ts`
- `src/services/sessions.ts`의 `listSessionItemsPage`: 목록 전용 가벼운 조회
  - 전사·아웃라인을 빼고 `id, title, summary, mode, started_at, processing_status`만 가져온다.
  - 정렬·커서는 기존 `listSessionsPage`와 같은 `(started_at, id)` 방식이다.
  - 기존 함수와 반환 타입은 바꾸지 않았다.

## 3. 실행 방법

```bash
npm install
npx expo start --web                              # 개발 서버 (기본 http://localhost:8081)
npx expo export --platform web --output-dir dist  # production 빌드 → dist/
```

- `app.json`의 `web.output`이 `"single"`(SPA)이다. 그래서 호스팅할 때는 **모든 경로를 `/index.html`로 되돌리는 rewrite**가 필요하다. 그래야 `/records/<id>`를 직접 열거나 새로고침해도 동작한다.
- 환경변수는 모바일과 같다: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  - `EXPO_PUBLIC_GOOGLE_*`는 모바일 네이티브 로그인용이고, 웹 코드는 읽지 않는다.
  - 웹 번들에는 서비스 역할 키나 AI 비밀 키를 절대 넣지 않는다. 지금도 publishable key만 쓴다.

## 4. 코드 밖에서 필요한 설정 (값은 문서에 적지 않음)

**웹 Google 로그인**
1. **Google Cloud Console → Credentials:** 모바일이 쓰는 "Web application" 유형 OAuth 클라이언트(`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`와 같은 것)를 연다.
   - **Authorized redirect URIs**에 `https://<project-ref>.supabase.co/auth/v1/callback`을 추가한다.
2. **Supabase Dashboard → Authentication → Providers → Google:** Enabled 상태에서 위 클라이언트의 **Client ID와 Client Secret**을 입력한다.
   - 모바일 `signInWithIdToken`은 Client ID만 있어도 되지만, 웹 리디렉션 방식은 Secret이 필요하다.
3. **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**에 추가한다.
   - 개발: `http://localhost:8081/auth/callback`
   - 웹 배포 도메인: `https://<웹 도메인>/auth/callback`
   - 모바일용 `joaassistant://auth/callback`도 그대로 둔다.

**계정 동작**
- 같은 Google 계정이면 모바일(네이티브)과 웹(OAuth)이 같은 Supabase 사용자로 로그인된다. Supabase가 Google의 사용자 식별자로 연결하며, 이메일이 같다는 이유로 계정을 합치는 코드는 없다.
- 이메일/비밀번호 계정은 웹에서도 그대로 로그인된다.
- **Google이나 Apple로만 가입한 계정은 웹 이메일 로그인에 비밀번호가 없다.** Google 계정은 위 설정을 마치면 웹 Google로 들어올 수 있다. Apple 전용 계정은 웹 Apple 로그인(Services ID, 도메인 검증)을 만들기 전까지 웹에 접근할 수 없다.

## 5. 검증 결과 (2026-09-26)

**브라우저 검증:** Chromium 141.0.7390.37(headless, Linux), production web export(SPA 방식 로컬 서버)로 **33개 항목 모두 통과**.
- 이 작업 환경은 네트워크 정책 때문에 `*.supabase.co`에 접속할 수 없다. 그래서 브라우저 안에서 Supabase HTTP API(auth·PostgREST)를 가짜로 응답했다.
- 가짜 API도 RLS처럼 토큰 주인의 행만 돌려준다.
- **실제 계정과 실제 데이터로 한 확인이 아니다.**

확인한 항목:
- **로그인:**
  - 로그아웃 상태에서 상세 URL로 들어가면 로그인 화면이 나온다.
  - 웹에는 Apple 버튼이 없다.
  - 틀린 비밀번호로는 로그인되지 않는다.
- **목록:**
  - 로그인하면 목록으로 가고 20개가 보인다. 처리 중인 기록은 상태가 표시된다.
  - 목록 조회에 전사가 포함되지 않는다.
  - Load more를 누르면 25개가 되고 버튼이 사라진다.
- **상세:**
  - 요약·아웃라인·인용·전사가 보인다.
  - 새로고침해도 세션과 기록이 유지된다.
  - 다른 사용자의 기록 ID, 잘못된 ID로 들어가면 "없음" 안내가 나온다.
- **오류 복구:** 목록 조회가 실패하면 오류와 재시도 버튼이 나오고, 재시도하면 복구된다.
- **모바일 전용 화면 차단:** `/talk`, `/settings/ai`, `/summary`, `/topic`, `/(tabs)/tasks`, `/account`는 `/records`로 이동하고, 마이크 요청(getUserMedia)은 0회다.
- **로그아웃과 계정 전환:**
  - 로그아웃하면 `localStorage`의 세션이 지워진다. 그 뒤 기록 URL로 들어가면 로그인 화면이 나오고, 기록 요청은 0회다.
  - 다른 계정으로 로그인하면 그 계정의 기록만 보인다.
- **Google 로그인 흐름:**
  - authorize를 거쳐 `/auth/callback?code=`으로 돌아온다.
  - PKCE 코드를 verifier와 함께 교환하고 `/records`에 도착한다. 이때 주소창에서 코드가 지워진다.
- **요청과 오류 검사:**
  - 전 과정에서 auth와 `sessions` 읽기 외의 요청(AI 함수, Storage, DB 쓰기)은 0회다.
  - 처리되지 않은 오류는 0회다.
- **키보드:** Tab으로 기록 카드 링크로 이동하고 Enter로 상세가 열린다.

**모바일 회귀 확인**
- `npx tsc --noEmit` 통과
- `npx expo export --platform android` 성공
- 옮긴 네이티브 로그인 코드가 원본과 동일함을 비교해 확인
- **아직 실제 기기에서 확인하지 않음:** 로그인 유지, 녹음·대화·저장.

**아직 확인하지 않은 것**
- 실제 Supabase 프로젝트로 하는 로그인과, 모바일에서 저장한 실제 기록이 웹에 보이는지 (§4 설정 후 확인)
- Safari·Firefox·모바일 브라우저
- 실제 호스팅 환경의 rewrite 설정

## 6. 후속 웹 개발 메모 (이번에는 구현하지 않음)

### 웹 음성

- **녹음 형식:** 녹음은 HTTPS와 마이크 권한이 필요하다. 브라우저마다 MediaRecorder가 내는 형식이 다르다(Chrome·Edge는 `audio/webm;codecs=opus`, Safari는 `audio/mp4`).
  - 서버 `converse`가 지금 구분하는 형식은 m4a와 wav뿐이다(`audioFormatOf`, `supabase/functions/converse/index.ts`).
  - webm/mp4를 받으려면 파일명·확장자를 판단하는 부분을 넓혀야 한다. Whisper는 webm/mp4를 받는다.
  - 업로드 경로(`src/services/recordings.ts`, `conversation.ts`)도 파일 URI 전제를 Blob 전제로 바꿔야 한다.
- **모바일 전제로 짠 부분:**
  - 녹음 크기 확인(`localRecordingSize`)과 TTS 응답 재생이 앱 캐시 파일을 전제로 한다(`useConversationSession`, `useVoiceSearch`). 웹에서는 Blob URL이나 `<audio>`로 재생해야 한다.
  - 발언 종료 감지는 녹음기의 미터링(dB) 값으로 판정한다(`useConversationSession`). 웹에서 이 값이 나오지 않으면 WebAudio `AnalyserNode`로 레벨을 구해 같은 판정에 넣어야 한다. (PCM 기반 감지기 `src/lib/voiceActivity.ts`는 도로에서 더 나빠 삭제했다. 필요하면 git 기록에 있다.)
  - 브라우저 자동재생 정책 때문에, 음성 응답은 사용자가 한 번 조작(제스처)한 뒤에만 재생된다.
- **지연:** 같은 서버 파이프라인(Whisper → GPT → TTS)을 쓰므로 웹이라고 응답 지연이 줄지는 않는다. 지연 측정 구간(`perfLog`)은 모바일과 비교할 수 있게 유지한다.
- **연속 녹음:** 탭 종료, 브라우저 정지, 화면 잠금, 절전 상태에서는 모바일 같은 연속 녹음을 보장하지 않는다. 장시간 녹음과 오프라인 복구는 별도로 설계해야 한다.

### 계정·편집·사용량·배포

- **여러 기기 수정 충돌:** 수정을 웹에 열 때 필요하다. 지금은 마지막으로 저장한 쪽이 이긴다.
- **사용량 한도:** `supabase/functions/_shared/usage.ts`는 **사용량을 기록만 하고 한도를 강제하지 않는다.**
  - 계정 단위 한도, 여러 탭·기기의 동시 AI 요청, 중복 차감 방지가 필요하다.
  - 웹 음성·AI를 공개하기 전에 서버 쪽에 공통으로 정해야 한다. `converse`에는 턴 ID로 하는 중복 방지가 이미 있다.
- **하위 호환:** 모바일 구버전이 계속 쓰일 수 있으므로 서버·API 변경은 하위 호환을 유지한다(예: `converse`는 m4a와 wav를 모두 받는다).
- **배포:** 웹은 별도 배포 산출물(`dist/`)이고 백엔드와 환경변수는 모바일과 공유한다. 공개하기 전에 필요한 것:
  - 도메인, Supabase Redirect URL, Google OAuth 설정
  - 호스팅 rewrite
  - 서드파티 스크립트 금지 정책 (웹 세션이 `localStorage`에 있으므로)
- **웹 생체인증·패스키:** 미구현이다.

### 다음 단계

모바일 안정화 → 웹 기록 관리 확장(편집·Topics·Tasks) → 웹 음성 베타 → 다중 브라우저 안정화.
