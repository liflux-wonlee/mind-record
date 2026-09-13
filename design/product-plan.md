# Mind Record — 제품 기획서

> 원본 기획 문서 (ChatGPT 작성). 이 문서를 기반으로 Claude Design 핸드오프가 만들어졌고,
> 그 핸드오프를 다시 Expo 앱으로 구현했다. 앱 이름은 이후 Mindecho → **Mind Record** 로 변경.
> 구현 현황 대조는 `design/gap-analysis.md` 참고.

---

# 1. 제품 한 줄 정의

**AI와 자연스럽게 대화하는 것만으로 일상의 생각, 아이디어, 일정, 해야 할 일, 고민과 기록을 자동으로 저장·분류·요약하고, 과거의 관련 기억까지 연결해주는 Voice-first Personal Memory & Action Assistant**

단순한 AI 일기나 메모 앱이 아니라,

**Capture → Understand → Organize → Remember → Act → Review**

의 전체 과정을 대신해주는 것이 핵심이다.

---

# 2. 이 앱이 해결하려는 문제

사람들은 하루 동안 수많은 생각을 한다.

“이거 나중에 해야겠다.”

“사업에 이런 기능 넣으면 좋을 것 같은데.”

“지난번에 생각한 것과 연결되는 아이디어인데…”

“이번 주에 누구한테 연락해야 하는데.”

“오늘 성경을 읽으면서 이런 생각이 들었다.”

하지만 대부분은 기록하지 않는다.

특히 운전하거나 이동할 때 생각이 많이 나지만 메모하기 어렵고, 나중에는 기억하지 못한다.

기존 메모 앱은 사용자가 직접 제목을 쓰고, 폴더를 고르고, 태그를 붙이고, 다시 정리해야 하기 때문에 결국 사용하지 않게 된다.

이 앱에서는 사용자가 정리할 필요가 없다.

**사용자는 그냥 AI에게 말한다.**

AI가 대화를 이해해서 자동으로 다음 작업을 수행한다.

| 사용자가 말한 내용      | AI가 처리하는 것          |
| --------------- | ------------------- |
| 생각              | Thought/Note로 저장    |
| 새로운 아이디어        | Idea로 저장            |
| 해야 할 일          | Task 생성             |
| 특정 날짜의 약속       | Schedule/Event 인식   |
| 중요한 결정          | Decision으로 저장       |
| 질문/고민           | Open Question으로 저장  |
| 기존 아이디어와 관련된 내용 | 기존 Topic/Thread에 연결 |
| 여러 이야기를 한꺼번에 함  | 각각 분리하여 저장          |
| 하루 동안 한 이야기     | Daily Summary 생성    |

---

# 3. 가장 중요한 제품 철학

## Zero Organization Required

사용자가 다음과 같은 행동을 할 필요가 없어야 한다.

폴더 선택
카테고리 선택
태그 입력
제목 입력
Task/Note 구분
날짜 입력
관련 메모 연결

AI가 최대한 자동으로 처리한다.

예를 들어 사용자가 운전하면서 이렇게 말한다고 하자.

> “생각해보니까 우리 회사 서비스 계약을 월 구독 형태로 더 만들어야 될 것 같아. 그리고 David한테 내일까지 전화해야겠다. 아 그리고 아침에 읽은 로마서 8장 내용도 다시 한번 공부해봐야 될 것 같아.”

AI는 하나의 음성 기록을 세 개로 분리할 수 있다.

| 내용             | 자동 처리                |
| -------------- | -------------------- |
| 서비스 계약 월 구독 모델 | Business → Idea      |
| David에게 전화     | Task → Due Tomorrow  |
| 로마서 8장 다시 공부   | Faith → Study / Task |

사용자는 **한 문장 안에서도 주제를 구분할 필요가 없다.**

---

# 4. 앱의 핵심 구조

앱 내부적으로는 모든 기록을 하나의 **Entry** 개념으로 저장하는 것이 좋다.

