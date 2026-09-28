# HYU Lecture Player

한양대 HY-ON 강의를 한 편씩 순서대로 재생합니다. 완료된 영상은 건너뛰고, 재생 후 LMS의 완료 표시까지 확인합니다.

## 실행하기

1. [Node.js](https://nodejs.org/) **22 이상**을 설치하세요. 브라우저는 **Chrome · Edge · Brave · Chromium** 중 하나가 있으면 됩니다.
2. 받은 파일을 압축 해제하고, 아래 실행 파일을 여세요.

| 운영체제 | 실행 |
| --- | --- |
| Mac | `run.command` 더블클릭 또는 터미널에서 `bash run.sh` |
| Windows | `run.cmd` 더블클릭 |
| Linux | 터미널에서 `bash run.sh` |

브라우저는 **Chrome → Edge → Brave → Chromium** 순서로 자동 탐지·실행합니다. 선택할 필요 없습니다. 처음에는 필요한 패키지를 자동 설치하며, 다음부터도 같은 파일만 실행하세요.

## 강의 보기

**로그인 → 과목 선택 → 주차 확인 → 보기**

- `↑ ↓` 이동 · `Space` 체크 · `Enter` 확인 · `Esc` 취소
- 지금 볼 수 있는 **미완료 주차는 기본 체크**되어 있습니다. 확인하고 Enter를 누르세요.
- 여러 과목도 **한 편씩 순차 재생**합니다. 중단은 `Ctrl+C`, 다시 실행하면 완료된 영상은 건너뜁니다.

## 이것만 기억하세요

- 재생 중에는 브라우저를 닫거나 컴퓨터를 절전 상태로 두지 마세요.
- **학습 완료 ≠ 출석 인정.** 기한이 지난 강의는 완료해도 결석일 수 있습니다.
- 로그인 정보는 이 컴퓨터에 저장됩니다. **`.private` 폴더는 공유하지 마세요.** 암호화 키도 들어 있습니다.

## 실행이 안 되나요?

- **브라우저를 못 찾으면:** 지원 브라우저를 기본 위치에 설치하세요. Mac은 앱을 **응용 프로그램** 폴더로 옮기세요. 없다면 [Chrome 설치](https://www.google.com/chrome/)를 권장합니다. Safari는 지원하지 않습니다.
- **Node.js 설치 후에도 오류가 나면:** 터미널을 닫고 다시 여세요.
- **그 밖의 오류:** `bash run.sh --check` 결과를 알려주세요. Windows는 `run.cmd --check`입니다.

실행 결과는 `bash run.sh --status`로 확인합니다. 추가 옵션은 `bash run.sh --help`를 보세요. Windows는 `bash run.sh` 대신 `run.cmd`를 사용합니다.

<details>
<summary>개발·지원 범위</summary>

한양대 LearningX 대상입니다. 실제 사이트 검증은 Linux/Chrome에서 진행했으며, Mac/Windows 실기기 검증은 아직입니다.

Brave·Chromium은 설치 경로를 자동 탐지하지만, 버전·영상 코덱에 따라 재생 호환성이 다를 수 있습니다. 문제가 있으면 Chrome을 사용하세요.

개발 실행: `npm ci` → `npm start` · 테스트: `npm test`

인증 흐름은 [HYU-course-registration](https://github.com/shchoi00/HYU-course-registration)을 참고했습니다.

</details>
