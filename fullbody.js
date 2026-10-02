// --- Webcam Full Body Tracking (MediaPipe Pose Landmarker) ---
// 웹캠 한 대로 전신 관절을 추정하고, VR 풀바디 트래킹에서 쓰는
// 가상 트래커(골반, 가슴, 양 무릎, 양발) 위치를 계산해 보여줍니다.
import {
    PoseLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// MediaPipe Pose landmark indices
const LM = {
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_HIP: 23, R_HIP: 24,
    L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28,
    L_FOOT: 31, R_FOOT: 32
};

// 가상 트래커 정의: 사용할 랜드마크들의 평균 위치를 트래커 위치로 사용
const TRACKERS = [
    { name: "골반 (Hip)", ids: [LM.L_HIP, LM.R_HIP] },
    { name: "가슴 (Chest)", ids: [LM.L_SHOULDER, LM.R_SHOULDER] },
    { name: "왼무릎", ids: [LM.L_KNEE] },
    { name: "오른무릎", ids: [LM.R_KNEE] },
    { name: "왼발", ids: [LM.L_ANKLE, LM.L_FOOT] },
    { name: "오른발", ids: [LM.R_ANKLE, LM.R_FOOT] }
];

const VISIBILITY_THRESHOLD = 0.5;

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

(function() {
    const startBtn = document.getElementById("fbt-start-btn");
    if (!startBtn) return;

    const video = document.getElementById("fbt-video");
    const canvas = document.getElementById("fbt-canvas");
    const ctx = canvas.getContext("2d");
    const statusEl = document.getElementById("fbt-status");
    const tableBody = document.getElementById("fbt-tracker-body");
    const smoothingInput = document.getElementById("fbt-smoothing");
    const wsInput = document.getElementById("fbt-ws-url");
    const wsBtn = document.getElementById("fbt-ws-btn");

    let poseLandmarker = null;
    let running = false;
    let lastVideoTime = -1;
    let filters = createFilters();
    let socket = null;

    function createFilters() {
        // 슬라이더 값(0~100)이 클수록 minCutoff를 낮춰 더 부드럽게
        const level = smoothingInput ? Number(smoothingInput.value) : 50;
        const minCutoff = 3.0 - (level / 100) * 2.8;
        return TRACKERS.map(() => [0, 1, 2].map(() => new OneEuroFilter(minCutoff, 0.3)));
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function average(landmarks, ids) {
        const sum = { x: 0, y: 0, z: 0, visibility: 0 };
        for (const id of ids) {
            const p = landmarks[id];
            sum.x += p.x;
            sum.y += p.y;
            sum.z += p.z;
            sum.visibility += p.visibility ?? 1;
        }
        const n = ids.length;
        return { x: sum.x / n, y: sum.y / n, z: sum.z / n, visibility: sum.visibility / n };
    }

    function buildTrackerRows() {
        tableBody.innerHTML = "";
        for (const t of TRACKERS) {
            const row = document.createElement("tr");
            row.innerHTML = `<td>${t.name}</td><td>-</td><td>-</td><td>-</td>`;
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
            const vision = await FilesetResolver.forVisionTasks(WASM_URL);
            poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
                runningMode: "VIDEO",
                numPoses: 1
            });

            setStatus("웹캠을 켜는 중...");
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 }
            });
            video.srcObject = stream;
            await video.play();

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            buildTrackerRows();
            running = true;
            startBtn.textContent = "Stop";
            startBtn.disabled = false;
            setStatus("트래킹 중 — 머리부터 발끝까지 화면에 들어오도록 서 주세요.");
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

        const lost = [];
        const payload = [];
        TRACKERS.forEach((tracker, i) => {
            const screen = average(landmarks, tracker.ids);
            const raw = average(world, tracker.ids);
            const visible = screen.visibility >= VISIBILITY_THRESHOLD;

            // worldLandmarks는 골반 중심 기준 미터 단위, y축이 아래 방향 → 위쪽을 +로 뒤집음
            const pos = [raw.x, -raw.y, raw.z].map((v, axis) => filters[i][axis].filter(v, timeSec));

            ctx.beginPath();
            ctx.arc(screen.x * canvas.width, screen.y * canvas.height, 9, 0, Math.PI * 2);
            ctx.fillStyle = visible ? "rgba(81, 207, 102, 0.9)" : "rgba(255, 107, 107, 0.9)";
            ctx.fill();

            const cells = tableBody.rows[i].cells;
            cells[1].textContent = pos[0].toFixed(2);
            cells[2].textContent = pos[1].toFixed(2);
            cells[3].textContent = pos[2].toFixed(2);
            tableBody.rows[i].classList.toggle("fbt-lost", !visible);

            if (!visible) lost.push(tracker.name);
            payload.push({ name: tracker.name, position: pos, visible });
        });
        ctx.restore();

        setStatus(lost.length
            ? `가려진 부위: ${lost.join(", ")} — 정면을 보고 가리지 않게 움직여 주세요.`
            : "트래킹 중 — 모든 트래커가 정상 인식되고 있습니다.");

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ time: timeSec, trackers: payload }));
        }
    }

    startBtn.addEventListener("click", () => {
        if (running) stop(); else init();
    });

    if (smoothingInput) {
        smoothingInput.addEventListener("input", () => {
            filters = createFilters();
        });
    }

    // 브라우저는 UDP(OSC)를 직접 보낼 수 없으므로, WebSocket으로 내보내고
    // 로컬 브리지 프로그램이 OSC/VMT로 변환하도록 하는 구조입니다.
    if (wsBtn) {
        wsBtn.addEventListener("click", () => {
            if (socket) {
                socket.close();
                socket = null;
                wsBtn.textContent = "연결";
                return;
            }
            const url = wsInput.value.trim();
            if (!url) {
                alert("WebSocket 주소를 입력해주세요. 예: ws://localhost:8765");
                return;
            }
            try {
                socket = new WebSocket(url);
            } catch (error) {
                alert("WebSocket 주소가 올바르지 않습니다.");
                return;
            }
            wsBtn.textContent = "연결 해제";
            socket.addEventListener("close", () => {
                socket = null;
                wsBtn.textContent = "연결";
            });
            socket.addEventListener("error", () => {
                alert("WebSocket 연결에 실패했습니다. 브리지 프로그램이 실행 중인지 확인하세요.");
            });
        });
    }
})();