Entry에는 종류가 존재한다.

| Entry Type | 설명               |
| ---------- | ---------------- |
| Thought    | 일반적인 생각          |
| Idea       | 아이디어             |
| Journal    | 일기/개인 기록         |
| Task       | 해야 할 일           |
| Event      | 일정               |
| Decision   | 결정한 사항           |
| Question   | 나중에 생각하거나 조사할 질문 |
| Insight    | 깨달음/배운 점         |
| Reference  | 나중에 참고할 내용       |
| Goal       | 목표               |

그러나 사용자는 이 구조를 신경 쓸 필요가 없다.

AI가 자동 판단한다.

---

# 5. Topic이 이 앱의 가장 중요한 구조

폴더보다 **Topic**이라는 개념을 사용하는 것이 좋다.

예:

Business
　Liflux
　JoaSuite
　Investment

Faith
　Bible Study
　Sermon Ideas
　Theology

Family
Home
Health
Personal
Learning
Travel

Topic은 계층 구조를 가질 수 있다.

예를 들어:

Business
→ JoaSuite
→ Marketing

Business
→ JoaSuite
→ Product Ideas

Faith
→ Bible Study
→ Revelation

같은 구조가 가능하다.

AI가 기존 Topic을 확인하고 자동으로 연결한다.

---

# 6. Topic Memory

이 앱에서 다른 AI 메모 앱과 가장 크게 차별화할 수 있는 기능이다.

각 Topic마다 단순히 메모들을 모아놓는 것이 아니라 AI가 별도의 **Topic Memory**를 관리한다.

예를 들어 `Business > JoaSuite`에 들어가면 다음이 나타난다.

### JoaSuite Memory

**Current Summary**

지금까지 사용자가 JoaSuite에 대해 생각하고 결정한 전체 방향을 AI가 짧게 설명한다.

**Important Decisions**

이미 결정한 사항들을 모은다.

**Current Ideas**

아직 검토 중인 아이디어.

**Open Questions**

아직 결정하지 않은 사항.

**Goals**

현재 목표.

**Tasks**

관련된 해야 할 일.

**Recent Conversations**

최근 이 주제에 대해 나눈 이야기.

이렇게 하면 몇 달 뒤에도 AI에게

> “전에 JoaSuite onboarding에 대해서 내가 무슨 생각을 했었지?”

라고 질문할 수 있다.

AI는 단순히 문장을 검색하는 것이 아니라 **JoaSuite Topic Memory + 관련 과거 대화**를 이용하여 대답한다.

---

# 7. Memory의 구조

Memory는 한 가지가 아니라 여러 단계로 나누는 것이 좋다.

### Layer 1 — Raw Conversation

사용자가 실제로 말한 원본.

음성
Transcript
날짜/시간

원본은 AI가 수정하지 않는다.

### Layer 2 — Atomic Memories

대화를 작은 의미 단위로 분리한다.

예:

“서비스 계약을 subscription으로 만들자.”

→ Idea

“David한테 내일 전화해야겠다.”

→ Task

### Layer 3 — Topic Memory

관련 Atomic Memory들을 Topic 단위로 축적한다.

### Layer 4 — Rolling Summary

너무 오래된 모든 대화를 AI에게 매번 보내는 대신 Topic별로 현재 상황을 계속 요약한다.

### Layer 5 — Long-term Knowledge

장기간 유지되어야 하는 중요한 정보.

예:

“이 프로젝트는 B2B SaaS다.”

“사용자는 이 방식보다 저 방식을 선호한다.”

“이 아이디어는 이미 폐기했다.”

이렇게 해야 수년간 사용하더라도 AI가 과거 내용을 효과적으로 기억할 수 있다.

---

# 8. Source Traceability

AI가 과거 이야기를 잘못 기억하는 문제를 막기 위해 매우 중요하다.

AI가 다음과 같이 말할 수 있어야 한다.

