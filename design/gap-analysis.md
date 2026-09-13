# Mind Record 구현 갭 분석 (Gap Analysis)

> 대상: `/home/claude/repo` — Expo + TypeScript + Expo Router 앱
> 기준 문서: `design/product-plan.md` (§1–§50), `design/project/Mindecho.dc.html` (prototype 1a + 미사용 variation 1b–1n), `design/chats/chat1.md`
> 검증 범위: 계획서에서 추출한 요구사항 520건을 `app/`·`src/`·`package.json`·`app.json` 코드와 1:1 대조
> 앱은 감사 시점 이후 `Mindecho` → `Mind Record`로 이름이 바뀌었습니다. 아래 본문의 코드/파일 인용은 리네임 이전 상태 기준이지만, 구조적 내용은 그대로 유효합니다.

---

## 1. 한 줄 요약

이 저장소에 들어 있는 것은 계획서가 묘사한 AI 시스템이 아니라 **그 시스템의 완성도 높고 디자인에 충실한 UI 껍데기(UI shell)** 이며, 마이크·STT·LLM·저장소가 단 한 줄도 없기 때문에 MVP(§44) 15개 항목 중 실제로 기능하는 것은 **0개**입니다.

---

## 2. 큰 그림 — 무엇이 만들어졌고, 무엇이 만들어지지 않았는가

### 실제로 만들어진 것

화면 14개(`app/login.tsx`, `app/talk.tsx`, `app/summary.tsx`, `app/driving.tsx` + `app/(tabs)/` 10개)가 전부 존재하고, 네비게이션이 실제로 동작하며, 디자인 프로토타입 1a(`design/project/Mindecho.dc.html:37-320`)를 거의 픽셀 단위로 충실히 옮겼습니다. 타이포그래피·색·컴포넌트 시스템(`src/theme.ts`, `src/components/ui.tsx`)도 일관됩니다. **디자인 핸드오프 결과물로서는 훌륭합니다.**

### 그 뒤에 아무것도 없다는 사실

| 확인 항목 | 결과 |
|---|---|
| 오디오/STT/LLM 의존성 (`package.json:5-25`) | 19개 런타임 의존성 전부 Expo/RN/폰트/SVG. `expo-av`, `expo-audio`, `expo-speech`, LLM SDK **전무** |
| 네트워크 호출 (`grep fetch(\|axios\|XMLHttpRequest` over `app/ src/`) | **0건** |
| 권한 선언 (`app.json`) | `plugins`는 `expo-router`, `expo-splash-screen` 뿐. 마이크·알림·캘린더·생체인증 **선언 없음** |
| 영속화 (`AsyncStorage`/`sqlite`/`SecureStore`/`file-system`) | **0건**. `src/store.tsx:5-6` 주석이 직접 인정: "there is no persistence or backend behind it yet" |
| 레코드 id (`grep '\bid\b\s*:' src/ app/`) | **0건** — 앱 안의 어떤 레코드도 주소를 가지지 않음 |
| `Date` 객체 (`grep 'new Date\|Date\.'`) | **0건** — 앱에 "오늘"이라는 개념 자체가 없음 |
| 파생 계산값 | 단 2개 — `openTaskCount`(`src/store.tsx:145`), `inboxCount`(`src/store.tsx:148`). 나머지 모든 숫자는 문자열 리터럴 |

Talk 화면의 "transcript"는 `app/talk.tsx:13-29`의 고정 한국어 3줄이며, `src/store.tsx:127`의 `lines = Math.min(3, Math.floor(seconds / 3))`가 1초짜리 `setInterval`(`src/store.tsx:83-88`)에 맞춰 3초·6초·9초에 한 줄씩 드러낼 뿐입니다. 9초 이후에는 10분을 말해도 아무 일도 일어나지 않습니다.

### 앱 전체에서 "진짜로 동작하는" 상호작용 목록 (이것이 전부입니다)

| 동작 | 위치 |
|---|---|
| Task 체크박스 토글 + `N open` 카운트 갱신 | `app/(tabs)/tasks.tsx:29-35` → `src/store.tsx:114-116`, `:145` |
| Inbox 항목 resolve (행 흐려짐 + kicker 갱신 + Home 배지 감소) | `app/(tabs)/inbox.tsx:34-44` → `src/store.tsx:118-120`, `:148` |
| Calendar 날짜 선택 + 점 개수/목록 갱신 | `app/(tabs)/calendar.tsx:58`, `:21`, `:50` |
| Capture/Conversation 모드 전환 (문구 1개와 카드 1개만 바뀜) | `app/talk.tsx:66-77` → `src/store.tsx:67` |
| Save only 토글 | `app/talk.tsx:78-89`, `app/driving.tsx:59-65` |
| "Keep separate"로 related 카드 숨기기 | `app/talk.tsx:142-147` |
| Account 토글 6개 (자기 자신 외에 아무도 읽지 않음) | `app/(tabs)/account.tsx:49-71` → `src/store.tsx:122-124` |

이 모든 상태는 React `useState`이며 **새로고침 시 전부 사라집니다.** `app/_layout.tsx:36`이 `initialRouteName="login"`이므로 매번 Login 화면부터 다시 시작합니다.

### 요구사항 520건 상태 집계

| 상태 | 의미 | 건수 | 비율 |
|---|---|---:|---:|
| `ui-real` | UI가 있고 로컬 상호작용도 실제로 동작 | 26 | 5% |
| `ui-mock` | UI는 있으나 내용이 하드코딩이고 동작이 연출 | 206 | 40% |
| `ui-partial` | 계획의 일부만 화면에 있음 | 60 | 12% |
| `design-only` | 디자인 HTML(주로 미사용 variation)에만 존재 | 7 | 1% |
| `missing` | 화면·코드·데이터 모양 전부 없음 | 221 | 42% |
| **합계** | | **520** | |

