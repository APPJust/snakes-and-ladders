// 規則：蛇梯棋「大學四年」。只處理規則，不碰畫面；骰子點數由呼叫的人傳進來（連線時只有開房方擲）。
"use strict";
(function (root) {
  const GOAL = 100;
  // 梯子＝考到證照：停在底部就爬到頂端
  const LADDERS = [
    { from: 4, to: 25, label: "考到 TQC 證照" },
    { from: 13, to: 46, label: "多益 600 分" },
    { from: 33, to: 49, label: "考到丙級證照" },
    { from: 42, to: 63, label: "專題競賽得獎" },
    { from: 50, to: 69, label: "考到乙級證照" },
    { from: 74, to: 92, label: "考到雲端證照" }
  ];
  // 蛇＝被當：停在蛇頭就滑到蛇尾
  const SNAKES = [
    { from: 27, to: 5, label: "微積分被當" },
    { from: 43, to: 18, label: "程式設計被當" },
    { from: 56, to: 37, label: "資料結構被當" },
    { from: 68, to: 47, label: "英文被當" },
    { from: 87, to: 54, label: "演算法被當" },
    { from: 99, to: 78, label: "畢業專題被當" }
  ];
  const JUMP = {};
  for (const l of LADDERS) JUMP[l.from] = { type: "ladder", ...l };
  for (const s of SNAKES) JUMP[s.from] = { type: "snake", ...s };

  const other = p => (p === "host" ? "guest" : "host");
  const yearOf = n => (n <= 0 ? 0 : Math.ceil(n / 25));     // 1–25 大一 … 76–100 大四

  // 開局：雙方都在格子外的起點（0），first 先擲
  function newGame(first, round, score) {
    first = first || "host";
    return {
      pos: { host: 0, guest: 0 }, turn: first, first,
      round: round || 1, score: score || { host: 0, guest: 0 },
      rolls: 0, last: null, winner: null, ready: { host: false, guest: false }
    };
  }

  // 檢查 who 現在能不能擲骰；不行就回傳中文原因
  function checkRoll(s, who) {
    if (s.winner) return "這一局已經結束了，按「再來一局」";
    if (s.turn !== who) return "還沒輪到你，請等對手擲骰";
    return null;
  }

  // 套用一次擲骰：die 是 1–6。回傳新的狀態，不改原本的。
  function applyRoll(s, die) {
    if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error("骰子點數要是 1 到 6 的整數");
    if (s.winner) throw new Error("這一局已經結束了");
    const who = s.turn, from = s.pos[who], path = [];
    let p = from, dir = 1, bounced = false;
    for (let i = 0; i < die; i++) {               // 一格一格走；走到 100 還有剩就往回退
      if (p === GOAL) { dir = -1; bounced = true; }
      p += dir; path.push(p);
    }
    const jump = JUMP[p] || null, to = jump ? jump.to : p;
    const won = to === GOAL, extra = die === 6 && !won;
    const score = { ...s.score }; if (won) score[who]++;
    return {
      ...s,
      pos: { ...s.pos, [who]: to },
      turn: won || extra ? who : other(who),
      score, rolls: s.rolls + 1,
      winner: won ? who : null,
      ready: { host: false, guest: false },
      last: { who, die, from, path, landing: p, jump, to, bounced, extra }
    };
  }

  // 一局結束後按「再來一局」；雙方都按了才開新局，先手換人
  function setReady(s, who) {
    if (!s.winner) return s;
    const ready = { ...s.ready, [who]: true };
    if (ready.host && ready.guest) return newGame(other(s.first), s.round + 1, s.score);
    return { ...s, ready };
  }

  root.Game = { GOAL, LADDERS, SNAKES, JUMP, other, yearOf, newGame, checkRoll, applyRoll, setReady };
  if (typeof module !== "undefined") module.exports = root.Game;
})(this);
