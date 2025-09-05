<div align="center">
  
  <img src="../../images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="README.md">English</a> •
    <a href="docs/README_CN.md">简体中文</a> •
    <a href="#">한국어</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>OpenInterpreter 기반 지능형 데이터 분석 에이전트</h3>
  <p><i>자연어로 데이터베이스와 대화하세요</i></p>
  
</div>

<br/>

---

## ✨ 핵심 장점

**데이터 분석가처럼 생각합니다**
- **자율 탐색**: 문제 발생 시 테이블 구조와 샘플 데이터를 능동적으로 확인
- **다중 검증**: 이상 징후 발견 시 재검토하여 정확한 결과 보장
- **복잡한 분석**: SQL뿐만 아니라 통계 분석과 머신러닝을 위한 Python 실행 가능
- **가시적 사고**: 에이전트의 추론 과정을 실시간으로 표시 (Chain-of-Thought)


## 🌟 주요 기능

### 에이전트 핵심 기능
- **자율 데이터 탐색**: 에이전트가 능동적으로 데이터 구조를 이해하고 관계를 탐색
- **다단계 추론**: 분석가처럼 문제 발생 시 심층 조사
- **Chain-of-Thought**: 에이전트의 사고 과정을 실시간으로 표시, 언제든 개입 가능
- **컨텍스트 메모리**: 대화 이력을 이해하여 연속적인 다중 라운드 분석 지원

### 데이터 분석 기능
- **SQL + Python**: SQL에 국한되지 않고 복잡한 Python 데이터 처리 실행
- **통계 분석**: 자동 상관관계 분석, 트렌드 예측, 이상 탐지
- **비즈니스 용어 이해**: YoY, MoM, 리텐션, 재구매 등 개념의 네이티브 이해
- **스마트 시각화**: 데이터 특성에 따라 최적의 차트 유형 자동 선택

### 시스템 기능
- **다중 모델 지원**: GPT-5, Claude, Gemini, Ollama 로컬 모델 자유롭게 전환
- **유연한 배포**: 클라우드 API 또는 Ollama 로컬 배포 지원, 데이터 유출 없음
- **히스토리 기록**: 분석 과정 저장, 백트래킹 및 공유 지원
- **데이터 보안**: 읽기 전용 권한, SQL 인젝션 방지, 민감 데이터 마스킹
- **유연한 내보내기**: Excel, PDF, HTML 등 다양한 형식 지원

## 🌐 10개 언어 지원

QueryGPT는 글로벌 사용을 위해 10개 언어를 지원합니다:
- 🇰🇷 **한국어** (완벽 지원)
- 🇬🇧 영어 (English)
- 🇨🇳 중국어 간체 (简体中文)
- 🇪🇸 스페인어 (Español)
- 🇫🇷 프랑스어 (Français)
- 🇩🇪 독일어 (Deutsch)
- 🇵🇹 포르투갈어 (Português)
- 🇷🇺 러시아어 (Русский)
- 🇯🇵 일본어 (日本語)
- 🇸🇦 아랍어 (العربية)

## 📦 시스템 요구사항

- Python 3.10.x (필수, OpenInterpreter 0.4.3 의존성)
- MySQL 또는 호환 데이터베이스
- 4GB 이상 RAM (권장: 8GB)
- 10GB 이상 여유 디스크 공간

> Windows: WSL에서 실행하세요 (PowerShell/CMD에서 직접 실행하지 마세요).

<br/>

## 📊 제품 비교

| 비교 항목 | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|----------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **비용** | **✅ 무료** | ⭕ 유료 버전 있음 | ✅ 무료 | ❌ 유료 | ❌ 유료 |
| **오픈소스** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **로컬 배포** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Python 코드 실행** | **✅ 완전한 환경** | ❌ | ❌ | ❌ | ❌ |
| **시각화** | **✅ 프로그래밍 가능** | ⭕ 사전 설정 차트 | ✅ 풍부한 차트 | ✅ 풍부한 차트 | ⭕ 기본 |
| **비즈니스 용어 이해** | **✅ 네이티브** | ⭕ 기본 | ✅ 양호 | ✅ 우수 | ⭕ 기본 |
| **에이전트 자율 탐색** | **✅** | ❌ | ⭕ 기본 | ⭕ 기본 | ❌ |
| **실시간 사고 표시** | **✅** | ❌ | ❌ | ❌ | ❌ |
| **확장성** | **✅ 무제한 확장** | ❌ | ❌ | ❌ | ❌ |

