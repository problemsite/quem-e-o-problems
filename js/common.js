import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, remove, push,
  runTransaction, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, ROOT_PATH } from "./firebase-config.js";

/* ---------- Firebase ---------- */
export const configOk = Boolean(
  firebaseConfig && firebaseConfig.apiKey && firebaseConfig.databaseURL &&
  !/COLE_AQUI|SEU-PROJETO/.test(firebaseConfig.apiKey + firebaseConfig.databaseURL)
);
export const db = configOk ? getDatabase(initializeApp(firebaseConfig)) : null;
const ROOT = ROOT_PATH || "quem-e-o-problems";
export const dbRef = (p = "") => ref(db, p ? `${ROOT}/${p}` : ROOT);
export { ref, onValue, set, update, remove, push, runTransaction, onDisconnect, serverTimestamp };

/* ---------- Utilidades ---------- */
export const PHASE_LABEL = {
  lobby: "Lobby", answering: "Respondendo", voting: "Votação",
  reveal: "Revelação", final: "Resultado final"
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const rk = (n) => "r" + n;
export const letter = (i) => String.fromCharCode(65 + i);
export const joinNames = (names) => {
  try { return new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(names); }
  catch { return names.join(", "); }
};

/* ---------- Leitura do estado ---------- */
export function getState(g) {
  const s = g?.state || {};
  return {
    phase: s.phase || "lobby",
    round: Number(s.round) || 0,
    session: Number(s.session) || 0,
    rounds: s.rounds || {}
  };
}
export const sessPath = (st) => `s/g${st.session}`;
export function sess(g) { return g?.s?.["g" + getState(g).session] || {}; }

export function validPlayers(g) {
  const out = {};
  for (const [id, p] of Object.entries(g?.players || {})) {
    if (p && typeof p.name === "string" && p.name.trim()) out[id] = p;
  }
  return out;
}
export const byJoin = (players) => Object.keys(players)
  .sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0));

export function toList(x) {
  if (Array.isArray(x)) return x.map((v) => (v == null ? "" : String(v)));
  if (x && typeof x === "object") return Object.keys(x).sort((a, b) => a - b).map((k) => String(x[k] ?? ""));
  if (x == null) return [];
  return [String(x)];
}
export const isSubmitted = (x) => toList(x).some((v) => v.trim());
// Lista de valores de um nó do banco (array ou objeto com chaves 0,1,2…)
export function vals(x) {
  if (Array.isArray(x)) return x.filter((v) => v != null);
  if (x && typeof x === "object") return Object.keys(x).sort((a, b) => a - b).map((k) => x[k]).filter((v) => v != null);
  return [];
}
export const Q_TYPES = ["text", "choice", "photo"];
export function normQ(q) {
  if (typeof q === "string") return { text: q, type: "text", options: [], qid: null };
  return {
    text: String(q?.text || ""),
    type: Q_TYPES.includes(q?.type) ? q.type : "text",
    options: toList(q?.options).map((o) => o.trim()).filter(Boolean),
    qid: q?.qid || null
  };
}
export const roundQuestions = (R) => vals(R?.questions).map(normQ);
export const isImage = (x) => typeof x === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(x);
// A foto da pergunta fica no formulário (fora do estado da partida, para não pesar)
export function questionImage(g, R, i) {
  const q = roundQuestions(R)[i];
  const img = q?.qid ? g?.forms?.[R.fid]?.questions?.[q.qid]?.image : "";
  return isImage(img) ? img : "";
}
export const roundTitle = (R, n) => (R?.title && String(R.title).trim()) || `Rodada ${n + 1}`;