심각도로는 **blocker 등급이 127건**입니다. 그리고 `ui-real` 26건 중 상당수는 "폴더를 고르게 하지 않는다"(§3), "버튼을 남발하지 않는다"(§47) 같은 **부정형 요구사항**이어서, 기록할 것이 아무것도 없기 때문에 자동으로 충족되는 항목입니다.

### 가장 중요한 한 가지

계획서의 구조적 핵심(§4 Entry, §5 Topic, §42 5계층 엔티티 체인)이 코드에 **전혀 존재하지 않습니다.** `src/data.ts`가 export하는 타입은 `Task`(:7-13), `InboxItem`(:46-54), `Conversation`(:82-90), `PrefRow`/`PrefGroup`(:163-167) 다섯 개뿐이고, 어느 것에도 id가 없으며, `Conversation.to`(:89)는 엔티티 참조가 있어야 할 자리에 `'/tasks' | '/topic' | ...` 라우트 문자열을 저장합니다. 이것이 클릭 가능한 프로토타입의 데이터 모양이지, 제품의 데이터 모양이 아닙니다. **앞으로의 모든 작업은 이 지점에서 막힙니다.**

---

## 3. MVP (§44) 15개 항목 체크리스트

**이 문서에서 가장 중요한 표입니다.**

| # | MVP 항목 | 상태 | 실제 상황과 갭 |
|---|---|---|---|
| 1 | AI Voice Conversation | `ui-mock` **blocker** | AI 발화는 `app/talk.tsx:52-56`의 3분기 삼항연산자(고정 문자열 3개). `saveOnly`/`mode`에만 반응하고 사용자가 말한 내용과 무관. 마이크·모델 호출 없음 |
| 2 | Speech-to-Text | `ui-mock` **blocker** | STT 라이브러리 0개, 마이크 권한 0개. transcript는 `app/talk.tsx:13-29`의 고정 3줄을 타이머로 노출 (`src/store.tsx:127`). 3줄 이후 영원히 증가하지 않음 |
| 3 | Raw Conversation 저장 | `missing` **blocker** | 저장 자체가 없음. `src/store.tsx:23-62`에 transcript/conversation 필드 없음, 영속화 의존성 0개. 세션 종료는 `router.replace('/summary')`만 수행 (`app/talk.tsx:47-50`) |
| 4 | AI 자동 요약 | `ui-mock` **blocker** | `app/summary.tsx:11-28` 고정 const. 헤드라인 `'2 ideas, 2 tasks, 1 needs review.'`(:37)은 그 아래 렌더되는 내용(1 Idea + 2 Tasks)과 **자기 모순** — 계산이 아니라 리터럴이라는 증거 |
| 5 | Thought / Idea / Task 자동 분리 | `ui-mock` **blocker** | 분류 라벨이 문장과 같은 객체 리터럴에 함께 적혀 있음 (`app/talk.tsx:16,21,26`). 타입 enum도 분류기도 없음 |
| 6 | Topic 자동 분류 | `ui-mock` **blocker** | topic은 `Task.topic`(`src/data.ts:10`), `InboxItem.topic`(:48)의 표시용 `string`. `Topic` 타입 자체가 없고 §13의 "한 기록에 여러 Topic"은 구조적으로 표현 불가 |
| 7 | Topic 생성/수정 | `missing` **major** | 생성·이름변경·병합·삭제 어포던스가 앱 전체에 0개. `TOPICS`는 `app/(tabs)/memory.tsx:9-14`의 화면 로컬 const에 setter 없음. 앱의 유일한 TextInput은 검색창(`app/(tabs)/search.tsx:62`) |
| 8 | Task 추출 | `ui-mock` **blocker** | Task는 `src/data.ts:15-44`의 4개 고정 배열. `src/store.tsx:73`의 `tasksDone`이 `tasks.map(() => false)`로 길이가 고정됨. 'Create task' 버튼 2개 중 `app/summary.tsx:64`는 **onPress 자체가 없고**, `app/(tabs)/inbox.tsx:36`은 버튼 캡션 문자열만 저장 |
| 9 | Due Date 인식 | `ui-mock` **major** | `due`는 `'Due tomorrow'`, `'This week'`, `'No date'` 표시 문자열(`src/data.ts:18,25,32,39`). 앱 전체에 `Date` 객체 0개. 긴급 색상은 날짜가 아니라 배열 인덱스 기준 (`app/(tabs)/tasks.tsx:49`, `i === 0 && !done`) |
| 10 | Natural Language Search | `ui-mock` **blocker** | `query` state(`app/(tabs)/search.tsx:20`)를 읽는 코드가 자기 `value`(:64) 외에 없음. submit 핸들러 없음. 질문(:36)·답변(:41-43)·출처 3개(:11-15) 전부 고정. 인덱스도, 검색 대상 코퍼스도 없음 |
| 11 | Topic별 Memory | `ui-mock` **blocker** | Topic 화면은 **JoaSuite 하나로 하드코딩** (`app/(tabs)/topic.tsx:70`). Memory의 4개 셀이 전부 파라미터 없이 같은 라우트로 이동(`app/(tabs)/memory.tsx:34`) → Faith·Family를 눌러도 JoaSuite가 나옴 |
| 12 | Daily Summary | `ui-mock` **major** | `app/(tabs)/journal.tsx`는 `'September 11, 2026'`(:40)에 고정. 요일 라벨 `'Thursday'`(:39)는 **틀림**(2026-09-11은 금요일). 날짜 파라미터 없음 → 다른 날의 journal이 존재할 수 없음 |
| 13 | Original Conversation 연결 | `ui-mock` **blocker** | Source/원본 어포던스 7곳 중 6곳이 핸들러 없는 `<Text>` (`app/summary.tsx:70`, `app/(tabs)/topic.tsx:25,33`, `app/(tabs)/thread.tsx:47`, `app/(tabs)/journal.tsx:75`, `app/(tabs)/tasks.tsx:58`). 동작하는 1곳(`app/talk.tsx:128-134`)도 고정 `/thread`로 이동. **원본 대화를 보여주는 화면 자체가 없음** |
| 14 | AI Inbox | `ui-partial` **major** | 앱에서 가장 진짜에 가까운 화면. resolve는 실제 state를 쓰고 Home 배지까지 갱신됨. 그러나 (a) 캡처에서 항목이 유입되지 않고 (b) 선택 결과가 버튼 캡션 문자열로 저장되며 (c) `app/(tabs)/inbox.tsx:52-54`의 "Your choices here train future classification"은 **사실이 아님** |
| 15 | Capture / Conversation Mode | `ui-mock` **major** | 세그먼트 전환은 진짜(`src/store.tsx:67`). 그러나 두 모드가 바꾸는 것은 AI 문구 1개와 related 카드 노출 여부뿐이고, 캡처·저장·요약 결과는 완전히 동일. Driving 화면은 `mode`를 아예 읽지 않음(`app/driving.tsx:15`) |

