// 連線：PeerJS（WebRTC DataChannel）。只負責開房、加入、收發 JSON 和心跳，不懂遊戲規則。
"use strict";
(function (root) {
  const TOPIC = "25";                                   // 題號，放進 PeerJS ID 避免和別題撞號
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";  // 不用 0、O、1、I
  const PING_MS = 2000, OFFLINE_MS = 6000;

  const peerId = code => `jit1151-${TOPIC}-${code}`;
  function newCode() {
    const a = new Uint32Array(4); crypto.getRandomValues(a);
    return Array.from(a, x => ALPHABET[x % ALPHABET.length]).join("");
  }
  const validCode = code => /^[A-HJ-NP-Z2-9]{4}$/.test(code);

  // 建立一條連線的共用部分：收訊息、心跳、離線偵測
  function wire(conn, h) {
    let lastSeen = Date.now(), offline = false, timer = 0;
    const goOffline = why => {
      if (offline) return; offline = true; clearInterval(timer); h.onOffline && h.onOffline(why);
    };
    conn.on("open", () => {
      lastSeen = Date.now();
      timer = setInterval(() => {
        if (Date.now() - lastSeen > OFFLINE_MS) return goOffline("timeout");
        send({ type: "ping", t: Date.now() });
      }, PING_MS);
      h.onOpen && h.onOpen();
    });
    conn.on("data", raw => {
      lastSeen = Date.now();
      let msg = raw;
      if (typeof raw === "string") { try { msg = JSON.parse(raw); } catch (e) { return; } }
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ping") return send({ type: "pong", t: msg.t });
      if (msg.type === "pong") return;
      console.log("收到", msg);                          // 除錯用：開發人員工具的主控台看得到每一則訊息（心跳不印）
      if (msg.type === "bye") return goOffline("bye");
      h.onMessage(msg);
    });
    conn.on("close", () => goOffline("close"));
    conn.on("error", () => goOffline("error"));
    function send(msg) {
      if (!conn.open || offline) return;
      if (msg.type !== "ping" && msg.type !== "pong") console.log("送出", msg);
      conn.send(JSON.stringify(msg));
    }
    return {
      send,
      leave() { try { send({ type: "bye" }); } catch (e) {} clearInterval(timer); offline = true; setTimeout(() => conn.close(), 100); }
    };
  }

  // 開房：回傳 { code, link } 給畫面；有人加入時呼叫 h.onGuest(link)
  function host(h) {
    let tries = 0, peer = null, link = null;
    (function attempt() {
      const code = newCode();
      peer = new Peer(peerId(code), { debug: 0 });
      peer.on("open", () => h.onRoom(code));
      peer.on("connection", conn => {
        if (link) { conn.on("open", () => { conn.send(JSON.stringify({ type: "reject", reason: "這個房間已經有兩個人了" })); setTimeout(() => conn.close(), 300); }); return; }
        link = wire(conn, {
          onOpen: () => h.onGuest(link),
          onMessage: h.onMessage,
          onOffline: why => { h.onOffline(why); }
        });
      });
      // PeerJS 伺服器只負責配對。已經連上對手之後，和伺服器斷線不影響對戰，不當成錯誤；
      // 還在等對手時斷線，就自動重新登記同一個房間代碼。
      peer.on("disconnected", () => { if (!link && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
      peer.on("error", e => {
        if (e.type === "unavailable-id" && tries++ < 3) { peer.destroy(); return attempt(); }
        if (link && SERVER_ERRORS.includes(e.type)) return;
        h.onError(errorText(e));
      });
    })();
    return { destroy() { if (link) link.leave(); setTimeout(() => peer && peer.destroy(), 200); } };
  }

  // 加入：連上開房方
  function join(code, h) {
    const peer = new Peer({ debug: 0 });
    let link = null, connected = false;
    peer.on("open", () => {
      if (link) return;                                    // 和伺服器重新連上時不要再連一次
      const conn = peer.connect(peerId(code), { reliable: true });
      link = wire(conn, { onOpen: () => { connected = true; h.onConnected(link); }, onMessage: h.onMessage, onOffline: h.onOffline });
    });
    peer.on("error", e => {
      if (connected && SERVER_ERRORS.includes(e.type)) return;   // 已經連上對手：和伺服器斷線不影響對戰
      h.onError(errorText(e));
    });
    return { destroy() { if (link) link.leave(); setTimeout(() => peer.destroy(), 200); } };
  }
  const SERVER_ERRORS = ["network", "server-error", "socket-error", "socket-closed", "disconnected"];

  function errorText(e) {
    switch (e.type) {
      case "peer-unavailable": return "找不到這個房間：代碼可能打錯了，或開房的人已經關掉網頁。";
      case "unavailable-id": return "房間代碼和別人重複了，請重新開房。";
      case "network": case "server-error": case "socket-error": case "socket-closed":
        return "連不上 PeerJS 伺服器，請檢查網路，過幾分鐘再試。";
      case "browser-incompatible": return "這個瀏覽器不支援 WebRTC，請改用 Chrome、Edge 或 Safari。";
      default: return "連線發生錯誤（" + e.type + "），請重新整理再試一次。";
    }
  }

  root.Net = { host, join, newCode, validCode, peerId };
})(this);
