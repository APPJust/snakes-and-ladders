// 畫面與流程：三種模式
//  local 同一台練習：兩個人輪流在同一個畫面擲骰
//  host  開房方：只有這一邊擲骰子、執行 game.js 當裁判，把狀態廣播給加入方
//  guest 加入方：按「擲骰」只送出請求，骰子停在裁判傳來的點數
"use strict";
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };   // 元素不存在就略過
const SVGNS = "http://www.w3.org/2000/svg";
const YEARS = ["起點", "大一", "大二", "大三", "大四"];

let mode = null;          // "local" | "host" | "guest"
let state = null;         // 目前的遊戲狀態（加入方的是裁判傳來的副本）
let link = null;          // 連線（net.js 的 send / leave）
let session = null;       // Net.host() 或 Net.join() 的回傳值，用來關閉
let names = { host: "玩家 1", guest: "玩家 2" };
let shown = { host: 0, guest: 0 };   // 棋子目前畫在哪一格（動畫進行中會和 state.pos 不同）
let shownRolls = 0;       // 已經播過動畫的擲骰次數
let busy = false;         // 動畫播放中
let toastTimer = 0;

// ---------- 畫面切換 ----------
function show(id) { for (const s of ["home", "lobby", "game"]) if ($(s)) $(s).hidden = s !== id; }
function toast(text) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}
const mine = () => (mode === "local" ? state.turn : mode);
const label = p => (mode === "local" ? names[p] : p === mode ? names[p] + "（你）" : names[p] || "對手");
const where = n => (n === 0 ? "起點" : n + " 格・" + YEARS[Game.yearOf(n)]);

// ---------- 首頁 ----------
on("btnLocal", "click", () => {
  mode = "local"; names = { host: "玩家 1", guest: "玩家 2" };
  startScreen(Game.newGame("host"));
});

function startScreen(s) {
  state = s; shown = { ...s.pos }; shownRolls = s.rolls; busy = false;
  $("event").className = "event"; $("event").textContent = "按「擲骰」開始，剛好走到 100 就畢業。";
  show("game"); drawBoard(); render();
}

// ---------- 擲骰 ----------
function randomDie() {                        // 1–6，用 crypto 並排除取餘數的偏差
  const a = new Uint8Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 252);
  return 1 + (a[0] % 6);
}

on("btnRoll", "click", () => {
  if (!state || busy) return;
  if (mode === "guest") {                     // 只送請求，等裁判回覆
    spinDie(); link.send({ type: "move", action: "roll" });
    clearTimeout(spinGuard); spinGuard = setTimeout(() => stopDie(), 5000);
    return;
  }
  const who = mode === "local" ? state.turn : "host";
  const why = Game.checkRoll(state, who);
  if (why) return toast(why);
  spinDie();
  state = Game.applyRoll(state, randomDie());
  if (mode === "host") broadcast();
  render();
});

// ---------- 骰子動畫 ----------
let spinTimer = 0, spinStart = 0, spinGuard = 0;
function spinDie() {
  if (spinTimer) return;
  const d = $("die"); d.classList.add("spin"); spinStart = Date.now();
  spinTimer = setInterval(() => { d.dataset.v = 1 + Math.floor(Math.random() * 6); }, 80);
}
function stopDie(v) {
  clearInterval(spinTimer); spinTimer = 0; clearTimeout(spinGuard);
  const d = $("die"); d.classList.remove("spin");
  d.dataset.v = v || (state && state.last ? state.last.die : 1);
}
// 至少轉 0.6 秒，再停在裁判給的點數
function settleDie(v, done) {
  if (!spinTimer) spinDie();
  setTimeout(() => { stopDie(v); done(); }, Math.max(0, 600 - (Date.now() - spinStart)));
}

// ---------- 畫面更新 ----------
function render() {
  if (!state) return;
  if (state.rolls < shownRolls) { shown = { ...state.pos }; shownRolls = state.rolls; $("event").className = "event"; $("event").textContent = "新的一局開始了。"; }
  if (state.rolls > shownRolls && state.last) { if (!busy) animate(state.last, state.rolls); }
  else { shown = { ...state.pos }; placeTokens(); }
  renderPanel();
}