**요약: MVP 15개 중 blocker 9건, major 6건. 실제 구현 0건.**

---

## 4. 화면은 있지만 속이 빈 것 (다 된 것처럼 보이는 것들)

### Talk — `app/talk.tsx`
- transcript 3줄, 타입/토픽 태그, AI 응답, related 카드가 **모두 같은 파일의 리터럴**. 세션마다 바이트 단위로 동일 (§1, §7 Layer 1-2, §9, §11)
- "Link them"(`:137-141`)은 `related='linked'`만 써서 **자기 버튼 라벨을 'Linked ✓'로 바꾸는 것이 유일한 효과**. `startSession()`(`src/store.tsx:95`)이 다음 세션에 초기화 (§27, §42)
- `End` 버튼(`:168-173`)이 `stopRecording()`을 호출하지 않아 화면을 떠나도 **타이머가 계속 돎**
- Save only가 `startSession`에서 초기화되지 않아 **한 번 켜면 이후 모든 세션에 새어 들어감** (`src/store.tsx:90-96`)

### Driving — `app/driving.tsx`
- 큰 마이크(220px)·큰 버튼·최소 UI는 §10을 실제로 잘 지킴 (`ui-real`)
- 그러나 **transcript도 AI 블록도 없어서** 운전자는 무엇이 "저장"됐는지 끝까지 알 수 없음. §10의 전제(눈을 안 보고도 안심)가 검증 불가
- TTS 없음 → §10의 "사업 아이디어로 저장했습니다" 음성 응답은 앱 어디에도 없음
- 'Auto driving mode · 차량 Bluetooth 연결 시 자동 전환'(`src/data.ts:176-182`)은 아무도 읽지 않는 boolean. 진입 경로는 Home의 작은 ghost 버튼 하나뿐(`app/(tabs)/index.tsx:30-36`)

### Summary — `app/summary.tsx`
- **화면의 두 주요 CTA가 완전히 무동작**: `'Create task'`(:64), `'Keep as idea'`(:65) 모두 `onPress` prop 자체가 없음. `src/components/ui.tsx:132-142`가 여전히 `accessibilityRole="button"`과 눌림 효과를 주기 때문에 **동작하는 것처럼 보이면서 탭을 삼킴** (§18, §33)
- 3초를 말했든 10분을 말했든, Capture든 Conversation이든, Save only든 아니든 **완전히 같은 화면** (`:32`는 `startSession`만 destructure)
- `'Original transcript kept unchanged · Source →'`(:69-71) — 보관되는 transcript도 없고 링크도 죽어 있음

### Home — `app/(tabs)/index.tsx`
- 날짜 `'Sat, Sep 12'`(:29)는 리터럴. `'Today'` 타일(:81-87)은 **Sep 11 journal로 이동** — 오늘 화면이 어제를 가리킴
- `Tasks` 값 `"4"`(:59)는 리터럴이라 **태스크를 전부 체크해도 4로 남음** (Tasks 화면은 `openTaskCount`로 0을 표시 → 두 화면이 눈에 보이게 모순)
- `Open loops` `"3"`(:74-80) → `/memory`로 이동하는데 **그 화면에 open loop 목록이 없음** (막다른 길)
- `Upcoming` 블록(:101-104)은 눌리지 않는 `View`. 같은 회의가 `app/(tabs)/tasks.tsx:78-79`, `src/data.ts:78`에 **서로 다른 문자열로 3벌 중복**
- §29가 요구한 `Recent Thoughts` 항목은 **없음**(자리에 Inbox가 들어가 있음)

### Inbox — `app/(tabs)/inbox.tsx`
- 앱에서 가장 진짜에 가까운 상호작용이지만, 6개 항목은 `src/data.ts:56-79` 고정 배열이라 **녹음을 하든 안 하든 앱을 켜자마자 이미 거기 있음**
- 선택 결과는 `Record<number, string>`에 **버튼 캡션**으로 저장 (`src/store.tsx:118-120`). 'Create task'를 눌러도 Task는 안 생기고, 'Both'를 눌러도 topic은 안 바뀜
- `review: false`인 4개 행은 **완전 비상호작용** — AI가 잘못 분류해도 고칠 방법이 없음 (§33)