> “7월 14일에 처음 이 아이디어를 이야기했고, 8월 3일에 가격 정책을 추가로 논의했습니다.”

그리고 누르면 실제 원본 대화로 갈 수 있어야 한다.

즉,

**AI Summary → Memory → Original Conversation**

을 언제든 추적할 수 있어야 한다.

AI가 만들어낸 요약과 사용자가 실제로 말한 내용을 구분해야 한다.

---

# 9. Voice-first UX

이 제품에서는 Voice 기능이 부가 기능이 아니라 **Primary Interface**여야 한다.

앱을 열면 가장 먼저 보이는 것은 큰 마이크 버튼이다.

### 기본 사용

사용자:

> “오늘 생각난 것 몇 개 이야기할게.”

AI:

> “네, 말씀하세요.”

그 뒤에는 자유롭게 이야기한다.

AI는 중간중간 방해하지 않는다.

대화가 끝나면:

> “오늘 이야기에서 아이디어 4개, 해야 할 일 3개, 일정 1개를 정리했습니다.”

정도로 짧게 알려준다.

---

# 10. Driving Mode

이 앱의 핵심 차별점이 될 수 있다.

### Driving Mode 원칙

화면을 거의 보지 않아도 사용할 수 있어야 한다.

큰 버튼
최소한의 UI
음성 응답
Bluetooth 지원
이어폰/차량 오디오 사용

Driving Mode에서는 AI가 긴 답변을 하지 않는 것이 좋다.

예:

사용자:

> “이거 나중에 사업 아이디어로 저장해줘.”

AI:

> “사업 아이디어로 저장했습니다.”

정도면 충분하다.

사용자가 원하면:

> “그 아이디어에 대해서 같이 생각해보자.”

라고 했을 때 Conversation Mode로 전환한다.

---

# 11. Conversation Mode와 Capture Mode

이 두 가지는 반드시 구분하는 것이 좋다.

### Capture Mode

목적:

**생각을 빠르게 기록**

AI는 최소한으로 대답한다.

사용자가 계속 말하도록 한다.

### Conversation Mode

목적:

**AI와 같이 생각하기**

AI가 질문한다.

아이디어를 발전시킨다.

장단점을 분석한다.

사용자의 기존 생각을 찾아준다.

예:

> “전에 비슷한 생각을 한 적이 있어요. 3개월 전에 이야기한 subscription service 아이디어와 상당히 비슷합니다. 둘을 연결할까요?”

### Brainstorm Mode

Conversation Mode의 확장 형태다.

AI가 적극적으로 아이디어를 제안하고 반론도 제시한다.

### Reflection Mode

개인적인 생각이나 일기 등에 적합하다.

AI가 지나치게 해결책을 제시하기보다 사용자의 생각을 정리해준다.

---

# 12. AI Inbox

AI가 자동으로 정리하더라도 사용자가 확인할 공간은 필요하다.

이를 **Inbox**라고 하는 것이 좋다.

오늘 기록한 내용이 들어온다.

예:

Today

Business idea
Call David tomorrow
Study Romans 8
Home repair idea
Family schedule

대부분 AI가 이미 분류했으므로 사용자는 그냥 확인하면 된다.

AI가 판단하기 어려운 것만 표시한다.

예:

> “이 내용은 Liflux와 JoaSuite 둘 다 관련 있어 보입니다.”

사용자가 한 번 선택하면 AI가 이후 분류에도 학습한다.

---

# 13. 자동 Topic 분류

AI는 하나의 기록에 여러 Topic을 연결할 수 있어야 한다.

예:

“JoaSuite에서 Liflux의 서비스 업무를 관리하면 좋겠다.”

Topic:

Business
Liflux
JoaSuite
Product Idea

따라서 전통적인 Folder 방식보다는

**Topic + Tag + Relationship**

형태가 좋다.

---

# 14. Topic Threads