function renderPanel() {
  const s = state, me = mode === "local" ? null : mode;
  $("roundNo").textContent = "第 " + s.round + " 局";
  $("scoreTxt").textContent = mode === "local"
    ? s.score.host + " : " + s.score.guest
    : s.score[me] + " : " + s.score[Game.other(me)];
  for (const p of ["host", "guest"]) {
    const P = p === "host" ? "Host" : "Guest";
    $("name" + P).textContent = label(p);
    $("pos" + P).textContent = where(shown[p]);
    $("pl" + P).classList.toggle("turn", !s.winner && s.turn === p);
  }
  let st;
  if (s.winner && !busy) st = label(s.winner) + " 畢業了！";
  else if (busy) st = "移動中…";
  else if (mode === "local") st = "輪到 " + names[s.turn] + " 擲骰";
  else st = s.turn === me ? "輪到你擲骰" : "等待對手擲骰…";
  $("status").textContent = st;

  const btn = $("btnRoll");
  btn.disabled = busy || !!s.winner;
  btn.classList.toggle("wait", mode !== "local" && s.turn !== me);

  const res = $("result");
  res.hidden = !s.winner || busy;
  if (s.winner && !busy) {
    $("resultTxt").textContent = mode === "local" ? names[s.winner] + " 先畢業了！"
      : s.winner === me ? "你先畢業了！" : (names[s.winner] || "對手") + " 先畢業了";
    const waiting = mode !== "local" && s.ready[me];
    $("btnNext").disabled = waiting;
    $("btnNext").textContent = waiting ? "等待對手按再來一局…" : "再來一局";
    if (!waiting && mode !== "local" && s.ready[Game.other(me)]) $("btnNext").textContent += "（對手已準備）";
  }
}

// 播一次擲骰：骰子停下 → 一格一格走 → 爬梯子或滑下蛇
function animate(last, rolls) {
  busy = true; renderPanel();
  const who = last.who, opp = Game.other(who);
  shown[opp] = state.pos[opp]; shown[who] = last.from; placeTokens();
  settleDie(last.die, () => {
    let i = 0;
    (function step() {
      if (i < last.path.length) { shown[who] = last.path[i++]; placeTokens(); renderPanel(); return setTimeout(step, 190); }
      if (last.jump) {
        const tok = document.querySelector(".token." + who);
        setTimeout(() => {
          tok.classList.add("jump"); shown[who] = last.jump.to; placeTokens();
          setTimeout(() => { tok.classList.remove("jump"); finish(); }, 760);
        }, 250);
      } else finish();
    })();
  });
  function finish() {
    busy = false; shownRolls = rolls;
    const e = $("event"); e.className = "event" + (last.jump ? " " + last.jump.type : "");
    e.textContent = describe(last);
    render();                                            // 動畫期間又有新的擲骰的話，render 會接著播
  }
}

function describe(l) {
  let t = label(l.who) + " 擲出 " + l.die + "：";
  t += l.bounced ? "走到 100 還有剩，倒退回 " + l.landing : (l.from === 0 ? "從起點" : "從 " + l.from + " ") + "走到 " + l.landing;
  if (l.jump && l.jump.type === "ladder") t += "，" + l.jump.label + "！爬梯子到 " + l.jump.to;
  if (l.jump && l.jump.type === "snake") t += "，" + l.jump.label + "…滑到 " + l.jump.to;
  t += "。";
  if (l.to === Game.GOAL) t += "剛好走到 100，畢業了！";
  else if (l.extra) t += "擲出 6 點，再擲一次！";
  return t;
}

// ---------- 再來一局、離開 ----------
on("btnNext", "click", () => {
  if (mode === "guest") { link.send({ type: "restart" }); $("btnNext").disabled = true; $("btnNext").textContent = "等待對手按再來一局…"; return; }
  if (mode === "local") { state = Game.setReady(Game.setReady(state, "host"), "guest"); render(); return; }
  state = Game.setReady(state, "host"); broadcast(); render();
});
on("btnLeave", "click", goHome);
on("btnHome", "click", goHome);

function goHome() {
  if (session) session.destroy();
  session = null; link = null; mode = null; state = null; busy = false; stopDie(1);
  if ($("offline")) $("offline").hidden = true;
  $("homeMsg").textContent = "";
  history.replaceState(null, "", location.pathname);
  show("home");
}

// ---------- 棋盤 ----------
// 第 n 格的中心點：第 1 列在最下面，左到右；第 2 列右到左（蛇形排列）。0 是格子外的起點。
function center(n) {
  if (n === 0) return [62, 1046];
  const r = Math.floor((n - 1) / 10); let c = (n - 1) % 10; if (r % 2) c = 9 - c;
  return [c * 100 + 50, (9 - r) * 100 + 50];
}