### Tasks — `app/(tabs)/tasks.tsx`
- 체크박스는 진짜. 그 외 전부 정적: 생성·수정·삭제·재정렬 경로 0개
- `'This week'` 헤딩(:21) 아래에 `'No date'` 태스크가 그대로 들어 있음 — 필터링 로직 없음
- 인용문 박스(`:56-60`)의 `"{task.quote}" {task.src} →`는 발화에서 추출된 것이 아니라 `src/data.ts:20-21`에 손으로 쓴 문자열이고, 화살표는 눌리지 않음

### Memory — `app/(tabs)/memory.tsx`
- §30이 정의한 Memory의 역할 "모든 생각/기억"에 해당하는 **전체 목록 화면이 없음**. Topics 4칸 + Idea threads 2행 + Journal 1행 + Rediscover 카드가 전부
- Topic 4개 셀이 전부 같은 `/topic`으로(:34), Thread 2행이 전부 같은 `/thread`로(:47) 이동 — **'Migration Wizard'를 누르면 Subscription Service Idea 쓰레드가 열림**
- Rediscover 카드의 `'Revisit'`(:67), `'Archive'`(:68) 모두 **onPress 없음** (§37)

### Topic Memory — `app/(tabs)/topic.tsx`
- §6이 요구한 7개 패널 중 실제 패널은 0개. 카운트 태그 4개(:81-84)와 날짜 혼합 타임라인 하나로 압축
- **카운트가 바로 아래 내용과 모순**: `'2 decisions'`인데 Decision 행은 1개, `'4 ideas'`인데 Idea 행은 2개
- 5개 행 중 3개(Sep 8 / Aug 22 / Jul 12)는 `entry.thread`가 없어 `onPress={undefined}`(:91) — **'Source →'가 붙어 있는 바로 그 두 행이 눌리지 않음**
- `'Continue this conversation'`(:103-111)은 `startSession()`을 호출 → **이어가기가 아니라 초기화**. §41이 요구한 것의 정반대

### Idea Thread — `app/(tabs)/thread.tsx`
- 5단계 타임라인은 `STEPS` const(:10-22). 날짜는 문자열이라 정렬·비교 불가
- `'Plan it'`(:53), `'Ask how it changed'`(:54) 모두 **onPress 없음** — §14의 두 핵심 액션이 무동작
- 5단계 중 1개만 source 문구가 있고 그마저 죽은 `<Text>`(:47)

### Daily Journal — `app/(tabs)/journal.tsx`
- store를 **import조차 하지 않음**(:1-8) → 캡처든 체크박스든 아무것도 여기 도달할 수 없음
- `'Auto-generated · Thursday'`(:39)는 틀린 요일, `'Built from 4 conversations'`(:74)는 `src/data.ts:123-148`의 실제 3건과 불일치, `'View originals →'`(:75)는 죽음
- §49가 요구한 5개 카운트 중 4개만 있고 `2 Faith Notes`는 누락 (프로토타입 1a `Mindecho.dc.html:199-204`에서 그대로 이어받은 누락)

### Calendar — `app/(tabs)/calendar.tsx`
- 날짜 선택·점 개수·목록 갱신은 **진짜** (`:58`, `:21`, `:50`) — 앱에서 몇 안 되는 실제 파생 로직
- 그러나 월이 하드코딩(`LEADING_BLANKS = 2`, `DAYS_IN_MONTH = 30`, 제목 `'September 2026'` :34)되어 **다른 달로 갈 방법이 없음**
- 데이터는 대화 로그이고 **event는 단 하나도 표시되지 않음** — Home과 Tasks가 광고하는 'Tue 2 PM' 회의가 캘린더에는 없음
- 미래 날짜 흐림 처리는 `n > 12` 리터럴 비교(:71)

### Ask My Memory — `app/(tabs)/search.tsx`
- TextInput은 있으나 `onSubmitEditing`도 submit 버튼도 없고, 옆의 버튼(:69-77)은 마이크로 `/talk`로 이동
- 필터 칩 4개(:27-32)는 `Tag` = **눌리지 않는 `View`** (`src/components/ui.tsx:73-90`). 'Business'가 선택된 것처럼 outline으로 칠해져 있으나 해제도 선택도 불가
- 출처 3행만 이동하지만 목적지는 const에 박힌 고정 라우트

### Account — `app/(tabs)/account.tsx`
- 토글 6개는 실제로 움직이지만 `prefs`를 읽는 곳은 **자기 자신(:50)뿐**이고 새로고침 시 초기화
- `kind: 'value'` 행 7개(Default mode, Response length, Language, Transcript retention, Private topics, Calendar, Car audio)는 **`onPress={() => undefined}`(:55)인데 chevron(:75)을 그림** — 존재하지 않는 상세 화면을 약속
- `'Delete all my data'`(:91-97)는 **onPress 없음**: 확인 다이얼로그도, 재인증도, 아무 동작도 없음
- 프로필 `'Won Lee · won@liflux.com · Pro plan'`(:31-32)과 사용량 `'312 Entries / 48 Days / 9 Topics'`(:12-16)은 누가 로그인해도 동일한 리터럴

