// --- Webcam Full Body Tracking (MediaPipe Pose Landmarker) ---
// 웹캠 한 대로 전신 관절을 추정하고, VRChat OSC 트래커 규격
// (/tracking/trackers/1~8, Unity 좌표계, 미터·도 단위)에 맞는
// 가상 트래커(골반, 가슴, 양발, 양 무릎)와 머리 기준점을 계산합니다.
import {
    PoseLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// MediaPipe Pose landmark indices
const LM = {
    NOSE: 0, L_EAR: 7, R_EAR: 8,
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_HIP: 23, R_HIP: 24,
    L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28,
    L_FOOT: 31, R_FOOT: 32
};
const USED_LANDMARKS = Object.values(LM);

// VRChat OSC 트래커 번호(1~8)와 화면 표시용 랜드마크
const TRACKERS = [
    { id: 1, name: "골반 (Hip)", screen: [LM.L_HIP, LM.R_HIP] },
    { id: 2, name: "가슴 (Chest)", screen: [LM.L_SHOULDER, LM.R_SHOULDER] },
    { id: 3, name: "왼발", screen: [LM.L_ANKLE, LM.L_FOOT] },
    { id: 4, name: "오른발", screen: [LM.R_ANKLE, LM.R_FOOT] },
    { id: 5, name: "왼무릎", screen: [LM.L_KNEE] },
    { id: 6, name: "오른무릎", screen: [LM.R_KNEE] }
];

const VISIBILITY_THRESHOLD = 0.5;
const CALIBRATION_FRAMES = 30;
const RAD2DEG = 180 / Math.PI;

// One Euro Filter: 가만히 있을 때의 떨림(Jitter)은 강하게, 빠른 움직임은 덜 지연되게 필터링
class LowPass {
    constructor() { this.y = null; }
    filter(x, alpha) {
        this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
        return this.y;
    }
}

class OneEuroFilter {
    constructor(minCutoff = 1.0, beta = 0.3, dCutoff = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.x = new LowPass();
        this.dx = new LowPass();
        this.lastTime = null;
        this.lastRaw = null;
    }
    static alpha(cutoff, dt) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }
    filter(value, timeSec) {
        if (this.lastTime === null) {
            this.lastTime = timeSec;
            this.lastRaw = value;
            return this.x.filter(value, 1);
        }
        const dt = Math.max(timeSec - this.lastTime, 1e-3);
        this.lastTime = timeSec;
        const dValue = (value - this.lastRaw) / dt;
        this.lastRaw = value;
        const edValue = this.dx.filter(dValue, OneEuroFilter.alpha(this.dCutoff, dt));
        const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
        return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
    }
}

// --- Vector helpers (Unity 좌표계: x 오른쪽, y 위, z 앞, 왼손 좌표계) ---
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const mid = (a, b) => scale(add(a, b), 0.5);
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
];
const normalize = (a) => {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    return scale(a, 1 / len);
};

// MediaPipe world 좌표(골반 중심, x=이미지 오른쪽, y=아래, z=카메라에서 멀어지는 쪽)를
// 사용자가 카메라를 바라보는 기준의 Unity 좌표(x=사용자 오른쪽, y=위, z=사용자 앞)로 변환
const toUnity = (p) => [-p.x, -p.y, -p.z];

// 오른쪽/위 방향 벡터로 회전을 만들고 Unity 오일러 각도(도, Z→X→Y 순서)로 변환
function eulerFromBasis(rightHint, upHint) {
    const up = normalize(upHint);
    const forward = normalize(cross(normalize(rightHint), up));
    const right = cross(up, forward);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -forward[1])));
    const yaw = Math.atan2(forward[0], forward[2]);
    const roll = Math.atan2(right[1], up[1]);
    return [pitch * RAD2DEG, yaw * RAD2DEG, roll * RAD2DEG];
}

// 발: 발끝 방향을 앞으로, 세계 위쪽을 기준으로 회전 계산
function footEuler(ankle, toe) {
    const forward = normalize(sub(toe, ankle));
    const right = cross([0, 1, 0], forward);
    return eulerFromBasis(right, cross(forward, right));
}