function drawBoard() {
  const svg = $("board"); svg.textContent = "";
  const cells = el("g", {});
  for (let n = 1; n <= 100; n++) {
    const [cx, cy] = center(n), x = cx - 50, y = cy - 50;
    const r = Math.floor((n - 1) / 10), y4 = Game.yearOf(n);
    cells.appendChild(el("rect", { x, y, width: 100, height: 100, class: `cell y${y4}${(r + (x / 100)) % 2 ? " alt" : ""}` }));
    cells.appendChild(txt(n, x + 9, y + 30, "num"));
    if (n % 25 === 1) cells.appendChild(txt(YEARS[y4], x + 91, y + 90, "ytag", "end"));
    if (n === 100) cells.appendChild(txt("畢業", x + 91, y + 90, "goal", "end"));
  }
  svg.appendChild(cells);
  svg.appendChild(el("rect", { x: 4, y: 1010, width: 292, height: 72, rx: 14, class: "start-box" }));
  svg.appendChild(txt("起點：入學", 278, 1056, "start-txt", "end"));
  for (const l of Game.LADDERS) svg.appendChild(ladder(center(l.from), center(l.to)));
  for (const s of Game.SNAKES) svg.appendChild(snake(center(s.from), center(s.to)));
  const toks = el("g", { id: "tokens" });
  for (const p of ["host", "guest"]) toks.appendChild(token(p));
  svg.appendChild(toks);
  placeTokens();

  const ul = $("legendList"); ul.textContent = "";
  for (const l of Game.LADDERS) ul.insertAdjacentHTML("beforeend", `<li class="l">梯子 ${l.from} → ${l.to}：${l.label}</li>`);
  for (const s of Game.SNAKES) ul.insertAdjacentHTML("beforeend", `<li class="s">蛇 ${s.from} → ${s.to}：${s.label}</li>`);
}

function ladder([x1, y1], [x2, y2]) {
  const g = el("g", { "pointer-events": "none" });
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy * 17, ny = ux * 17;
  for (let t = 26; t < L - 14; t += 40) {
    const px = x1 + ux * t, py = y1 + uy * t;
    g.appendChild(el("line", { x1: px - nx, y1: py - ny, x2: px + nx, y2: py + ny, class: "rung" }));
  }
  for (const s of [-1, 1]) g.appendChild(el("line", { x1: x1 + nx * s, y1: y1 + ny * s, x2: x2 + nx * s, y2: y2 + ny * s, class: "rail" }));
  return g;
}

function snake([hx, hy], [tx, ty]) {
  const g = el("g", { "pointer-events": "none" });
  const L = Math.hypot(tx - hx, ty - hy), ux = (tx - hx) / L, uy = (ty - hy) / L;
  const waves = Math.max(1.5, L / 230);
  let d = "";
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, w = Math.sin(t * Math.PI * 2 * waves) * 26 * (1 - 0.45 * t);
    d += (i ? "L" : "M") + (hx + (tx - hx) * t - uy * w).toFixed(1) + " " + (hy + (ty - hy) * t + ux * w).toFixed(1);
  }
  g.appendChild(el("path", { d, class: "snake-body" }));
  g.appendChild(el("path", { d, class: "snake-stripe" }));
  const ang = Math.atan2(uy, ux) * 180 / Math.PI + 180;   // 頭朝向尾巴的反方向
  const head = el("g", { transform: `translate(${hx} ${hy}) rotate(${ang})` });
  head.appendChild(el("ellipse", { cx: 0, cy: 0, rx: 25, ry: 19, fill: "var(--snake)" }));
  for (const s of [-1, 1]) {
    head.appendChild(el("circle", { cx: 6, cy: 8 * s, r: 6, fill: "#fff" }));
    head.appendChild(el("circle", { cx: 8, cy: 8 * s, r: 3, fill: "#1d2540" }));
  }
  head.appendChild(el("path", { d: "M24 0 L36 0 M36 0 L41 -4 M36 0 L41 4", stroke: "#c2353b", "stroke-width": 3, fill: "none", "stroke-linecap": "round" }));
  g.appendChild(head);
  return g;
}

// 棋子：彩色圓形加一頂學士帽
function token(p) {
  const g = el("g", { class: "token " + p });
  g.appendChild(el("circle", { cx: 0, cy: 6, r: 24, class: "body" }));
  g.appendChild(el("polygon", { points: "-24,-14 0,-25 24,-14 0,-3", fill: "#1d2540" }));
  g.appendChild(el("rect", { x: -11, y: -12, width: 22, height: 10, fill: "#1d2540" }));
  g.appendChild(el("path", { d: "M0 -14 L17 -10 L17 4", stroke: "var(--gold)", "stroke-width": 3, fill: "none" }));
  return g;
}
function placeTokens() {
  for (const p of ["host", "guest"]) {
    const t = document.querySelector(".token." + p); if (!t) continue;
    const [x, y] = center(shown[p]), dx = p === "host" ? -17 : 17;
    t.style.transform = `translate(${x + dx}px, ${y}px)`;
  }
}

function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function txt(s, x, y, cls, anchor) {
  const t = el("text", { x, y, class: cls }); if (anchor) t.setAttribute("text-anchor", anchor);
  t.textContent = s; return t;
}