### Login — `app/login.tsx`
- Apple / Google / Email 버튼 3개가 **전부 같은 `signIn = () => router.replace('/')`**(:20). 인증 상태가 앱 어디에도 없고, `(tabs)` 그룹을 지키는 가드도 없음
- 모든 콜드 스타트에서 반드시 거쳐야 하므로 §48 ①(Frictionless Capture)의 정면에 마찰을 하나 놓은 셈
- `Terms` / `Privacy`(:66-67)는 핸들러 없는 `<Text>`이고 해당 문서 라우트도 없음

### 화면을 가로지르는 문제 두 가지

**(A) 탭 가능해 보이지만 아무 동작 없는 요소가 최소 26곳** — `<Button>` 7개(onPress 자체 없음), Account `value` 행 7개, accent 색 `→` 링크 6곳, 검색 필터 칩 4개, 목록처럼 보이는 `View` 2곳. §47이 경고한 "버튼 남발"이 기능이 아니라 **죽은 장식** 형태로 나타났습니다.

**(B) 앱이 사용자에게 사실과 다르게 말하는 문구 6곳** — 출시 전 반드시 제거하거나 진실로 만들어야 합니다.

| 문구 | 위치 | 실제 |
|---|---|---|
| "음성과 기록은 기기에서 암호화되어 저장됩니다" | `app/login.tsx:65` | 저장 자체가 없음 (암호화 의존성 0개) |
| "Your choices here train future classification" | `app/(tabs)/inbox.tsx:52-54` | 학습 경로 없음. 선택은 배지 카운트만 줄임 |
| "Original transcript kept unchanged" | `app/summary.tsx:70` | 보관되는 transcript 없음 |
| "Transcript retention · 원본 대화 보관 기간 · 1 year" | `src/data.ts:195` | 보관 대상도 만료 로직도 없음 |
| Calendar · "Event를 자동 추가" · 값 `Google` | `src/data.ts:203` | 연동 코드·OAuth·권한 전부 없음 |
| "312 Entries · 48 Days · 9 Topics" | `app/(tabs)/account.tsx:12-16` | 세는 대상이 없음 (앱의 전체 데이터는 task 4 + inbox 6 + conversation 7) |

---

## 5. 계획에 있는데 화면조차 없는 것

### 화면 단위로 통째로 없는 것

| 항목 | 계획 | 상태 | 비고 |
|---|---|---|---|
| **Weekly Review** | §23:713-719 | `missing` | 라우트·컴포넌트·데이터·디자인 아트보드 전무. `Mindecho.dc.html:514`의 "Try next" 산문에만 언급 |
| **Monthly Review** | §23:721-727 | `missing` | 디자인 HTML에 단어조차 없음. `conversationsByDay`가 월/연도 없이 일(day) 정수로만 키잉되어 "한 달"을 주소로 지정할 수도 없음 |
| **Open Loops 화면** | §24:735-753 | `design-only` | 실제 목록('Pricing 결정 / Alarm license 조사 / Marketing agency 재검토')은 **미사용 variation 1d**(`Mindecho.dc.html:380-382`)에만 존재. 앱에는 Home 카운터 `"3"`만 있고 그 링크는 목록 없는 `/memory`로 감 |
| **원본 대화 뷰어** | §8:271, §44.13 | `missing` | 앱의 모든 'Source →'가 가리켜야 할 목적지. 라우트·동적 세그먼트(`[id].tsx`)·컴포넌트·아트보드 전부 없음 |
| **Entry 상세 화면** | §4, §13, §42 | `missing` | 계획의 중심 객체인 Entry를 **한 건 단위로 여는 화면이 없음**. Decision·Idea·Question은 하드코딩 목록의 한 줄로만 존재 |
| **Entity(People/Company/Project) 화면** | §28:818-839, §42 | `missing` | 타입·화면·상태 전무. 'David'는 `topic` 문자열 슬롯에 들어가 있어(`src/data.ts:58,78`) 'Business · Liflux'와 **같은 종류의 값**. "David에 대해 최근에 뭐라고 했지?"는 물어볼 표면조차 없음 |
| **온보딩 플로우** | `chat1.md:218,224` | `missing` | 초기 Topic 세트 선택 → 권한 → 첫 캡처. 디자인 대화의 마지막 미해결 항목이자, §44.7과 §5의 출발점 |

### 데이터 모델·타입이 없어서 표현 자체가 불가능한 것

- **§4 Entry 타입 10종 중**: `Thought`, `Question`, `Insight`, `Reference`는 **레코드가 단 한 건도 화면에 렌더되지 않음**(숫자 옆의 단어만 존재), `Goal`은 미사용 variation 1j(`Mindecho.dc.html:461`)에만 있는 `design-only`. 타입 discriminator(`EntryType` union) 자체가 없음
- **§26 Idea Status 7종 중**: `Considering`·`Paused`만 kicker 문자열 안에 섞여 있고(`app/(tabs)/topic.tsx:44,49`), `New`/`Researching`/`Planned`/`Implemented`/`Rejected`는 저장소 전체에 **0건**. status 필드가 없으므로 변경도 불가
- **§11 Brainstorm 모드**: 앱·디자인 HTML 양쪽에 0건. `CaptureMode` union이 `'capture' | 'conv'`(`src/store.tsx:20`)라 **세 번째 모드를 상태로 표현할 수 없음**
- **§11 Reflection 모드**: 진입 경로·상태·동작 없음. 존재하는 것은 Calendar 한 행의 표시용 라벨 하나뿐(`src/data.ts:142` → `app/(tabs)/calendar.tsx:99`) — 즉 "있는 것처럼 보이는 라벨"만 있고 모드는 없음
- **§17 Event/Schedule 타입**: `Task`와 구분되는 엔티티가 없음. event는 `InboxItem.type`의 접두사 문자열 `'Event · Tue 2 PM'`(`src/data.ts:78`)로만 존재
- **§16 Reminder 분기**: "10월쯤 다시 생각해보자" → Reminder. 타입·화면·스케줄러·알림 의존성 전부 없음
- **§42 Relationship 계층**: 모든 레코드에 id가 없으므로 **엣지를 만드는 것이 미구현이 아니라 불가능**. 현재 Task/Inbox는 배열 인덱스로 주소 지정(`src/store.tsx:114-120`)