export function sortedForms(g) {
  return Object.entries(g?.forms || {})
    .filter(([, f]) => f && typeof f === "object")
    .map(([id, f]) => ({
      id, title: String(f.title || "").trim(), order: Number(f.order) || 0,
      questions: Object.entries(f.questions || {})
        .filter(([, q]) => q && q.text)
        .map(([qid, q]) => ({ id: qid, ...normQ(q), qid, image: isImage(q.image) ? q.image : "", order: Number(q.order) || 0 }))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export const playableForms = (g) => sortedForms(g).filter((f) => f.questions.length);

/* Problems verdadeiro: escolhido manualmente ou, por padrão, quem se chama "Problems" */
export function defaultTrue(players) {
  const match = byJoin(players).filter((id) => players[id].name.trim().toLowerCase() === "problems");
  return match[0] || null;
}
export function effectiveTrue(g) {
  const players = validPlayers(g);
  const ov = g?.config?.trueOverride;
  if (ov && players[ov]) return ov;
  return defaultTrue(players);
}
export function currentTrue(g) {
  const st = getState(g);
  if (st.phase === "lobby") return effectiveTrue(g);
  return st.rounds[rk(st.round)]?.trueId || null;
}

/* ---------- Formulários / rodadas ---------- */
export function usedFormIds(g) {
  return new Set(Object.values(getState(g).rounds).map((r) => r?.fid).filter(Boolean));
}
export function nextForm(g) {
  const used = usedFormIds(g);
  return playableForms(g).find((f) => !used.has(f.id)) || null;
}
export function roundInfo(g) {
  const st = getState(g);
  const used = usedFormIds(g);
  const remaining = playableForms(g).filter((f) => !used.has(f.id)).length;
  const played = Object.keys(st.rounds).length;
  return { total: played + remaining, remaining, isLast: remaining === 0 };
}

/* Ordem embaralhada das respostas de uma rodada.
   A semente sai do conteúdo das respostas: é igual para todo mundo e não tem relação
   com quem enviou primeiro ou por último. */
const orderCache = new Map();
export function answerOrder(g, n) {
  const st = getState(g);
  const ans = sess(g).answers?.[rk(n)] || {};
  const ids = Object.keys(ans).filter((id) => isSubmitted(ans[id])).sort();
  const sig = ids.map((id) => toList(ans[id]).map((v) => v.slice(0, 120)).join("|")).join("#");
  const cacheKey = `${st.session}/${n}/${sig.length}/${hash(sig)}`;
  if (orderCache.has(cacheKey)) return orderCache.get(cacheKey).slice();
  const seed = `${st.session}-${n}-${hash(sig)}-`;
  const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
  const key = (id) => mix(hash(seed + id + seed) ^ hash(id + sig.length));
  const order = ids.sort((a, b) => key(a) - key(b) || a.localeCompare(b));
  orderCache.set(cacheKey, order);
  return order.slice();
}

/* ---------- Pontuação ---------- */
export function revealedRounds(g) {
  const st = getState(g);
  return Object.keys(st.rounds).map((k) => Number(k.slice(1)))
    .filter((n) => n < st.round || (n === st.round && (st.phase === "reveal" || st.phase === "final")))
    .sort((a, b) => a - b);
}
// Acertou o verdadeiro: +1. Votou num impostor: -1 para quem votou e +1 para o impostor.
export function roundPoints(g, n) {
  const st = getState(g);
  const trueId = st.rounds[rk(n)]?.trueId;
  const votes = sess(g).votes?.[rk(n)] || {};
  const pts = {};
  const add = (id, v) => { pts[id] = (pts[id] || 0) + v; };
  for (const [voter, target] of Object.entries(votes)) {
    if (!target || voter === trueId || target === voter) continue;
    if (target === trueId) add(voter, 1);
    else { add(voter, -1); add(target, 1); }
  }
  return pts;
}
export function totalScores(g) {
  const tot = {};
  for (const n of revealedRounds(g)) {
    for (const [id, p] of Object.entries(roundPoints(g, n))) tot[id] = (tot[id] || 0) + p;
  }
  return tot;
}
/* Classificação com desempate:
   1) mais pontos;
   2) quem chegou primeiro a essa pontuação (pela ordem das rodadas e dos votos confirmados);
   3) quem acertou o Problems verdadeiro mais vezes.
   Se ainda assim empatar, as pessoas dividem a posição. */
export function standings(g) {
  const st = getState(g), S = sess(g), players = validPlayers(g), rev = revealedRounds(g);
  const events = [];
  for (const n of rev) {
    const trueId = st.rounds[rk(n)]?.trueId, votes = S.votes?.[rk(n)] || {}, at = S.voteAt?.[rk(n)] || {};
    for (const [voter, target] of Object.entries(votes)) {
      if (!target || voter === trueId || target === voter) continue;
      events.push({ n, t: Number(at[voter]) || 0, voter, target, right: target === trueId });
    }
  }
  events.sort((a, b) => a.n - b.n || a.t - b.t || a.voter.localeCompare(b.voter));
  const final = {}, right = {};
  for (const e of events) {
    if (e.right) { final[e.voter] = (final[e.voter] || 0) + 1; right[e.voter] = (right[e.voter] || 0) + 1; }
    else { final[e.voter] = (final[e.voter] || 0) - 1; final[e.target] = (final[e.target] || 0) + 1; }
  }
  const reach = {}, reachRound = {}, cum = {};
  for (const id of Object.keys(players)) if (!(final[id] || 0)) { reach[id] = -1; reachRound[id] = null; }
  events.forEach((e, i) => {
    const touch = (id, v) => {
      cum[id] = (cum[id] || 0) + v;
      if (reach[id] === undefined && cum[id] === (final[id] || 0)) { reach[id] = i; reachRound[id] = e.n; }
    };
    if (e.right) touch(e.voter, 1); else { touch(e.voter, -1); touch(e.target, 1); }
  });
  const last = st.phase === "reveal" ? roundPoints(g, st.round) : {};
  const list = Object.entries(players)
    .filter(([id]) => !(rev.length && rev.every((n) => st.rounds[rk(n)]?.trueId === id)))
    .map(([id, p]) => ({ id, p, pts: final[id] || 0, delta: last[id] || 0, right: right[id] || 0,
      reach: reach[id] ?? 1e9, reachRound: reachRound[id] ?? null }))
    .sort((a, b) => b.pts - a.pts || a.reach - b.reach || b.right - a.right || a.p.name.localeCompare(b.p.name));
  let place = 0, prevKey = null;
  for (const r of list) {
    const key = `${r.pts}|${r.reach}|${r.right}`;
    if (key !== prevKey) { place++; prevKey = key; }
    r.place = place;
  }
  // Explicação curta de cada empate de pontos
  const ties = [];
  const groups = {};
  for (const r of list) (groups[r.pts] ||= []).push(r);
  for (const grp of Object.values(groups).sort((a, b) => b[0].pts - a[0].pts)) {
    if (grp.length < 2) continue;
    const lines = [];
    for (let i = 0; i < grp.length - 1; i++) {
      const a = grp[i], b = grp[i + 1];
      if (a.reach !== b.reach) {
        lines.push(`${a.p.name} ficou na frente de ${b.p.name} porque chegou ${a.pts === 0 && a.reach === -1 ? "a esse total desde o começo" : `a ${ptsText(a.pts)} primeiro`}${a.reachRound != null ? ` (rodada ${a.reachRound + 1})` : ""}.`);
      } else if (a.right !== b.right) {
        lines.push(`${a.p.name} e ${b.p.name} chegaram juntos; ${a.p.name} ficou na frente por acertar mais vezes (${a.right} × ${b.right}).`);
      } else {
        lines.push(`${a.p.name} e ${b.p.name} continuaram empatados e dividem o ${a.place}º lugar.`);
      }
    }
    ties.push({ pts: grp[0].pts, names: grp.map((r) => r.p.name), lines });
  }
  return { list, ties };
}
const ptsText = (n) => `${n} ponto${Math.abs(n) === 1 ? "" : "s"}`;
export function ranking(g) { return standings(g).list; }
export function boardHTML(list, meId) {
  if (!list.length) return `<li class="empty">Ninguém no placar ainda.</li>`;
  return list.map((r) => `<li class="${r.place === 1 && r.pts > 0 ? "lead" : ""} ${r.id === meId ? "is-me" : ""}">
      <span class="pos">${r.place}º</span>${avatar(r.p, r.id, "av-sm")}
      <span class="p-name">${esc(r.p.name)}${r.id === meId ? " <small>(você)</small>" : ""}</span>
      <span class="pts">${r.pts} pt${Math.abs(r.pts) === 1 ? "" : "s"}${r.delta ? `<span class="delta ${r.delta < 0 ? "neg" : ""}">${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}</span>` : ""}</span>
    </li>`).join("");
}

/* ---------- Progresso: todo mundo concordou? ---------- */
export function readyKey(st) { return `${st.phase}_${st.round}`; }
// Depois disso, quem ainda estiver no resultado é mandado de volta ao lobby (reserva, caso algum aparelho trave)
export const REVEAL_LIMIT_MS = 75000;

export function progress(g) {
  const st = getState(g), players = validPlayers(g), S = sess(g);
  const online = byJoin(players).filter((id) => players[id].online);
  const trueId = currentTrue(g);
  let need = [], done = [], blocker = null;

  if (st.phase === "lobby") {
    const rd = S.ready?.[readyKey(st)] || {};
    need = online; done = need.filter((id) => rd[id]);
    if (!playableForms(g).length) blocker = "Aguardando as perguntas da partida.";
    else if (!nextForm(g)) blocker = "Aguardando as perguntas da próxima rodada.";
    else if (!trueId) blocker = "Aguardando o Problems verdadeiro entrar.";
    else if (!players[trueId]?.online) blocker = "O Problems verdadeiro está offline.";
    else if (online.length < 3) blocker = "São necessários pelo menos 3 jogadores online.";
  } else if (st.phase === "answering") {
    const ans = S.answers?.[rk(st.round)] || {};
    need = [...new Set([...(trueId ? [trueId] : []), ...online])].filter((id) => players[id]);
    done = need.filter((id) => isSubmitted(ans[id]));
  } else if (st.phase === "voting") {
    const votes = S.votes?.[rk(st.round)] || {};
    need = online.filter((id) => id !== trueId);
    done = need.filter((id) => votes[id]);
  } else {
    const rd = S.ready?.[readyKey(st)] || {};
    need = online; done = need.filter((id) => rd[id]);
  }
  const late = st.phase === "reveal" && Number(g?.state?.revealAt) > 0 && Date.now() > Number(g.state.revealAt) + REVEAL_LIMIT_MS;
  return { need, done, blocker, canAdvance: !blocker && need.length > 0 && (done.length === need.length || late) };
}

/* ---------- Transições ---------- */
export function resetPlan(g) {
  const st = getState(g);
  return { state: { phase: "lobby", round: 0, session: st.session + 1 }, cleanup: sessPath(st) };
}
export function planNext(g) {
  const st = getState(g);
  const base = { phase: st.phase, round: st.round, session: st.session, rounds: st.rounds };
  const startRound = (n, rounds) => {
    const f = nextForm(g);
    const t = effectiveTrue(g) || rounds[rk(n - 1)]?.trueId;
    if (!f || !t) return null;
    return { state: { ...base, phase: "answering", round: n,
      rounds: { ...rounds, [rk(n)]: { fid: f.id, title: f.title, trueId: t,
        questions: f.questions.map((q) => ({ qid: q.id, text: q.text, type: q.type, options: q.options })) } } } };
  };
  switch (st.phase) {
    case "lobby": return startRound(st.round, st.rounds);
    case "answering": return { state: { ...base, phase: "voting" } };
    case "voting": return { state: { ...base, phase: "reveal", revealAt: Date.now() } };
    // Fim da rodada: volta todo mundo ao lobby mantendo os pontos
    case "reveal": return nextForm(g) ? { state: { ...base, phase: "lobby", round: st.round + 1 } } : { state: { ...base, phase: "final" } };
    case "final": return resetPlan(g);
  }
  return null;
}
async function commit(g, plan, sameStep) {
  const st = getState(g);
  const res = await runTransaction(dbRef("state"), (cur) => {
    const c = getState({ state: cur });
    if (c.session !== st.session) return;
    if (sameStep && (c.phase !== st.phase || c.round !== st.round)) return;
    return plan.state;
  });
  if (res.committed && plan.cleanup) await remove(dbRef(plan.cleanup));
  return res.committed;
}
export async function tryAdvance(g, { force = false } = {}) {
  if (!force && !progress(g).canAdvance) return false;
  const plan = planNext(g);
  if (!plan) return false;
  return commit(g, plan, true);
}
export async function resetGame(g) { return commit(g, resetPlan(g), false); }

/* ---------- Avatares ---------- */
const TINTS = ["#FFE066", "#FF9EB5", "#A6EDA0", "#C3B5FF", "#FFBE7A", "#9FDBFF"];
export function avatarSrc(p, id) {
  if (typeof p?.photo === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(p.photo)) return p.photo;
  const tint = TINTS[hash(id || p?.name || "") % TINTS.length];
  const ch = esc(((p?.name || "?").trim()[0] || "?").toUpperCase());
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='${tint}'/><text x='50' y='67' font-family='Trebuchet MS, Arial, sans-serif' font-size='46' font-weight='700' text-anchor='middle' fill='#000'>${ch}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
export const avatar = (p, id, cls = "") =>
  `<span class="av ${cls}"><img src="${esc(avatarSrc(p, id))}" alt=""></span>`;
export const hexBadge = (txt) => `<span class="hexbadge" aria-hidden="true"><span>${esc(txt)}</span></span>`;

// Foto sem cortar, limitada ao maior lado (perguntas e respostas com foto)
export function resizeImageFit(file, max = 640, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}
export function resizeImage(file, size = 160) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, size, size);
      const s = Math.min(img.width, img.height);
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}