// ---------- 連線（net.js 存在時才啟用） ----------
function broadcast() { if (link) link.send({ type: "state", state }); }

if (window.Net) {
  try { $("nick").value = localStorage.getItem("slNick") || ""; } catch (e) {}
  on("nick", "change", () => { try { localStorage.setItem("slNick", $("nick").value.trim()); } catch (e) {} });
  on("code", "input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  const nick = () => ($("nick").value.trim() || "玩家").slice(0, 12);

  on("btnHost", "click", () => {
    mode = "host"; names = { host: nick(), guest: "" };
    show("lobby"); $("roomCode").textContent = "····"; $("lobbyMsg").className = "msg ok";
    $("lobbyMsg").textContent = "正在向 PeerJS 伺服器登記房間…";
    session = Net.host({
      onRoom(code) { $("roomCode").textContent = code; $("lobbyMsg").textContent = "房間開好了，等待對手加入…"; },
      onGuest(l) { link = l; },                       // 等加入方的 hello 再開始
      onMessage: hostReceive,
      onOffline: wentOffline,
      onError(text) { $("lobbyMsg").className = "msg"; $("lobbyMsg").textContent = text; }
    });
  });
  on("btnCopy", "click", async () => {
    const code = $("roomCode").textContent;
    if (!Net.validCode(code)) return;
    const url = location.origin + location.pathname + "?room=" + code;
    try { await navigator.clipboard.writeText(url); $("lobbyMsg").textContent = "已複製邀請連結：" + url; }
    catch (e) { $("lobbyMsg").textContent = "請手動複製：" + url; }
  });
  on("btnCancel", "click", goHome);
  on("btnJoin", "click", () => joinRoom($("code").value));
  on("code", "keydown", e => { if (e.key === "Enter") joinRoom($("code").value); });

  // 打開邀請連結（?room=代碼）時直接加入
  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) { $("code").value = roomParam.toUpperCase(); joinRoom(roomParam); }

  // 關掉分頁或重新整理時先說再見，對手馬上就知道；沒送出去的話還有心跳逾時
  window.addEventListener("pagehide", () => { if (link) link.send({ type: "bye" }); });
}

function joinRoom(code) {
  code = String(code || "").toUpperCase();
  if (!Net.validCode(code)) { $("homeMsg").className = "msg"; $("homeMsg").textContent = "房間代碼是 4 個大寫英文或數字（沒有 0、O、1、I）。"; return; }
  mode = "guest"; names = { host: "", guest: ($("nick").value.trim() || "玩家").slice(0, 12) };
  $("homeMsg").className = "msg ok"; $("homeMsg").textContent = "正在連線到房間 " + code + "…";
  session = Net.join(code, {
    onConnected(l) { link = l; link.send({ type: "hello", name: names.guest }); },
    onMessage: guestReceive,
    onOffline: wentOffline,
    onError(text) {
      $("homeMsg").className = "msg"; $("homeMsg").textContent = text;
      if (!state) { mode = null; if (session) session.destroy(); session = null; }   // 還沒進遊戲才回到首頁狀態
      else toast(text);
    }
  });
}

// 開房方（裁判）：只有這裡會擲骰子、執行 game.js
function hostReceive(msg) {
  switch (msg.type) {
    case "hello":
      names.guest = String(msg.name || "對手").slice(0, 12);
      link.send({ type: "hello", name: names.host });
      startScreen(Game.newGame("host"));
      broadcast();
      break;
    case "move": {
      if (msg.action !== "roll") return link.send({ type: "reject", reason: "看不懂這個動作" });
      const why = Game.checkRoll(state, "guest");
      if (why) return link.send({ type: "reject", reason: why });
      state = Game.applyRoll(state, randomDie());
      broadcast(); render();
      break;
    }
    case "restart":
      state = Game.setReady(state, "guest"); broadcast(); render();
      break;
  }
}

// 加入方：只畫裁判傳來的狀態
function guestReceive(msg) {
  switch (msg.type) {
    case "hello": names.host = String(msg.name || "對手").slice(0, 12); if (state) renderPanel(); break;
    case "state":
      if (!state) { startScreen(msg.state); break; }
      state = msg.state;
      if (state.rolls <= shownRolls && spinTimer) stopDie();
      render();
      break;
    case "reject":
      if (!state) { $("homeMsg").className = "msg"; $("homeMsg").textContent = msg.reason; break; }
      stopDie(); toast(msg.reason);
      break;
  }
}

function wentOffline(why) {
  if (mode !== "host" && mode !== "guest") return;
  $("offlineWhy").textContent = why === "bye" ? "對手離開了房間。" : why === "timeout" ? "超過 6 秒沒有收到對手的心跳，可能是網路中斷。" : "對方關掉了網頁，或網路中斷。";
  $("offline").hidden = false;
}