// 필터링된 Unity 좌표 랜드마크로 VRChat 트래커 + 머리 기준점을 계산
function computeTrackers(p, floorOffset) {
    const lift = (v) => [v[0], v[1] + floorOffset, v[2]];
    const hip = mid(p[LM.L_HIP], p[LM.R_HIP]);
    const chest = mid(p[LM.L_SHOULDER], p[LM.R_SHOULDER]);
    const hipRight = sub(p[LM.R_HIP], p[LM.L_HIP]);
    const hipRot = eulerFromBasis(hipRight, sub(chest, hip));
    const chestRot = eulerFromBasis(sub(p[LM.R_SHOULDER], p[LM.L_SHOULDER]), sub(chest, hip));
    const head = mid(p[LM.L_EAR], p[LM.R_EAR]);
    const headRot = eulerFromBasis(sub(p[LM.R_EAR], p[LM.L_EAR]), sub(head, chest));

    return {
        trackers: [
            { position: lift(hip), rotation: hipRot },
            { position: lift(chest), rotation: chestRot },
            { position: lift(p[LM.L_ANKLE]), rotation: footEuler(p[LM.L_ANKLE], p[LM.L_FOOT]) },
            { position: lift(p[LM.R_ANKLE]), rotation: footEuler(p[LM.R_ANKLE], p[LM.R_FOOT]) },
            { position: lift(p[LM.L_KNEE]), rotation: hipRot },
            { position: lift(p[LM.R_KNEE]), rotation: hipRot }
        ],
        head: { position: lift(head), rotation: headRot }
    };
}