특히 아이디어 관리에서 강력한 기능이 될 수 있다.

같은 아이디어에 대해 몇 달 동안 여러 번 이야기할 수 있다.

AI가 이것을 하나의 **Idea Thread**로 연결한다.

예:

Subscription Service Idea

June 4
Initial idea

June 18
Pricing discussion

July 12
Customer onboarding idea

August 5
Billing model revised

September 11
Final direction

사용자는 아이디어가 어떻게 발전했는지 볼 수 있다.

AI에게

> “이 아이디어가 처음부터 지금까지 어떻게 변했어?”

라고 질문할 수도 있다.

---

# 15. To-do / Action System

이 앱에서는 Todo가 메모와 완전히 분리되면 안 된다.

모든 Task에는 **그 Task가 왜 생겼는지**가 연결되어야 한다.

예:

### Call David

Due: Tomorrow
Topic: Business / Liflux

Created from:

September 11 conversation

> “David한테 내일까지 전화해서 service contract 물어봐야겠다.”

이렇게 되어야 나중에 Task를 보면서 맥락을 잊지 않는다.

---

# 16. 자연어 Task 생성

사용자는 별도의 Task 입력 화면을 사용할 필요가 없다.

> “내일 David 전화해야 돼.”

→ Task 생성

> “이번 주 안에 가격 한번 다시 검토하자.”

→ Task

> “10월쯤 다시 생각해보자.”

→ Reminder

> “다음 주 화요일 두 시에 John하고 만나야 한다.”

→ Calendar Event

AI가 날짜를 해석한다.

---

# 17. Task와 Schedule은 구분

둘을 하나로 만들지 않는 것이 좋다.

### Task

해야 하는 일.

예:

Call David

Review proposal

Study Romans 8

### Schedule / Event

특정 시간이 존재하는 일.

예:

Meeting with David
Tuesday 2 PM

Task에도 Due Date는 있을 수 있지만 Event와는 다르다.

---

# 18. AI가 Action을 놓치지 않는 기능

굉장히 유용할 수 있다.

사용자가 말했다.

> “이번에 홈페이지 가격도 좀 바꿔야 할 것 같아.”

AI는 이것이

생각인지
아이디어인지
실제로 해야 할 일인지

애매할 수 있다.

AI가 바로 운전 중에 질문할 필요는 없다.

대신 Inbox에:

**Possible Action**

> Website pricing을 변경할 계획이라고 언급했습니다.

`Create Task` / `Just Keep as Idea`

를 보여준다.

---

# 19. Natural Language Search

전통적인 키워드 검색보다 AI 검색이 핵심이다.

예:

> “지난 3개월 동안 내가 말한 사업 아이디어 보여줘.”

> “신앙에 관한 것만 보여줘.”

> “요한계시록에 대해 이야기했던 것 찾아줘.”

> “아직 실행하지 않은 사업 아이디어는?”

> “내가 pricing에 대해 최근에 어떤 생각을 했지?”

> “David 관련해서 해야 한다고 했던 것 있었어?”

> “한 달 전에 생각했는데 아직 Task로 안 만든 것들 찾아줘.”

이 수준의 검색이 가능해야 한다.

---

# 20. Search Filter

AI 검색과 일반 Filter를 같이 제공한다.

| Filter        | 예                      |
| ------------- | ---------------------- |
| Topic         | Business / Faith       |
| Type          | Idea / Task / Decision |
| Date          | Last 7 days            |
| Person        | David                  |
| Project       | JoaSuite               |
| Status        | Open / Done            |
| Source        | Voice / Typed          |
| Importance    | High                   |
| AI Confidence | Needs Review           |

그래서 사용자가 단순히

Business → Ideas

를 눌러 모든 사업 아이디어만 볼 수도 있다.

---

# 21. Ask My Memory

앱의 중요한 메뉴 중 하나로 만들 수 있다.