### 우리의 핵심 차별점
- **완전한 Python 환경**: 사전 설정 기능이 아닌 진정한 Python 실행 환경, 모든 코드 작성 가능
- **무제한 확장성**: 새 기능이 필요하면 새 라이브러리를 직접 설치, 제품 업데이트를 기다릴 필요 없음
- **에이전트 자율 탐색**: 문제 발생 시 능동적으로 조사, 단순한 일회성 쿼리가 아님
- **투명한 사고 과정**: AI가 무엇을 생각하는지 실시간으로 확인, 언제든 개입하여 안내 가능
- **진정한 무료 오픈소스**: MIT 라이선스, 유료 장벽 없음

## 📸 시스템 스크린샷

<table>
  <tr>
    <td width="50%">
      <strong>🤖 지능형 에이전트 사고 프로세스</strong><br/>
      <img src="../../images/agent-thinking-en.png" width="100%" alt="QueryGPT 인터페이스"/>
      <p align="center">투명한 사고 체인 시각화</p>
    </td>
    <td width="50%">
      <strong>📊 데이터 시각화</strong><br/>
      <img src="../../images/data-visualization-en.png" width="100%" alt="데이터 시각화"/>
      <p align="center">자동 선택을 통한 스마트 차트 생성</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>👨‍💻 개발자 뷰</strong><br/>
      <img src="../../images/developer-view-en.png" width="100%" alt="개발자 뷰"/>
      <p align="center">완전한 실행 세부 정보, 투명한 SQL 및 코드</p>
    </td>
    <td width="50%">
      <strong>🌐 다국어 지원</strong><br/>
      <img src="../../images/main-interface.png" width="100%" alt="메인 인터페이스"/>
      <p align="center">10개 언어 지원, 전 세계 접근 가능</p>
    </td>
  </tr>
</table>

## 🚀 빠른 시작

### 처음 사용하기

```bash
# 1. 프로젝트 클론
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. 설치 스크립트 실행 (자동 환경 구성)
./setup.sh

# 3. 서비스 시작
./start.sh
```

### 이후 사용

```bash
# 빠른 시작
./start.sh
```

서비스는 기본적으로 http://localhost:5000 에서 실행됩니다.

> **참고**: 포트 5000이 사용 중인 경우(예: macOS의 AirPlay), 시스템이 자동으로 다음 사용 가능한 포트(5001-5010)를 선택하고 시작 시 실제 사용 포트를 표시합니다.

## ⚙️ 구성 설정

### 기본 구성

1. **환경 구성 파일 복사**
   ```bash
   cp .env.example .env
   ```

2. **.env 파일 편집하여 다음 내용 구성**
   - `OPENAI_API_KEY`: OpenAI API 키
   - `OPENAI_BASE_URL`: API 엔드포인트 (선택사항, 기본값은 공식 엔드포인트)
   - 데이터베이스 연결 정보

### 시맨틱 레이어 구성 (선택사항)

시맨틱 레이어는 비즈니스 용어 이해를 향상시켜 시스템이 비즈니스 언어를 더 잘 이해하도록 합니다. **이는 선택적 구성이며, 구성하지 않아도 기본 기능에는 영향을 미치지 않습니다.**

1. **샘플 파일 복사**
   ```bash
   cp backend/semantic_layer.json.example backend/semantic_layer.json
   ```

2. **비즈니스 요구사항에 따라 구성 수정**
   
   시맨틱 레이어를 사용하면 다음과 같은 작업을 수행할 수 있습니다:
   - 테이블과 필드에 비즈니스 친화적인 별칭 추가
   - 일반적인 비즈니스 지표 정의
   - 데이터 간의 관계 설정

## 💡 사용 방법

### 자연어 쿼리 예시

