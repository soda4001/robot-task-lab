# Robot Task Lab - 개발 업무일지

**작성일자:** 2026-09-14  
**프로젝트:** Robot Task Lab (`D:\robot-task-lab`)  
**담당자:** Antigravity AI Pair Programmer & Solo Builder  

---

## 1. 금일 작업 요약 (Executive Summary)

* **물리 동역학 및 조종 모드(Direct Drive) 완성도 강화**:
  * 집게와 블록 간 3D 비관통(Zero-penetration) 및 밀기(Pushing) 물리 반응 완비.
  * 허공 집게 오므리기(Pinch) 애니메이션 및 서보 텔레메트리 동기화.
  * 테이블 밖 낙하 블록 자동 리스폰(Auto-respawn) 시스템 구축.
* **레로보(LeRobot) 스타일 모방학습 티칭(Imitation Learning & Teaching) 구현**:
  * 사람이 직접 팔을 조종하여 블록을 집고 옮기는 시범을 보여주면 실시간 궤적(Trajectory)과 집게 타이밍을 녹화.
  * 녹화된 시범을 로봇이 사람 손 없이 120Hz 물리 엔진 안에서 똑같이 따라 하는 **자율 재생(Autonomous Replay)** 구현.
  * 수집된 궤적을 **Python 독립 실행형 재생 스크립트** 및 **Arduino 4축 서보 PROGMEM 각도 배열**로 자동 변환(Export).
* **테스트 및 검증**:
  * 단위 테스트 19개 전원 통과 (`npm test`).
  * Vite 프로덕션 번들 빌드 성공 (`npm run build`).
  * 브라우저 실제 시연(녹화 → 학습 → 자율 재생 → 코드 Export) E2E 검증 완료.
  * Git GitHub `main` 브랜치 커밋 및 푸시 완료.

---

## 2. 세부 개발 내역 (Detailed Achievements)

### [Feature 1] 물리 충돌 비관통 및 밀기 동역학 (Zero Overlap & Pushing Dynamics)
* **문제점**: 수동 조종 시 집게 메쉬가 블록 내부로 파고들거나, 들고 있는 블록이 다른 블록과 겹치는 현상 발생.
* **해결 방안**:
  * 집게 좌우 핑거와 모터 팜에 대한 3D AABB 바운딩 박스 충돌 경계 계산.
  * 집게를 블록 측면으로 밀 때 블록이 테이블 위를 자연스럽게 밀려나는(Push) 물리 속도 부여.
  * 들고 있는 블록이 테이블 위 다른 블록과 부딪힐 때 연쇄적으로 밀어내는(Chain-push) 상호작용 구현.

### [Feature 2] 허공 집게 동작 및 자동 리스폰 (Air Pinch & Auto-Respawn)
* 블록이 없는 허공에서도 `Space` 키 또는 HUD 버튼을 누르면 집게 핑거가 부드럽게 오므려지고 펴지는 LERP 애니메이션 구현.
* 조종 중 블록을 잘못 밀어 테이블 밖(`y < -0.25` 등)으로 떨어질 경우, 작업이 중단되지 않고 원래 테이블 스폰 위치(`y = 0.12`)로 즉시 리스폰.

### [Feature 3] 모방학습 시범 녹화 (Demonstration Recording)
* **Direct Drive HUD 업그레이드**:
  * 상단에 `[● Record Demonstration (시범 녹화)]` 버튼 추가.
  * 녹화 시작 시 펄싱(Pulsing) 레드 인디케이터, 실시간 녹화 시간(`REC 00.0s`), 샘플링 포인트 수(`pts`) 표시.
  * 로봇 팔의 3D 카테시안 좌표 `(x, y, z)` 및 집게 파지 상태를 타임스탬프와 함께 압축 수집.
  * `[✔ Save & Learn]`으로 저장하거나 `[✕]`로 즉시 취소 가능.

### [Feature 4] 자율 재생 (Autonomous Replay Engine)
* 사람이 가르쳐준 시범 궤적을 120Hz 물리 엔진 주기에 맞춰 선형 보간(Lerp)하여 로봇 암 모션을 재생.
* 기록된 파지/해제 타이밍에 맞춰 물리 제약 조건(`LockConstraint`)이 자동으로 체결/해제되어 블록을 실제로 들어 올리고 타겟에 적치.
* HUD 및 하단 트랜스포트 바에 원터치 `[✨ Replay Learned]` 버튼 배치.

### [Feature 5] Sim-to-Real 코드 생성 (Python & Arduino Export)
* **Python (`robot_imitation_learning.py`)**:
  * Cartesian 궤적 배열 `TRAJECTORY = [(t, x, y, z, grip), ...]` 및 실시간 동기화 루프가 포함된 실행형 코드.
* **Arduino (`robot_trajectory_replay.ino`)**:
  * 4축 서보 모터(Base, Shoulder, Elbow, Gripper) 각도를 역기구학(IK)으로 자동 계산하여 `PROGMEM` 배열로 변환.

---

## 3. 테스트 및 빌드 현황 (Verification)

```
✓ src/simulation.test.ts (19 tests) 595ms
  - physical task validation (sort, precision, stack)
  - kinematic & direct drive teleoperation
  - 3D contact separation & non-penetration
  - fallen block auto-respawn
  - demonstration waypoint recording & duration tracking
  - autonomous trajectory replay execution
  - Python & Arduino code generation and validation
```

* **테스트 결과**: 19 Passed, 0 Failed
* **빌드 결과**: `dist/` 프로덕션 번들 2.80s 빌드 완료 (TypeScript 컴파일 에러 0건)
* **브라우저 실제 동작**: `http://127.0.0.1:5180`에서 모든 시나리오 정상 동작 확인

---

## 4. Git 커밋 로그 (Recent Commits)

* `729c773`: `feat(teaching): implement imitation learning demonstration recording and autonomous replay`
* `b7d1aff`: `feat: automatically respawn blocks back onto workbench if they fall off the table`
* `5dcc7c3`: `fix: ensure clean simulation start when transitioning from teleop mode to automated run`