일반 ChatGPT와 비슷하게 보이지만 **내 기록만을 중심으로 대화한다.**

예:

> “내가 올해 새로운 사업으로 생각했던 것들이 뭐가 있어?”

AI:

> “올해 6개의 주요 사업 아이디어를 이야기했습니다…”

그리고 각각의 과거 기록을 연결한다.

또:

> “이 중에서 반복해서 이야기한 아이디어는?”

> “현실적으로 가장 실행 가능성이 높은 것은?”

> “서로 합칠 수 있는 아이디어는?”

같은 분석도 가능하다.

---

# 22. Daily Journal 자동 생성

하루 동안 여러 번 AI와 이야기한 내용을 이용하여 자동으로 Daily Journal을 만든다.

### September 11, 2026

**Today**

오늘은 새로운 AI 메모 앱의 구조를 주로 고민했다…

**Ideas**

3 new ideas

**Decisions**

2 decisions

**Tasks**

4 created
2 completed

**Faith**

Romans 관련 생각…

**Personal**

가족 일정 관련…

사용자가 직접 일기를 쓰지 않아도 **그날 무엇을 생각했는지가 자동으로 일기가 된다.**

이것은 상당히 강력한 기능이다.

---

# 23. Daily / Weekly / Monthly Review

단순 저장보다 훨씬 중요한 기능이다.

### Daily Review

오늘 말한 것
새 아이디어
새 Task
미완료 사항

### Weekly Review

이번 주 가장 많이 이야기한 Topic
새로운 아이디어
완료된 Task
계속 미뤄지는 Task
결정해야 하는 사항

### Monthly Review

이번 달 주요 관심사
아이디어의 변화
새로운 목표
반복적으로 등장하는 문제
실행되지 않은 아이디어

AI가 이런 것도 알려줄 수 있다.

> “지난 두 달 동안 marketing에 관한 아이디어를 다섯 번 이야기했지만 아직 Task로 만든 것은 없습니다.”

---

# 24. Open Loops

굉장히 중요한 기능으로 추천한다.

사람은 이야기를 해놓고 잊어버리는 경우가 많다.

AI가 해결되지 않은 것들을 **Open Loops**로 관리한다.

예:

Need to decide pricing
Need to call David
Need to research alarm license
Need to reconsider marketing agency

Open Loop는 Task와 다르다.

꼭 해야 하는 일이라기보다 **아직 결론이 나지 않은 생각**이다.

---

# 25. Decisions

Decision을 별도 타입으로 관리하는 것도 중요하다.

예:

> “그래. Basic에서는 organization 하나만 허용하자.”

AI:

**Decision detected**

Basic Plan → 1 Organization

그 뒤 몇 달 후:

> “Basic에 organization 몇 개 주기로 했었지?”

라고 물으면 바로 찾아낼 수 있다.

아이디어와 **확정된 Decision**을 구분할 수 있다는 것이 매우 중요하다.

---

# 26. Idea Status

Idea에는 상태를 둘 수 있다.

New
Considering
Researching
Planned
Implemented
Paused
Rejected

따라서 사용자는

> “생각만 하고 아직 진행하지 않은 사업 아이디어 보여줘.”

라고 할 수 있다.

---

# 27. Related Memory

새로운 이야기를 할 때 AI가 관련된 과거 기억을 발견할 수 있다.

사용자:

> “고객 onboarding할 때 기존 데이터를 가져오는 기능이 필요할 것 같아.”

AI:

> “비슷한 아이디어를 전에 이야기했습니다. 기존 SaaS 데이터를 단계별로 이전하는 Migration Wizard에 관한 내용입니다.”

이런 기능이 쌓이면 앱이 점점 **사용자의 두 번째 기억(second brain)** 역할을 하게 된다.

---

# 28. People / Organization / Project Entity

Topic 외에 Entity도 두는 것이 좋다.

예:

People
David
John
Esther

Companies
Liflux
ABC Construction