**판매 분석:**
- "지난 달 총 매출액은 얼마입니까?"
- "상위 10개 고객을 매출액 기준으로 보여주세요"
- "제품 카테고리별 매출 비중을 파이 차트로 보여주세요"
- "지난 3개월간 매출 추세를 분석해주세요"

**고객 분석:**
- "신규 고객과 기존 고객의 비율은?"
- "고객 재구매율을 계산해주세요"
- "지역별 고객 분포를 보여주세요"
- "고객 생애 가치(LTV)를 분석해주세요"

**재고 관리:**
- "재고가 부족한 제품을 나열해주세요"
- "재고 회전율이 가장 높은 제품은?"
- "카테고리별 재고 금액을 계산해주세요"

### 고급 기능

#### Python 코드 실행
QueryGPT는 복잡한 데이터 분석을 위해 Python 코드를 직접 실행할 수 있습니다:
- 머신러닝 모델 학습 및 예측
- 고급 통계 분석
- 사용자 정의 데이터 처리
- 외부 API 통합

#### 다중 라운드 대화
시스템은 컨텍스트를 기억하여 연속적인 분석이 가능합니다:
```
사용자: "지난 달 매출을 보여주세요"
시스템: [매출 데이터 표시]
사용자: "전월 대비 증가율은?"
시스템: [이전 결과를 기반으로 증가율 계산]
```

## 🔧 고급 구성

### 모델 관리
시스템 설정에서 여러 AI 모델을 구성하고 전환할 수 있습니다:
- OpenAI GPT 시리즈
- Anthropic Claude
- Google Gemini
- 로컬 Ollama 모델

### 데이터베이스 지원
- MySQL / MariaDB
- PostgreSQL (어댑터 사용)
- SQLite (테스트용)
- Doris / ClickHouse (OLAP)

### 성능 최적화
- 쿼리 결과 캐싱
- 연결 풀링
- 비동기 처리
- 배치 쿼리 최적화

## 🛡️ 보안 기능

- **읽기 전용 권한**: 데이터 수정 방지
- **SQL 인젝션 방지**: 모든 쿼리 검증
- **민감 데이터 마스킹**: 자동 개인정보 보호
- **감사 로그**: 모든 쿼리 및 작업 기록
- **역할 기반 접근 제어**: 사용자별 권한 관리

## 📖 문서

자세한 문서는 다음을 참조하세요:
- [API 문서](docs/API.md)
- [구성 가이드](docs/CONFIGURATION.md)
- [배포 가이드](docs/DEPLOYMENT.md)
- [기여 가이드](CONTRIBUTING.md)

## 🤝 기여하기

우리는 모든 형태의 기여를 환영합니다!
- 버그 리포트 및 기능 제안
- 코드 기여
- 문서 개선
- 번역 지원

자세한 내용은 [기여 가이드](CONTRIBUTING.md)를 참조하세요.

## 📜 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🆕 최신 업데이트

- 2025-09-05 – 시작 속도 최적화: 첫 방문 시 모델 자동 테스트를 제거하여 초기 요청을 줄이고 상태 오기록을 방지했습니다.

## 🙏 감사의 말

이 프로젝트는 다음 오픈소스 프로젝트들의 도움으로 만들어졌습니다:
- [OpenInterpreter](https://github.com/OpenInterpreter/open-interpreter) - 핵심 실행 엔진
- [Flask](https://flask.palletsprojects.com/) - 웹 프레임워크
- [Plotly](https://plotly.com/) - 데이터 시각화
- 그리고 많은 다른 훌륭한 오픈소스 프로젝트들

## 📞 문의 및 지원

- **GitHub Issues**: [버그 리포트 및 기능 요청](https://github.com/MKY508/QueryGPT/issues)
- **Discussions**: [질문 및 토론](https://github.com/MKY508/QueryGPT/discussions)
- **이메일**: support@querygpt.example.com

---

<div align="center">
  <b>QueryGPT로 데이터와 더 스마트하게 대화하세요! 🚀</b>
  <br/>
  <sub>Made with ❤️ by the QueryGPT Team</sub>
</div>
