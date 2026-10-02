// --- 웹캠 풀바디 환경 진단기 (MediaPipe Pose Landmarker) ---
// 10초 동안 웹캠 영상을 분석해 "내 방, 내 웹캠, 내 조명"이 웹캠 풀바디 트래킹에
// 적합한지 점수로 보여주고, 헤드셋 종류에 맞는 프로그램을 추천합니다.
import {
    PoseLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MEASURE_SECONDS = 10;
const DETECT_TIMEOUT_SECONDS = 15;
const VISIBILITY_THRESHOLD = 0.5;
const EDGE_MARGIN = 0.02;

// 전신 트래킹에 필요한 랜드마크: 코, 어깨, 골반, 무릎, 발목, 발끝
const NOSE = 0;
const L_ANKLE = 27;
const R_ANKLE = 28;
const BODY_LANDMARKS = [NOSE, 11, 12, 23, 24, 25, 26, L_ANKLE, R_ANKLE, 31, 32];

// 측정값 → 0~100점 (lo 이하/hi 이상 구간을 선형으로 보간)
function linearScore(value, worst, best) {
    const t = (value - worst) / (best - worst);
    return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

function rangeScore(value, min, max, tolerance) {
    if (value < min) return linearScore(value, min - tolerance, min);
    if (value > max) return linearScore(value, max + tolerance, max);
    return 100;
}

function stdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function evaluate(stats) {
    const fullBodyRate = stats.fullBodyFrames / Math.max(stats.frames, 1);
    const bodyHeight = stats.bodyHeights.length
        ? stats.bodyHeights.reduce((a, b) => a + b, 0) / stats.bodyHeights.length
        : 0;
    const brightness = stats.brightness.length
        ? stats.brightness.reduce((a, b) => a + b, 0) / stats.brightness.length
        : 0;
    // 발목 위치(골반 기준, 미터)의 흔들림을 발목·축별로 구해 평균(cm)
    const ankleStds = Object.values(stats.ankles).flatMap(axes => axes.map(stdDev));
    const jitterCm = 100 * ankleStds.reduce((a, b) => a + b, 0) / ankleStds.length;
    const fps = stats.frames / MEASURE_SECONDS;

    const metrics = [
        {
            key: "fullBody",
            label: "전신 인식률",
            value: `${Math.round(fullBodyRate * 100)}%`,
            score: linearScore(fullBodyRate, 0.4, 0.95),
            weight: 3,
            tip: "머리부터 발끝까지 화면에 다 들어오게 카메라를 낮추거나 뒤로 물러나세요. 발이 잘리면 다리 트래킹이 불가능합니다."
        },
        {
            key: "distance",
            label: "카메라 거리",
            value: bodyHeight ? `화면 높이의 ${Math.round(bodyHeight * 100)}%` : "-",
            score: rangeScore(bodyHeight, 0.55, 0.85, 0.3),
            weight: 2,
            tip: bodyHeight > 0.85
                ? "카메라와 너무 가깝습니다. 한두 걸음 뒤로 물러나 2~3m 거리를 확보하세요."
                : "카메라와 너무 멉니다. 몸이 화면 높이의 55~85%를 차지하도록 다가서세요."
        },
        {
            key: "lighting",
            label: "조명 밝기",
            value: `${Math.round(brightness)} / 255`,
            score: rangeScore(brightness, 90, 190, 60),
            weight: 2,
            tip: brightness > 190
                ? "화면이 너무 밝습니다. 등 뒤의 창문·조명을 피해 역광을 없애세요."
                : "방이 어둡습니다. 정면(카메라 쪽)에서 몸을 비추는 조명을 켜세요."
        },
        {
            key: "jitter",
            label: "떨림 (가만히 서 있을 때)",
            value: `${jitterCm.toFixed(1)} cm`,
            score: linearScore(jitterCm, 6, 1.5),
            weight: 2,
            tip: "단색 벽 같은 단순한 배경, 몸에 붙는 옷, 밝은 조명이 떨림을 줄입니다. 측정 중엔 가만히 서 있어 주세요."
        },
        {
            key: "fps",
            label: "인식 속도",
            value: `${fps.toFixed(0)} fps`,
            score: linearScore(fps, 10, 25),
            weight: 1,
            tip: "PC 성능이 부족합니다. 다른 프로그램을 닫거나, 트래킹 프로그램을 VR과 다른 PC/휴대폰에서 돌리는 방법을 고려하세요."
        }
    ];

    const totalWeight = metrics.reduce((a, m) => a + m.weight, 0);
    const total = Math.round(metrics.reduce((a, m) => a + m.score * m.weight, 0) / totalWeight);
    return { metrics, total };
}

// 헤드셋 종류 + 점수 → 추천 프로그램
function recommend(headset, total) {
    const recs = [];
    const webcamOk = total >= 60;

    if (headset === "quest3") {
        recs.push("<strong>1순위: Virtual Desktop 바디 트래킹</strong> — Quest 3/3S는 헤드셋 카메라로 상체를 추적하고 다리는 AI로 추정해 VRChat용 가상 트래커를 만들어 줍니다. 웹캠 설치가 필요 없습니다.");
    } else if (headset === "quest2") {
        recs.push("<strong>Virtual Desktop 바디 트래킹</strong>도 Quest 2/Pro를 지원하지만 다리는 AI 추정이라 실제 움직임과 다를 수 있습니다. 실제 다리를 움직이려면 웹캠 방식이 낫습니다.");
    }

    if (webcamOk) {
        recs.push("<strong>무료로 먼저: Blobfish FBT</strong> — 설치·계정 없이 브라우저에서 바로 쓰는 무료 웹캠 FBT입니다.");
        if (headset === "pcvr") {
            recs.push("<strong>SteamVR 무료 대안: MediaPipe-VR-Fullbody-Tracking</strong> — 오픈소스, 설정이 조금 번거롭습니다.");
        }
        recs.push("<strong>안정성이 필요하면: Driver4VR</strong> — 약 $17 일회 구매. PC VR과 퀘스트 단독 실행(OSC)을 모두 지원하고 휴대폰 카메라도 쓸 수 있습니다. 무료 체험(골반만)으로 먼저 확인하세요.");
    } else {
        recs.push("<strong>웹캠 방식은 지금 환경에서 비추천</strong> — 아래 개선 팁을 적용한 뒤 다시 측정해 보세요.");
    }

    if (!webcamOk || headset === "pcvr") {
        recs.push("<strong>정확도가 중요하면: SlimeVR</strong> — 카메라 없이 몸에 차는 IMU 트래커. 약 $219(하체 세트)부터. 가림·조명 문제가 없습니다.");
    }
    return recs;
}

(function() {
    const startBtn = document.getElementById("fbt-start-btn");
    if (!startBtn) return;

    const video = document.getElementById("fbt-video");
    const canvas = document.getElementById("fbt-canvas");
    const ctx = canvas.getContext("2d");
    const statusEl = document.getElementById("fbt-status");
    const progressBar = document.getElementById("fbt-progress-bar");
    const resultEl = document.getElementById("fbt-result");
    const headsetSelect = document.getElementById("fbt-headset");

    // 밝기 측정용 작은 캔버스
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 64;
    sampleCanvas.height = 48;
    const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

    let poseLandmarker = null;
    let running = false;
    let lastVideoTime = -1;
    let startTime = 0;
    let measureStart = null;
    let stats = null;

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function setProgress(ratio) {
        progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    }

    function newStats() {
        return {
            frames: 0,
            fullBodyFrames: 0,
            bodyHeights: [],
            brightness: [],
            ankles: { [L_ANKLE]: [[], [], []], [R_ANKLE]: [[], [], []] }
        };
    }

    function measureBrightness() {
        sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
        const { data } = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        return sum / (data.length / 4);
    }

    async function start() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus("이 브라우저에서는 웹캠을 쓸 수 없습니다. HTTPS 주소로 접속했는지 확인하세요.");
            return;
        }
        startBtn.disabled = true;
        resultEl.hidden = true;
        setProgress(0);
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
            stats = newStats();
            measureStart = null;
            startTime = performance.now();
            running = true;
            setStatus("카메라에서 2~3m 떨어져 전신이 보이게 서 주세요...");
            requestAnimationFrame(loop);
        } catch (error) {
            console.error("Full body check init failed:", error);
            setStatus("시작 실패: 웹캠 권한 또는 네트워크 연결을 확인하세요.");
            startBtn.disabled = false;
        }
    }

    function stopCamera() {
        running = false;
        const stream = video.srcObject;
        if (stream) stream.getTracks().forEach(track => track.stop());
        video.srcObject = null;
        startBtn.disabled = false;
        startBtn.textContent = "다시 측정";
    }

    function loop() {
        if (!running) return;
        const now = performance.now();

        if (measureStart === null && now - startTime > DETECT_TIMEOUT_SECONDS * 1000) {
            stopCamera();
            setStatus("사람을 찾지 못했습니다. 카메라 앞에 전신이 보이게 서서 다시 측정해 주세요.");
            return;
        }

        if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const result = poseLandmarker.detectForVideo(video, now);
            render(result, now);
        }

        if (measureStart !== null) {
            const elapsed = (now - measureStart) / 1000;
            setProgress(elapsed / MEASURE_SECONDS);
            if (elapsed >= MEASURE_SECONDS) {
                stopCamera();
                showResult();
                return;
            }
            setStatus(`측정 중... ${Math.ceil(MEASURE_SECONDS - elapsed)}초 — 정면을 보고 가만히 서 있어 주세요.`);
        }
        requestAnimationFrame(loop);
    }

    function render(result, now) {
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 거울 모드로 그리기
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const landmarks = result.landmarks && result.landmarks[0];
        const world = result.worldLandmarks && result.worldLandmarks[0];
        if (landmarks) {
            const drawingUtils = new DrawingUtils(ctx);
            drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
                color: "#4dabf7",
                lineWidth: 3
            });
            drawingUtils.drawLandmarks(landmarks, { color: "#ffffff", radius: 2 });
        }
        ctx.restore();

        // 사람이 처음 감지된 순간부터 측정 시작
        if (landmarks && measureStart === null) measureStart = now;
        if (measureStart === null) return;

        stats.frames++;
        if (stats.frames % 10 === 1) stats.brightness.push(measureBrightness());
        if (!landmarks || !world) return;

        const fullBody = BODY_LANDMARKS.every(id => {
            const p = landmarks[id];
            return (p.visibility ?? 1) >= VISIBILITY_THRESHOLD &&
                p.x > EDGE_MARGIN && p.x < 1 - EDGE_MARGIN &&
                p.y > EDGE_MARGIN && p.y < 1 - EDGE_MARGIN;
        });
        if (fullBody) stats.fullBodyFrames++;

        // 머리 꼭대기는 코보다 약 10% 위에 있다고 보고 몸 전체 높이를 근사
        const footY = Math.max(landmarks[L_ANKLE].y, landmarks[R_ANKLE].y);
        stats.bodyHeights.push((footY - landmarks[NOSE].y) * 1.1);

        for (const id of [L_ANKLE, R_ANKLE]) {
            const [xs, ys, zs] = stats.ankles[id];
            xs.push(world[id].x);
            ys.push(world[id].y);
            zs.push(world[id].z);
        }
    }

    function gradeText(total) {
        if (total >= 80) return "웹캠 풀바디 트래킹을 쓰기 좋은 환경입니다 👍";
        if (total >= 60) return "쓸 수는 있지만, 아래 팁으로 환경을 개선하면 훨씬 안정적입니다.";
        return "지금 환경에서는 웹캠 트래킹이 불안정할 가능성이 큽니다.";
    }

    function scoreClass(score) {
        if (score >= 80) return "good";
        if (score >= 60) return "ok";
        return "bad";
    }

    function showResult() {
        const { metrics, total } = evaluate(stats);
        const tips = metrics.filter(m => m.score < 80).map(m => `<li><strong>${m.label}</strong>: ${m.tip}</li>`);
        const recs = recommend(headsetSelect ? headsetSelect.value : "none", total);

        resultEl.innerHTML = `
            <div class="fbt-total fbt-${scoreClass(total)}">
                <span class="fbt-total-score">${total}</span><span>/ 100</span>
            </div>
            <p class="fbt-grade">${gradeText(total)}</p>
            <ul class="fbt-metrics">
                ${metrics.map(m => `
                    <li>
                        <div class="fbt-metric-head"><span>${m.label}</span><span>${m.value} · ${m.score}점</span></div>
                        <div class="fbt-bar"><div class="fbt-bar-fill fbt-${scoreClass(m.score)}" style="width:${m.score}%"></div></div>
                    </li>`).join("")}
            </ul>
            ${tips.length ? `<h4>개선 팁</h4><ul class="fbt-list">${tips.join("")}</ul>` : ""}
            <h4>추천 프로그램</h4>
            <ul class="fbt-list">${recs.map(r => `<li>${r}</li>`).join("")}</ul>
            <p class="fbt-note">* 측정 결과는 환경 점검용 참고치이며, 실제 프로그램의 트래킹 품질을 보장하지 않습니다. 자세한 비교는 블로그의 <a href="#post-webcam-fbt">웹캠 풀바디 트래킹 비교 가이드</a>를 참고하세요.</p>
        `;
        resultEl.hidden = false;
        setProgress(1);
        setStatus("측정 완료!");
    }

    startBtn.addEventListener("click", start);
})();