### Topic Memory 7패널(§6:177-199)의 실제 상태

| 패널 | 상태 | 내용 |
|---|---|---|
| 1 Current Summary | `ui-mock` | JSX 안의 고정 문단 (`topic.tsx:73-78`) |
| 2 Important Decisions | `ui-partial` | 패널 없음. 태그 `'2 decisions'`와 타임라인 행 1개 |
| 3 Current Ideas | `ui-partial` | 패널 없음. 태그 `'4 ideas'`와 타임라인 행 2개 |
| 4 Open Questions | `missing` | **질문 내용이 0건**. `'1 question'` 숫자 태그만(`topic.tsx:83`). 실제 질문 텍스트는 미사용 variation 1i(`Mindecho.dc.html:447`)에만 존재 |
| 5 Goals | `design-only` | 미사용 variation 1j(`Mindecho.dc.html:461`)의 카운트 셀 하나 |
| 6 Tasks | `ui-partial` | `'1 task'` 태그만. `topic.tsx`는 `@/data`를 import조차 안 함 → 실제 JoaSuite task가 여기 나타나지 않음 |
| 7 Recent Conversations | `ui-mock` | 전용 섹션 없이 대화·아이디어·결정이 한 목록에 섞임 |

### §20 필터 9종

| 필터 | 상태 |
|---|---|
| Topic / Type / Date / Status | `ui-partial` — 칩은 있으나 `Tag`가 눌리지 않는 `View`, 값도 각 1개씩만 |
| **Person / Project / Source / Importance / AI Confidence** | `missing` — **칩 자체가 없음**. 디자인 1a와 1b–1n 어느 아트보드에도 없음. 근거 필드(person, project, source, importance, confidence)도 어떤 타입에도 없음 |
| 칩 선택/해제, 필터 조합 | `missing` — 선택 상태를 담을 store 필드도, 걸러낼 컬렉션도 없음 |

### 그 밖의 대규모 부재

- **§19 / §43 검색 실행 전체** — `.includes()` 수준의 매칭조차 없음. 인덱스·임베딩·쿼리·결과 리스트·빈 결과 상태 모두 0
- **§31 파이프라인 11단계 중** 오케스트레이션 자체, Stage 7(Entity Detection), Stage 10(Memory Update), Stage 11(Daily Summary Update)이 `missing`. 나머지 단계는 결과물만 리터럴로 그려져 있음
- **§34 Privacy** — 3단계 등급(Normal/Private/Highly Private), transcript 삭제, AI Memory 제외, Topic별 AI 학습 제외, "이건 기억하지 마" 음성 명령 전부 부재
- **§36 알림 전송** — 의존성·권한·스케줄러 0. 토글 3개만 존재
- **§38 패턴 감지** — 앱·디자인·대화 로그 어디에도 'pattern' 단어 0건
- **§39 음성 명령 12개 전부** — 음성 입력 경로가 없으므로 전부 `missing`
- **앱 셸 공통**: 빈 상태(유일한 예외 `calendar.tsx:107-109`), 에러/재시도 상태(`try/catch` 0건), 처리 중 상태(`ActivityIndicator` 0개), 오프라인 큐, 백그라운드 녹음, OS 권한, 데이터 내보내기, 계정 삭제, 다국어 레이어, **현재 날짜 개념**

---

## 6. 의도적으로 바꾼 것 — 이것들은 갭이 아닙니다

아래 4건은 디자인 대화에서 사용자가 명시적으로 요청해 계획서와 달라진 부분입니다. **감점 대상이 아니며, 계획서 §30을 이 결정에 맞게 갱신하는 것을 권장합니다.**

| 변경 | 근거 | 계획서와의 차이 |
|---|---|---|
| **Bottom nav에서 Talk 탭 제거, Calendar 탭 추가** | `chat1.md:228`("calendar를 아래 네비게이션 메뉴에 추가. talk는 삭제해라. home 으로 가서 녹음시작한다고 생각하면 된다"), `chat1.md:236`에서 확정. 코드 주석에도 기록(`src/components/BottomNav.tsx:2-4`) | §30:899는 Home/Talk/Tasks/Memory/Search 5개를 권고. 현재는 Home/Calendar/Tasks/Memory/Search/Account 6개 |
| **Account 탭 추가 (최우측)** | `chat1.md:182`("아래 네비게이션 메뉴에 account가 추가되야 한다. 제일 우측에"), `chat1.md:208`에서 반영 | §30 표에 없는 항목. 설정 화면이므로 콘텐츠 역할이 아님 |
| **Calendar 화면 신설** | `chat1.md:157` — 날짜를 누르면 그날의 대화 목록. 구현된 디자인 variation 1l(`Mindecho.dc.html:485-494`, "used in 1a")과 일치 | §35의 외부 캘린더 연동과는 **다른 기능**입니다. 이 화면은 §35를 대신하지 않습니다 |
| **Login 화면 신설** | `chat1.md:181`, `chat1.md:207-209`(Account의 Sign out과 연결) | 계획서에 없던 화면. 다만 인증이 전혀 구현되지 않은 상태(§ 4장 Login 항목 참조)이므로 **"추가된 화면"은 의도된 변경이고, "인증이 없다"는 것은 갭**입니다 |

