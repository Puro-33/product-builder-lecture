#!/usr/bin/env node
// 웹캠 풀바디 트래킹 → VRChat OSC 브리지 (외부 패키지 없이 Node.js만으로 동작)
//
// 브라우저(웹캠 풀바디 트래킹 페이지)가 WebSocket으로 보낸 트래커 데이터를 받아
// VRChat OSC 트래커 주소로 UDP 전송합니다.
//   /tracking/trackers/1~8/position, /rotation   (미터, 도 단위 Unity 좌표)
//   /tracking/trackers/head/position, /rotation  (트래킹 공간 정렬용)
//
// 사용법:
//   node osc-bridge.js                       # 같은 PC의 VRChat (PC VR)
//   node osc-bridge.js --ip 192.168.0.23     # 같은 와이파이의 Quest 단독 실행
//   옵션: --port 9000 (VRChat OSC 수신 포트), --ws-port 8765 (브라우저 연결 포트)

const http = require("http");
const crypto = require("crypto");
const dgram = require("dgram");

function parseArgs(argv) {
    const options = { ip: "127.0.0.1", port: 9000, wsPort: 8765 };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === "--ip") { options.ip = value; i++; }
        else if (key === "--port") { options.port = Number(value); i++; }
        else if (key === "--ws-port") { options.wsPort = Number(value); i++; }
        else if (key === "--help" || key === "-h") {
            console.log("사용법: node osc-bridge.js [--ip VRChat기기IP] [--port 9000] [--ws-port 8765]");
            process.exit(0);
        }
    }
    return options;
}

const options = parseArgs(process.argv.slice(2));

// --- OSC encoding ---
function oscString(str) {
    const raw = Buffer.from(str + "\0", "utf8");
    const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4);
    raw.copy(padded);
    return padded;
}

function oscMessage(address, floats) {
    const args = Buffer.alloc(floats.length * 4);
    floats.forEach((f, i) => args.writeFloatBE(f, i * 4));
    return Buffer.concat([oscString(address), oscString("," + "f".repeat(floats.length)), args]);
}

function oscBundle(messages) {
    const parts = [oscString("#bundle"), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])]; // timetag: immediately
    for (const msg of messages) {
        const size = Buffer.alloc(4);
        size.writeInt32BE(msg.length);
        parts.push(size, msg);
    }
    return Buffer.concat(parts);
}

// --- WebSocket server (RFC 6455, text frames only) ---
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function decodeFrames(state, chunk, onText) {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    while (state.buffer.length >= 2) {
        const b0 = state.buffer[0];
        const b1 = state.buffer[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let length = b1 & 0x7f;
        let offset = 2;
        if (length === 126) {
            if (state.buffer.length < 4) return;
            length = state.buffer.readUInt16BE(2);
            offset = 4;
        } else if (length === 127) {
            if (state.buffer.length < 10) return;
            length = Number(state.buffer.readBigUInt64BE(2));
            offset = 10;
        }
        const maskOffset = offset;
        if (masked) offset += 4;
        if (state.buffer.length < offset + length) return;

        const payload = Buffer.from(state.buffer.subarray(offset, offset + length));
        if (masked) {
            const mask = state.buffer.subarray(maskOffset, maskOffset + 4);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }
        state.buffer = state.buffer.subarray(offset + length);

        if (opcode === 0x8) return "close";
        if (opcode === 0x1) onText(payload.toString("utf8"));
        // ping/pong/binary 프레임은 무시
    }
}

const udp = dgram.createSocket("udp4");
let sentPackets = 0;

function handleMessage(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return;
    }
    if (data.type !== "trackers" || !Array.isArray(data.trackers)) return;

    const messages = [];
    for (const t of data.trackers) {
        if (!t.visible || t.id < 1 || t.id > 8) continue;
        messages.push(oscMessage(`/tracking/trackers/${t.id}/position`, t.position));
        messages.push(oscMessage(`/tracking/trackers/${t.id}/rotation`, t.rotation));
    }
    if (data.head) {
        messages.push(oscMessage("/tracking/trackers/head/position", data.head.position));
        messages.push(oscMessage("/tracking/trackers/head/rotation", data.head.rotation));
    }
    if (!messages.length) return;

    udp.send(oscBundle(messages), options.port, options.ip);
    sentPackets++;
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("웹캠 풀바디 트래킹 VRChat OSC 브리지가 실행 중입니다.\n");
});

server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
        socket.destroy();
        return;
    }
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    console.log("브라우저 연결됨 — 트래커 데이터를 VRChat으로 전송합니다.");

    const state = { buffer: Buffer.alloc(0) };
    socket.on("data", (chunk) => {
        if (decodeFrames(state, chunk, handleMessage) === "close") {
            socket.end(Buffer.from([0x88, 0x00]));
        }
    });
    socket.on("close", () => console.log("브라우저 연결 종료"));
    socket.on("error", () => socket.destroy());
});

server.listen(options.wsPort, "127.0.0.1", () => {
    console.log(`WebSocket 대기 중: ws://localhost:${options.wsPort}`);
    console.log(`VRChat OSC 전송 대상: ${options.ip}:${options.port}`);
    console.log("VRChat에서 액션 메뉴 → Options → OSC → Enabled 를 켜 주세요.");
});

setInterval(() => {
    if (sentPackets) {
        process.stdout.write(`\r전송 중: ${sentPackets} packets/5s   `);
        sentPackets = 0;
    }
}, 5000);