(function() {
    const startBtn = document.getElementById("fbt-start-btn");
    if (!startBtn) return;

    const video = document.getElementById("fbt-video");
    const canvas = document.getElementById("fbt-canvas");
    const ctx = canvas.getContext("2d");
    const statusEl = document.getElementById("fbt-status");
    const tableBody = document.getElementById("fbt-tracker-body");
    const smoothingInput = document.getElementById("fbt-smoothing");
    const calibrateBtn = document.getElementById("fbt-calibrate-btn");
    const wsInput = document.getElementById("fbt-ws-url");
    const wsBtn = document.getElementById("fbt-ws-btn");
    const wsStatus = document.getElementById("fbt-ws-status");
    const sendHeadInput = document.getElementById("fbt-send-head");

    let poseLandmarker = null;
    let running = false;
    let lastVideoTime = -1;
    let filters = createFilters();
    let socket = null;
    // 바닥 높이 캘리브레이션: 똑바로 선 자세에서 발목 높이를 바닥(y=0) 근처로 맞춤
    let floorOffset = null;
    let calibrationSamples = [];

    function createFilters() {
        // 슬라이더 값(0~100)이 클수록 minCutoff를 낮춰 더 부드럽게
        const level = smoothingInput ? Number(smoothingInput.value) : 50;
        const minCutoff = 3.0 - (level / 100) * 2.8;
        const map = {};
        for (const id of USED_LANDMARKS) {
            map[id] = [0, 1, 2].map(() => new OneEuroFilter(minCutoff, 0.3));
        }
        return map;
    }

    function startCalibration() {
        floorOffset = null;
        calibrationSamples = [];
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function averageVisibility(landmarks, ids) {
        return ids.reduce((sum, id) => sum + (landmarks[id].visibility ?? 1), 0) / ids.length;
    }

    function averageScreen(landmarks, ids) {
        const x = ids.reduce((sum, id) => sum + landmarks[id].x, 0) / ids.length;
        const y = ids.reduce((sum, id) => sum + landmarks[id].y, 0) / ids.length;
        return { x, y };
    }

    function buildTrackerRows() {
        tableBody.innerHTML = "";
        for (const t of TRACKERS) {
            const row = document.createElement("tr");
            row.innerHTML = `<td>${t.id}. ${t.name}</td><td>-</td><td>-</td><td>-</td>`;
            tableBody.appendChild(row);
        }
    }

    async function init() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus("이 브라우저에서는 웹캠을 쓸 수 없습니다. HTTPS 주소로 접속했는지 확인하세요.");
            return;
        }
        startBtn.disabled = true;
        setStatus("AI 모델을 불러오는 중...");
        try {
            if (!poseLandmarker) {
                const vision = await FilesetResolver.forVisionTasks(WASM_URL);
                poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
                    runningMode: "VIDEO",
                    numPoses: 1
                });
            }

            setStatus("웹캠을 켜는 중...");
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 }
            });
            video.srcObject = stream;
            await video.play();

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            buildTrackerRows();
            filters = createFilters();
            startCalibration();
            running = true;
            startBtn.textContent = "Stop";
            startBtn.disabled = false;
            requestAnimationFrame(loop);
        } catch (error) {
            console.error("Full body tracking init failed:", error);
            setStatus("시작 실패: 웹캠 권한 또는 네트워크 연결을 확인하세요.");
            startBtn.disabled = false;
        }
    }

    function stop() {
        running = false;
        const stream = video.srcObject;
        if (stream) stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        startBtn.textContent = "Start";
        setStatus("정지됨");
    }

    function loop() {
        if (!running) return;
        if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const now = performance.now();
            const result = poseLandmarker.detectForVideo(video, now);
            render(result, now / 1000);
        }
        requestAnimationFrame(loop);
    }

    function render(result, timeSec) {
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 거울 모드로 그리기
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const landmarks = result.landmarks && result.landmarks[0];
        const world = result.worldLandmarks && result.worldLandmarks[0];
        if (!landmarks || !world) {
            ctx.restore();
            setStatus("사람이 감지되지 않습니다. 카메라에서 조금 떨어져 전신이 보이게 해주세요.");
            return;
        }

        const drawingUtils = new DrawingUtils(ctx);
        drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
            color: "#4dabf7",
            lineWidth: 3
        });
        drawingUtils.drawLandmarks(landmarks, { color: "#ffffff", radius: 2 });

        // 사용하는 랜드마크만 Unity 좌표로 변환 후 떨림 필터 적용
        const points = {};
        for (const id of USED_LANDMARKS) {
            points[id] = toUnity(world[id]).map((v, axis) => filters[id][axis].filter(v, timeSec));
        }

        // 바닥 캘리브레이션: 처음 몇 프레임 동안 발목 높이 평균을 모아 바닥 기준으로 사용
        if (floorOffset === null) {
            const ankleY = Math.min(points[LM.L_ANKLE][1], points[LM.R_ANKLE][1]);
            calibrationSamples.push(ankleY);
            if (calibrationSamples.length >= CALIBRATION_FRAMES) {
                const avg = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length;
                // 발목은 바닥에서 약 8cm 위
                floorOffset = 0.08 - avg;
            }
        }

        const { trackers, head } = computeTrackers(points, floorOffset ?? 0);

        const lost = [];
        TRACKERS.forEach((tracker, i) => {
            const screen = averageScreen(landmarks, tracker.screen);
            const visible = averageVisibility(landmarks, tracker.screen) >= VISIBILITY_THRESHOLD;
            trackers[i].visible = visible;

            ctx.beginPath();
            ctx.arc(screen.x * canvas.width, screen.y * canvas.height, 9, 0, Math.PI * 2);
            ctx.fillStyle = visible ? "rgba(81, 207, 102, 0.9)" : "rgba(255, 107, 107, 0.9)";
            ctx.fill();

            const pos = trackers[i].position;
            const cells = tableBody.rows[i].cells;
            cells[1].textContent = pos[0].toFixed(2);
            cells[2].textContent = pos[1].toFixed(2);
            cells[3].textContent = pos[2].toFixed(2);
            tableBody.rows[i].classList.toggle("fbt-lost", !visible);

            if (!visible) lost.push(tracker.name);
        });
        ctx.restore();

        if (floorOffset === null) {
            setStatus("캘리브레이션 중 — 카메라를 정면으로 보고 똑바로 서 주세요...");
        } else if (lost.length) {
            setStatus(`가려진 부위: ${lost.join(", ")} — 정면을 보고 가리지 않게 움직여 주세요.`);
        } else {
            setStatus("트래킹 중 — 모든 트래커가 정상 인식되고 있습니다.");
        }

        // 캘리브레이션이 끝난 뒤에만 VR 월드로 전송
        if (floorOffset !== null && socket && socket.readyState === WebSocket.OPEN) {
            const message = {
                type: "trackers",
                trackers: TRACKERS.map((t, i) => ({
                    id: t.id,
                    position: trackers[i].position,
                    rotation: trackers[i].rotation,
                    visible: trackers[i].visible
                }))
            };
            if (!sendHeadInput || sendHeadInput.checked) message.head = head;
            socket.send(JSON.stringify(message));
        }
    }

    startBtn.addEventListener("click", () => {
        if (running) stop(); else init();
    });

    if (calibrateBtn) {
        calibrateBtn.addEventListener("click", startCalibration);
    }

    if (smoothingInput) {
        smoothingInput.addEventListener("input", () => {
            filters = createFilters();
        });
    }

    function setWsStatus(text) {
        if (wsStatus) wsStatus.textContent = text;
    }

    // 브라우저는 UDP(OSC)를 직접 보낼 수 없으므로 WebSocket으로 같은 PC의
    // 브리지(vr-bridge/osc-bridge.js)에 보내고, 브리지가 VRChat OSC로 변환합니다.
    if (wsBtn) {
        wsBtn.addEventListener("click", () => {
            if (socket) {
                socket.close();
                return;
            }
            const url = wsInput.value.trim() || wsInput.placeholder;
            try {
                socket = new WebSocket(url);
            } catch (error) {
                socket = null;
                setWsStatus("WebSocket 주소가 올바르지 않습니다.");
                return;
            }
            wsBtn.textContent = "연결 해제";
            setWsStatus("브리지에 연결하는 중...");
            socket.addEventListener("open", () => {
                setWsStatus(`연결됨 — ${url} 로 트래커 데이터를 보내는 중`);
            });
            socket.addEventListener("close", () => {
                socket = null;
                wsBtn.textContent = "VR 월드 연결";
                setWsStatus("연결 끊김 — 브리지 프로그램이 실행 중인지 확인하세요.");
            });
        });
    }
})();
