# 웹캠 풀바디 트래킹 → VRChat OSC 브리지

브라우저의 **웹캠 풀바디 트래킹** 도구가 계산한 트래커 데이터를 VRChat OSC 트래커로 보내 주는 중계 프로그램입니다.
브라우저는 UDP(OSC)를 직접 보낼 수 없기 때문에 이 브리지가 필요합니다. 외부 패키지 설치 없이 Node.js만 있으면 동작합니다.

```
웹캠 → 브라우저(MediaPipe 포즈 추정) → WebSocket(ws://localhost:8765) → osc-bridge.js → OSC(UDP 9000) → VRChat
```

## 준비물

- [Node.js](https://nodejs.org) 18 이상
- VRChat (PC VR 또는 Quest 단독 실행)
- 전신이 보이는 위치에 놓인 웹캠 (카메라에서 2~3m, 밝은 조명)

## 사용법

1. 브리지 실행

   ```bash
   # PC VR (SteamVR / Quest Link) — VRChat이 같은 PC에서 실행될 때
   node osc-bridge.js

   # Quest 단독 실행 — PC와 Quest가 같은 와이파이에 있어야 함
   node osc-bridge.js --ip 192.168.0.23   # Quest의 IP 주소
   ```

   | 옵션 | 기본값 | 설명 |
   | --- | --- | --- |
   | `--ip` | `127.0.0.1` | VRChat이 실행 중인 기기의 IP |
   | `--port` | `9000` | VRChat OSC 수신 포트 |
   | `--ws-port` | `8765` | 브라우저가 접속할 WebSocket 포트 |

2. VRChat에서 **액션 메뉴 → Options → OSC → Enabled** 를 켭니다.
3. 웹페이지의 **웹캠 풀바디 트래킹**에서 `Start` → 카메라를 보고 똑바로 서서 바닥 캘리브레이션이 끝날 때까지 기다립니다.
4. **VR 월드 연결** 버튼을 누릅니다. 브리지 창에 `브라우저 연결됨`이 뜨면 성공입니다.
5. VRChat에서 T자 자세로 풀바디 **Calibrate** 를 합니다.

## 전송되는 트래커

| OSC 번호 | 부위 |
| --- | --- |
| `/tracking/trackers/1` | 골반 (Hip) |
| `/tracking/trackers/2` | 가슴 (Chest) |
| `/tracking/trackers/3` | 왼발 |
| `/tracking/trackers/4` | 오른발 |
| `/tracking/trackers/5` | 왼무릎 |
| `/tracking/trackers/6` | 오른무릎 |
| `/tracking/trackers/head` | 머리 (트래킹 공간 정렬용, 페이지에서 끌 수 있음) |

각각 `/position`(미터)과 `/rotation`(도, Unity 오일러 각)을 보냅니다. 화면에서 가려진(인식이 불안정한) 트래커는 보내지 않아 아바타가 튀는 것을 줄입니다.

## 팁 & 한계

- 카메라가 1대라 **몸을 뒤로 돌리거나 손으로 발을 가리면** 트래킹을 잃습니다. 카메라를 정면으로 보고 움직이세요.
- 발이 떨리면 페이지의 **떨림 보정** 슬라이더를 올리세요. 대신 반응이 약간 느려집니다.
- 아바타가 바닥에 묻히거나 뜨면 **바닥 다시 맞추기**를 누르고 똑바로 서 주세요.
- 브라우저는 보안 정책상 `ws://localhost`만 연결할 수 있으므로, 브리지는 **웹캠을 쓰는 PC와 같은 PC**에서 실행해야 합니다.