참고로 §49가 요구한 "2 Faith Notes" 누락과 journal의 잘못된 요일은 **구현자의 실수가 아니라 프로토타입 1a에서 그대로 이어받은 결함**입니다(`Mindecho.dc.html:197-204`). 고쳐야 하지만, 책임 소재는 디자인 쪽입니다.

---

## 7. Phase 2 (§45) / Phase 3 (§46) 현황

### Phase 2 — §45 12개 항목

| 항목 | 상태 | 현재 존재하는 것 |
|---|---|---|
| Calendar Integration | `ui-mock` | Account의 죽은 설정 행 1개(`src/data.ts:203`). 앱 내 Calendar 화면은 대화 로그이지 §35의 연동이 아님 |
| Recurring Tasks | `missing` | 전무. `Task`에 반복 필드 없음 |
| Weekly Review | `missing` | 화면·데이터·디자인 전무 |
| Monthly Review | `missing` | 화면·데이터·디자인 전무 |
| Open Loops | `ui-mock` | Home 카운터 `"3"`만. 목록은 미사용 variation 1d에만 |
| Decision Tracking | `ui-mock` | 하드코딩된 Decision 행 1개 + 서로 안 맞는 카운트 3개 |
| Idea Threads | `ui-mock` | 하드코딩 5단계 화면 1개가 모든 쓰레드를 대신함 |
| People / Company / Project Entity | `missing` | 타입·화면 전무 |
| Related Memory Recommendation | `ui-mock` | 고정 카드 1개, 3초 타이머로 등장, 연결은 기록되지 않음 |
| Forgotten Ideas / Rediscover | `ui-mock` | 카드 1개(고정), 버튼 2개 모두 onPress 없음, 'Convert to Task'는 아예 없음 |
| Advanced Search Filters | `ui-mock` | 눌리지 않는 칩 4개(9종 중), 5종은 칩조차 없음 |
| Reminder System | `ui-mock` | 켜져 있는 토글 2개. 알림 의존성·권한·스케줄러 0 |

### Phase 3 — §46 12개 항목

| 항목 | 상태 | 비고 |
|---|---|---|
| Email | `missing` | Login의 'Continue with Email' 버튼은 폼도 열지 않음 |
| Calendar (심화) | `ui-mock` | 위 Phase 2 항목과 동일한 죽은 설정 행 |
| Documents | `missing` | 파일 피커·파일시스템 의존성 0 |
| Contacts | `missing` | `expo-contacts` 없음, 권한 없음 |
| Location Context | `missing` | `expo-location` 없음, 권한 없음 |
| CarPlay | `missing` | 'Not set' 값의 죽은 설정 행 1개(`src/data.ts:204`). entitlement·타겟 없음 |
| Android Auto | `missing` | 위와 같은 행 1개. `app.json` android 블록에 car-app 설정 없음, 네이티브 `android/` 디렉터리 자체가 없음 |
| Smartwatch | `missing` | 전무 |
| Meeting Recording | `missing` | 녹음 기능 자체가 없음 |
| Web Clipper | `missing` | share extension·URL 처리 없음 |
| Photo Memory | `missing` | 이미지 피커·첨부 필드 없음 |
| Document Memory | `missing` | 저장 계층이 없어 둘 곳 자체가 없음 |

---

## 8. 지금 무엇을 해야 하는가

현재 상태에서 Phase 2·3을 논하는 것은 의미가 없습니다. **§44 MVP 하나를 실제로 동작시키는 것**이 유일한 목표여야 하며, 그 경로는 아래 순서를 벗어날 수 없습니다(각 단계가 다음 단계의 전제입니다).

### 0단계 — 지금 당장, 백엔드 없이 할 수 있는 정직화 (1~2일)

**이건 기능 추가가 아니라 "거짓말 제거"입니다. 다른 무엇보다 먼저 하십시오.**

1. **사실과 다른 문구 6개 제거 또는 수정** — 4장 표(B) 참조. 특히 `app/login.tsx:65`의 암호화 저장 주장과 `app/(tabs)/inbox.tsx:53`의 학습 주장
2. **onPress 없는 버튼 7개 처리** — `app/summary.tsx:64,65`, `app/(tabs)/thread.tsx:53,54`, `app/(tabs)/memory.tsx:67,68`, `app/(tabs)/account.tsx:91`. 지금은 눌림 효과까지 주면서 탭을 삼킵니다. 비활성 스타일로 바꾸거나 제거
3. **이미 계산되고 있는 값을 Home에 연결** — `app/(tabs)/index.tsx:59`의 `value="4"`를 `openTaskCount`(`src/store.tsx:145`)로. 한 줄짜리 수정인데 현재는 두 화면이 눈에 보이게 모순됩니다
4. **Topic 라우트 파라미터** — `app/(tabs)/memory.tsx:34`를 `router.push({ pathname: '/topic', params: { id } })`로, `app/(tabs)/topic.tsx`가 `useLocalSearchParams`를 읽게. Liflux/Faith/Family를 눌렀을 때 JoaSuite가 나오는 것은 **플레이스홀더가 아니라 틀린 데이터**입니다
5. **날짜 정합성** — journal 요일(`app/(tabs)/journal.tsx:39`, Sep 11 2026은 금요일), Home 'Sat, Sep 12' ↔ journal 'Sep 11' 불일치, `app/summary.tsx:37`의 헤드라인과 본문 개수 불일치
6. **Open loops 타일의 막다른 길** — 목록 화면을 만들거나, 만들기 전까지 링크를 제거