Projects
New Office
JoaSuite Launch

AI가 대화 중 Entity를 자동 인식한다.

그러면:

> “David에 대해서 내가 최근에 뭐라고 했지?”

와 같은 질문이 가능해진다.

---

# 29. Home 화면

Home을 복잡하게 만들 필요는 없다.

상단:

**What's on your mind?**

큰 마이크 버튼

그 아래:

Today

Tasks
Open Loops
Recent Thoughts
Upcoming Schedule

그리고:

Continue Conversation

예:

JoaSuite
Liflux
Faith
Personal

사용자가 다시 이전 생각을 이어갈 수 있게 한다.

---

# 30. 추천 Main Navigation

모바일에서는 다음 정도가 적당하다.

| Menu   | 역할       |
| ------ | -------- |
| Home   | 오늘 상황    |
| Talk   | AI 대화    |
| Memory | 모든 생각/기억 |
| Tasks  | 해야 할 일   |
| Topics | 주제별 보기   |
| Search | AI 검색    |

Calendar는 Home이나 Tasks 안에서도 접근 가능하게 할 수 있다.

모바일 Bottom Navigation은 너무 많지 않게

**Home / Talk / Tasks / Memory / Search**

정도가 좋다.

Topics는 Memory 내부에 넣어도 된다.

---

# 31. Conversation 종료 후 AI Processing

한 번의 대화가 끝나면 내부적으로 다음 Pipeline을 수행한다.

**Speech**

↓

**Transcript**

↓

**Thought Segmentation**

↓

**Information Extraction**

↓

**Type Classification**

↓

**Topic Classification**

↓

**Entity Detection**

↓

**Task / Date Detection**

↓

**Related Memory Search**

↓

**Memory Update**

↓

**Daily Summary Update**

즉 사용자에게는 대화 하나처럼 보이지만 내부에서는 여러 기록으로 분리된다.

---

# 32. 중요한 AI 원칙

AI가 무조건 내용을 바꾸면 안 된다.

항상 세 가지를 보관하는 것이 좋다.

**Original**

사용자가 실제로 말한 것.

**AI Summary**

AI가 정리한 것.

**AI Interpretation**

AI가 판단한 Topic, Task, Entity, Importance 등.

이 세 개를 구분한다.

---

# 33. Correction 기능

사용자가:

> “그건 Task가 아니야. 그냥 아이디어야.”

라고 하면 AI가 변경한다.

더 중요한 것은 이후 유사한 상황에서 사용자의 성향을 반영하는 것이다.

예를 들어 사용자가 자주

“해야 할 것 같다.”

라는 말을 Idea로 사용하는 사람이라면 AI가 이를 학습한다.

---

# 34. Privacy

이 앱에서는 상당히 민감한 개인 데이터가 저장될 수 있기 때문에 Privacy는 제품의 핵심 기능이어야 한다.

Topic별로 다음 옵션을 줄 수 있다.

Normal
Private
Highly Private

또한:

Audio 저장 여부
Transcript 삭제
AI Memory 제외
특정 Topic AI 학습/검색 제외

등을 제공할 수 있다.

사용자가

> “이건 기억하지 마.”

라고 말하는 음성 명령도 유용하다.

---

# 35. Calendar Integration

Google Calendar, Apple Calendar, Outlook Calendar와 연결할 수 있다.

사용자:

> “다음 화요일 오후 두 시 David 만나기로 했어.”

AI:

> “화요일 오후 2시 일정으로 추가할까요?”

확인 후 생성한다.

일정과 관련된 기존 기록도 연결한다.

Meeting with David

Related:

Service Contract Idea
David notes
Previous conversation

이런 형태가 좋다.

---

# 36. Notification 철학

알림을 너무 많이 보내면 앱을 끄게 된다.

따라서 알림은 단순 Reminder보다 **Contextual Reminder**가 좋다.

예:

일반 알림:

> Call David

보다