### 1단계 — 데이터 모델 (§4, §42) ★ 최대 병목

현재 앱에는 **id가 단 하나도 없습니다.** 이것이 §8(추적성), §13(다중 Topic), §14(쓰레드), §27(연결), §42(관계) 전부를 동시에 막고 있는 단일 원인입니다.

- `Entry` 타입 신설 + `EntryType` union(§4의 10종)
- 모든 레코드에 `id`, `createdAt`, `updatedAt`
- `Topic`을 표시 문자열이 아닌 엔티티로 (id, name, parentId — §5의 계층)
- `Conversation`에 `id`와 본문/세그먼트 참조 (`to: '/tasks'` 같은 **라우트 리터럴을 엔티티 참조로 교체**)
- `Entry ↔ Topic`(N:N), `Entry ↔ Conversation`, `Entry ↔ Task` 관계 테이블
- 실제 `Date` 값 도입 — 현재 앱에는 "오늘"이 없습니다
- 9개 화면에 흩어진 화면 로컬 const 11개(`app/summary.tsx:11`, `app/talk.tsx:13`, `app/(tabs)/topic.tsx:12`, `memory.tsx:9,16`, `journal.tsx:10,17`, `thread.tsx:10`, `search.tsx:11`, `index.tsx:11`, `account.tsx:12`)를 하나의 데이터 계층으로 통합

### 2단계 — 저장/영속화 (§7, §44.3)

`expo-sqlite` 또는 AsyncStorage 도입, `src/store.tsx`를 컬렉션 기반으로 재작성(현재는 `useState` 10개). 여기까지 오면 **이미 있는 화면들이 처음으로 "변하는" 경험**을 줍니다 — task 체크, inbox resolve, prefs가 재시작 후에도 남습니다. 동시에 로그아웃 시 상태 초기화(현재 `app/(tabs)/account.tsx:88`은 화면 전환만)와 사용자 identity를 여기서 함께 해결해야 합니다.

### 3단계 — 실제 캡처 (§7 Layer 1, §44.1)

`expo-av`/`expo-audio` + `app.json`에 `NSMicrophoneUsageDescription`·`RECORD_AUDIO` 추가(현재 **권한 선언이 0개라 마이크를 요청할 수조차 없습니다**) + 백그라운드 모드(§10·§40의 10분 캡처 전제) + 권한 거부/중단 처리(현재 `try/catch` 0건). `src/components/Waveform.tsx`를 boolean이 아닌 실제 오디오 레벨로 구동.

### 4단계 — STT (§44.2)

전사 결과를 1단계의 `Conversation` + `Segment`로 저장. 이 시점에 §7 Layer 1이 처음으로 실재하고, §8의 'Source →' 링크들이 가리킬 **목적지(원본 대화 뷰어 화면)** 를 새로 만들 수 있게 됩니다.

### 5단계 — LLM 추출 파이프라인 (§31의 11단계) ★ 가장 큰 보상

여기서 §44의 **4, 5, 6, 8, 9, 14가 한꺼번에 살아납니다.** Segmentation → Type 분류 → Topic 분류 → Task/Date 추출 → Entry 생성 → Inbox 유입 → Summary 생성. 이미 만들어진 Summary·Inbox·Tasks·Journal 화면이 그대로 수용부가 되므로, **UI를 거의 새로 만들지 않고 6개 MVP 항목이 채워집니다.** 단, 파이프라인이 수 초 걸리므로 3단계에서 만들지 않았다면 **처리 중(pending) 상태 표현**을 반드시 함께 만들어야 합니다(현재 앱에는 비동기 작업을 표현할 수단이 전혀 없습니다).

### 6단계 — Topic Memory와 검색 (§6, §19, §21, §43)

Topic별 집계(§6 7패널), Rolling Summary(§7 Layer 4), 관계형 필터 + 시맨틱 검색 2단계 파이프라인(§43). 이때 `app/(tabs)/search.tsx`의 TextInput에 submit을 붙이고 필터 칩을 `Tag`에서 `Pressable`로 교체하면 됩니다.

### 7단계 — 그 다음에야 Phase 2

Open Loops 화면, Weekly/Monthly Review, Entity 계층, Idea Status, Decision Tracking. 전부 1~2단계의 데이터 모델 위에서만 의미가 있습니다.

---

### 비용 관점 정리

**화면이 이미 있어서 백엔드만 붙이면 살아나는 것 (투자 대비 회수 큼)**
Summary, Inbox, Tasks, Journal, Topic Memory, Idea Thread, Search, Calendar, Rediscover 카드 — §44의 4·5·6·8·9·10·11·12·13·14가 여기 해당합니다.

**화면부터 새로 만들어야 하는 것 (디자인 작업 선행 필요)**
원본 대화 뷰어(§8, 모든 Source 링크의 목적지), Entry 상세 화면(§4), Open Loops 목록(§24 — 다만 1d 시안이 있음), Weekly/Monthly Review(§23), Entity 화면(§28), Topic 생성/수정(§44.7), 온보딩(`chat1.md:224`), 빈 상태/에러 상태 전반.

**백엔드 없이도 지금 고칠 수 있는 것**
0단계 6개 항목 전부, 그리고 필터 칩 활성화, 설정 상세 화면, Terms/Privacy 문서, 다국어 레이어, 키보드 회피 — 다만 이것들은 **1~5단계가 끝나기 전에는 "빈 UI를 더 그럴듯하게 만드는 일"** 이므로, 0단계를 제외하면 우선순위를 낮게 두는 편이 낫습니다.