> Yesterday you said you wanted to call David about the service contract.

가 훨씬 유용하다.

---

# 37. Forgotten Ideas

이 앱만의 재미있고 강력한 기능이 될 수 있다.

AI가 가끔 과거의 좋은 아이디어를 다시 보여준다.

### Rediscover

> 4개월 전에 이야기했지만 다시 언급하지 않은 아이디어입니다.

AI-based customer onboarding assistant

사용자가:

Revisit
Archive
Convert to Task

를 선택할 수 있다.

---

# 38. AI가 발견하는 Patterns

충분한 데이터가 쌓이면 AI가 사용자의 생각에서 패턴을 찾을 수 있다.

예:

> “최근 세 달 동안 고객 서비스 자동화에 관한 생각을 반복적으로 이야기했습니다.”

> “사업 아이디어 중 subscription model과 관련된 것이 가장 많습니다.”

> “지난 4주 동안 금요일마다 다음 주 업무에 대한 아이디어를 많이 기록했습니다.”

이런 기능은 단순한 메모 앱을 넘어서는 영역이다.

---

# 39. 사용자가 자주 사용할 음성 명령

앱이 특정 명령어를 강제할 필요는 없지만 다음 표현들을 이해하면 좋다.

* “이거 기억해줘.”
* “이건 아이디어야.”
* “할 일로 만들어.”
* “내일 알려줘.”
* “이건 사업 관련이야.”
* “방금 말한 거 취소.”
* “아까 이야기 계속하자.”
* “전에 이거 관련해서 얘기한 적 있어?”
* “오늘 내가 얘기한 거 정리해줘.”
* “이번 주에 해야 할 거 알려줘.”
* “이건 저장만 하고 대답하지 마.”
* “이거에 대해서 같이 생각해보자.”

---

# 40. 가장 중요한 UX 기능 — "Save Only"

운전 중에는 특히 유용하다.

사용자:

> “지금부터 내가 말하는 것은 그냥 기록만 해.”

AI:

> “알겠습니다.”

이후 10분 동안 자유롭게 이야기한다.

AI는 아무 말도 하지 않는다.

끝나고:

> “끝.”

이라고 하면 AI가 정리한다.

이 기능은 반드시 넣는 것을 추천한다.

---

# 41. Conversation Resume

기존 Topic에서 대화를 계속할 수 있다.

예:

JoaSuite

Last discussion:

September 8

사용자가:

> “지난번에 하던 얘기 계속하자.”

AI가 Topic Summary와 최근 대화를 불러온다.

따라서 매번 배경을 다시 설명할 필요가 없다.

---

# 42. 기술적인 데이터 모델의 큰 방향

기본 Entity는 다음처럼 잡는 것을 추천한다.

**Conversation**

원본 대화 Session

↓

**Conversation Segment**

대화 내부의 의미 단위

↓

**Entry**

Idea / Thought / Decision / Task 등

↓

**Topic**

Business / Faith 등

↓

**Entity**

Person / Company / Project

↓

**Relationship**

Entry ↔ Topic
Entry ↔ Person
Entry ↔ Project
Entry ↔ Task
Entry ↔ Conversation

이 구조라면 나중에 상당히 확장하기 좋다.

---

# 43. AI 검색 구조

검색은 단순 Vector Search만 사용하면 부족하다.

**Relational Filter + Semantic Search + Topic Memory**

를 같이 사용하는 것이 좋다.

예:

> “지난 6개월 사업 아이디어 중 pricing 관련된 것.”

먼저:

Topic = Business
Type = Idea
Date = 6 months

로 좁히고,

그 안에서 Semantic Search로 pricing 관련 기록을 찾는다.

이 방식이 정확하다.

---

# 44. MVP에서 반드시 들어갈 기능

첫 버전에서 모든 것을 만들 필요는 없다.

## MVP

1. AI Voice Conversation
2. Speech-to-Text
3. Raw Conversation 저장
4. AI 자동 요약
5. Thought / Idea / Task 자동 분리
6. Topic 자동 분류
7. Topic 생성/수정
8. Task 추출
9. Due Date 인식
10. Natural Language Search
11. Topic별 Memory
12. Daily Summary
13. Original Conversation 연결
14. AI Inbox
15. Capture Mode / Conversation Mode

이 정도만 제대로 만들어도 제품의 핵심 가치는 충분히 검증할 수 있다.

---

# 45. Phase 2

MVP 이후에는 다음 기능을 추가한다.

Calendar Integration
Recurring Tasks
Weekly Review
Monthly Review
Open Loops
Decision Tracking
Idea Threads
People / Company / Project Entity
Related Memory Recommendation
Forgotten Ideas
Advanced Search Filters
Reminder System

---

# 46. Phase 3

장기적으로는 개인 AI 운영체제로 확장할 수 있다.

Email 연결
Calendar 연결
Documents 연결
Contacts 연결
Location Context
CarPlay
Android Auto
Smartwatch
Meeting Recording
Web Clipper
Photo Memory
Document Memory

그러면 AI가 단순히 사용자가 말한 것뿐 아니라 실제 생활의 Context까지 이해할 수 있다.

---

# 47. 이 제품에서 하지 말아야 할 것

처음부터 Notion처럼 만들면 안 된다.

폴더가 너무 많고
카테고리가 너무 많고
버튼이 많고
사용자가 데이터를 정리해야 하고
수많은 입력 필드가 생긴다면

이 앱의 본래 목적이 사라진다.

이 앱의 성공 여부는

**"얼마나 많은 기능이 있는가"가 아니라**

**"아무 생각 없이 말을 해도 얼마나 잘 정리해주는가"**

에 달려 있다.

---

# 48. 제품의 가장 중요한 차별점

이 앱의 핵심 가치는 네 가지로 정리할 수 있다.

### ① Frictionless Capture

생각나는 순간 그냥 말한다.

### ② Automatic Organization

AI가 자동으로 분류한다.

### ③ Long-term Contextual Memory

몇 달·몇 년 전 생각과 현재 생각을 연결한다.

### ④ Thought → Action

말했던 것을 실제 Task, 일정, Decision으로 변화시킨다.

이 네 가지가 동시에 잘 작동하면 단순 AI 메모 앱보다 훨씬 큰 제품이 될 수 있다.

---

# 49. 가장 이상적인 사용자 경험

아침 운전 중:

> “오늘 할 것 몇 개 생각났어…”

AI가 Task를 만든다.

점심 이동 중:

> “새로운 사업 아이디어가 있는데…”

AI가 기존 사업 아이디어와 연결한다.

저녁:

> “오늘 성경 읽으면서 이런 생각을 했어…”

AI가 Faith Topic에 저장한다.

밤에는 앱을 열면:

### Today

7 Thoughts
3 Ideas
4 Tasks
1 Decision
2 Faith Notes

### AI Summary

오늘 사용자는 사업 서비스 모델과 앱 기능에 대해 주로 고민했으며…

그리고 사용자는 아무것도 정리하지 않았는데 이미 하루가 체계적으로 기록되어 있다.

**이것이 이 앱이 제공해야 하는 핵심 경험이다.**

---

# 50. 제품의 최종 방향

처음에는:

**Voice AI Journal + Smart Notes + Tasks**

처럼 시작할 수 있다.

하지만 최종적으로는:

### Personal Memory OS

또는

### Personal AI Operating System

으로 발전할 수 있다.

사용자의

생각
아이디어
결정
할 일
일정
프로젝트
사람
대화
지식
과거 기억

을 모두 연결해주는 **개인의 외부 두뇌(External Brain)** 역할을 하는 것이다.

가장 중요한 제품 원칙을 한 문장으로 표현하면:

> **"Don't organize your life. Just talk. AI organizes it for you."**
