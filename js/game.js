import {
  configOk, db, dbRef, liveRef, ref, onValue, onChildAdded, runTransaction, set, update, remove, push, onDisconnect, serverTimestamp,
  esc, rk, letter, joinNames, toList, isSubmitted, roundTitle, getState, sess, sessPath,
  validPlayers, byJoin, currentTrue, roundInfo, answerOrder, ranking, boardHTML, totalScores,
  revealedRounds, roundPoints, standings, progress, roundQuestions, questionImage, isImage, resizeImageFit, readyKey, tryAdvance, avatar, avatarSrc, hexBadge, resizeImage
} from "./common.js";

const $ = (s) => document.querySelector(s);
const stage = $("#stage"), topbar = $("#topbar");
const LS = { id: "qp.id", name: "qp.name", photo: "qp.photo" };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let G = null, myId = store.get(LS.id), screenKey = "", editing = false, pendingPhoto = "";
let photoVals = {}, lastPhase = null;
let connected = false, armed = false, advancing = false, pick = null, timers = [], revealDoneFor = "", kickLeft = null, kicked = false;
const KICK_SECONDS = 30;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

if (!configOk) showSetup(); else boot();

function boot() {
  onValue(dbRef(), (snap) => { G = snap.val() || {}; render(); }, (err) => {
    console.error(err);
    stage.innerHTML = `<section class="panel"><h1 class="screen-title">Sem permissão no Firebase</h1>
      <p>O banco recusou a leitura (${esc(err?.code || err?.message || "erro")}). Publique as regras do README na aba Regras do Realtime Database e recarregue.</p></section>`;
  });
  onValue(ref(db, ".info/connected"), (snap) => {
    connected = snap.val() === true;
    if (!connected) armed = false;
    markOnline();
  });
}

const me = () => (myId && G ? validPlayers(G)[myId] || null : null);

function markOnline() {
  if (!connected || !G) return;
  const p = me(); if (!p) return;
  const r = dbRef(`players/${myId}/online`);
  if (!armed) { onDisconnect(r).set(false); armed = true; }
  if (!p.online) set(r, true);
}

/* ---------- Tela cheia (contagens e transições) ---------- */
const overlay = $("#overlay");
function showOverlay(cls, html) {
  overlay.className = `overlay ${cls}`;
  overlay.innerHTML = html;
  overlay.hidden = false;
}
function hideOverlay() { overlay.hidden = true; overlay.className = "overlay"; overlay.innerHTML = ""; }
// Transição "íris" (fecha num círculo com o Problems no meio e abre na tela nova)
const iris = $("#iris");
function hideIris() { iris.hidden = true; iris.className = "iris"; }
function closeOverlay(ms = 500) {
  overlay.classList.add("out");
  const shown = overlay.innerHTML;
  setTimeout(() => { if (overlay.innerHTML === shown) hideOverlay(); }, ms);
}
// Transição rápida quando o último envia o formulário
function playVoteWipe() {
  if (reduceMotion()) return;
  showOverlay("wipe", `<div class="ov-inner">
    <img src="img/problems.svg" class="ov-hex spin" alt="">
    <p class="ov-big">Todo mundo enviou!</p>
    <p class="ov-sub">Hora de votar</p></div>`);
  lockScroll(true, 6000);
  runSeq(() => { hideOverlay(); window.scrollTo({ top: 0 }); unlockScroll(); });
  if (document.hidden) { finishSeq(); return; }
  later(2100, () => { window.scrollTo({ top: 0 }); closeOverlay(600); });
  later(2750, () => { endSeq(); unlockScroll(); });
}
/* Sequência animada em andamento. Se a aba for para o segundo plano (o navegador congela
   os temporizadores), a sequência é concluída na hora para ninguém ficar travado. */
let seqFinish = null;
function runSeq(finish) { seqFinish = finish; }
function endSeq() { seqFinish = null; }
function finishSeq() { const f = seqFinish; seqFinish = null; if (f) f(); }
document.addEventListener("visibilitychange", () => { if (document.hidden) finishSeq(); });

/* Trava a rolagem (e os cliques na tela) durante as animações */
const blockEv = (e) => e.preventDefault();
const blockKeys = (e) => { if ([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key) && !e.target.closest?.("dialog")) e.preventDefault(); };
let locked = false, lockGuard = 0;
function lockScroll(toTop = false, maxMs = 45000) {
  if (toTop) window.scrollTo({ top: 0 });
  clearTimeout(lockGuard);
  lockGuard = setTimeout(() => { finishSeq(); unlockScroll(); }, maxMs); // nunca fica travado para sempre
  if (locked) return;
  locked = true;
  document.documentElement.classList.add("locked");
  window.addEventListener("wheel", blockEv, { passive: false });
  window.addEventListener("touchmove", blockEv, { passive: false });
  window.addEventListener("keydown", blockKeys);
}
function unlockScroll() {
  clearTimeout(lockGuard);
  if (!locked) return;
  locked = false;
  document.documentElement.classList.remove("locked");
  window.removeEventListener("wheel", blockEv);
  window.removeEventListener("touchmove", blockEv);
  window.removeEventListener("keydown", blockKeys);
}
// Texto gigante com as letras entrando uma a uma (palavras não quebram no meio)
function bigText(text) {
  let i = 0;
  return text.split(" ").map((w) => `<span class="ov-word">${[...w].map((c) => `<span style="--i:${i++}">${esc(c)}</span>`).join("")}</span>`).join(" ");
}
// Tela cheia com texto → íris fecha com o Problems no meio → abre na tela nova
function titleThenIris(text, onClosed, onOpen) {
  showOverlay("dark results", `<p class="ov-results ${text.length > 12 ? "long" : ""}" aria-label="${esc(text)}">${bigText(text)}</p>`);
  later(2400, () => { iris.hidden = false; iris.className = "iris close"; });
  later(3050, () => { hideOverlay(); iris.classList.add("pop"); onClosed?.(); });
  later(3900, () => { iris.className = "iris open"; });
  later(4650, () => { hideIris(); onOpen?.(); });
  return 4650;
}
// "Zoom" no card: a tela escurece, o card vai para o centro ocupando a tela e depois volta.
// onPeak roda quando o card já está grande (é aí que a revelação acontece).
const ZOOM = { dark: 380, go: 600, back: 600 };
function zoomCard(el, hold = 1400, onPeak) {
  const back = document.createElement("div");
  back.className = "zoom-back";
  stage.appendChild(back);
  el.scrollIntoView({ block: "center" });
  requestAnimationFrame(() => back.classList.add("on"));
  later(ZOOM.dark, () => {
    const r = el.getBoundingClientRect();
    const topbarH = topbar.offsetHeight || 0, room = innerHeight - topbarH;
    // Tamanho pela largura (texto legível); o card nunca encolhe
    const k = Math.max(1, Math.min(1.6, (innerWidth * 0.92) / r.width));
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, H = r.height * k;
    const dx = innerWidth / 2 - cx;
    // Cabe na tela: centraliza. Comprido: alinha o fim do card (quem escreveu + votos) embaixo da tela
    const dy = H <= room * 0.9 ? topbarH + room / 2 - cy : innerHeight - 20 - H / 2 - cy;
    el.classList.add("zooming");
    el.style.translate = `${dx}px ${dy}px`;
    el.style.scale = String(k);
  });
  later(ZOOM.dark + ZOOM.go, () => onPeak?.());
  later(ZOOM.dark + ZOOM.go + hold, () => {
    el.style.translate = ""; el.style.scale = "";
    back.classList.remove("on");
  });
  later(ZOOM.dark + ZOOM.go + hold + ZOOM.back, () => { el.classList.remove("zooming"); back.remove(); });
  return ZOOM.dark + ZOOM.go + hold + ZOOM.back;
}
// Abertura rápida da revelação: palavras batendo na tela + faixas coloridas passando
const stripes = $("#stripes");
function hideStripes() { stripes.hidden = true; stripes.className = "stripes"; }
function titleThenStripes(text, onCovered, onDone) {
  showOverlay("dark quick", `<p class="ov-slam" aria-label="${esc(text)}">${text.split(" ").map((w, i) => `<span style="--i:${i}">${esc(w)}</span>`).join(" ")}</p>`);
  later(1500, () => { stripes.hidden = false; stripes.className = "stripes in"; });
  later(1950, () => { hideOverlay(); onCovered?.(); stripes.className = "stripes out"; });
  later(2500, () => { hideStripes(); onDone?.(); });
  return 2500;
}

function enterFade() {
  if (reduceMotion()) return;
  stage.classList.remove("entering"); void stage.offsetWidth; stage.classList.add("entering");
  setTimeout(() => stage.classList.remove("entering"), 700);
}

/* ---------- Pop-up de confirmação ---------- */
function confirmBox({ title, text, ok }) {
  const dlg = $("#confirmDlg");
  return new Promise((resolve) => {
    $("#dlgTitle").textContent = title;
    $("#dlgText").textContent = text;
    $("#dlgOk").textContent = ok;
    dlg.returnValue = "";
    const done = () => { dlg.removeEventListener("close", done); resolve(dlg.returnValue === "ok"); };
    dlg.addEventListener("close", done);
    dlg.showModal();
  });
}

/* ---------- Render principal ---------- */
const SCREENS = {
  lobby: [buildLobby, refreshLobby],
  answering: [buildAnswering, refreshCount],
  voting: [buildVoting, refreshVoting],
  reveal: [buildReveal, refreshReveal],
  final: [buildFinal, refreshFinal]
};

function render() {
  if (!G) return;
  markOnline();
  if (!me() || editing) {
    topbar.hidden = true;
    document.body.dataset.screen = "join";
    if (screenKey !== "join") { clearTimers(); screenKey = "join"; buildJoin(); }
    return;
  }
  topbar.hidden = false;
  const st = getState(G), S = sess(G), r = rk(st.round);
  const role = currentTrue(G) === myId ? "true" : "player";
  let step = "";
  if (st.phase === "answering") step = isSubmitted(S.answers?.[r]?.[myId]) ? "sent" : "open";
  if (st.phase === "voting") step = S.votes?.[r]?.[myId] ? "voted" : "open";
  if (st.phase === "voting" || st.phase === "reveal") step += "|" + answerOrder(G, st.round).join(",");
  const backInLobby = false;
  if (backInLobby) step = "inlobby";
  const key = `${st.session}|${st.phase}|${st.round}|${role}|${step}`;
  const prevScreen = document.body.dataset.screen, newScreen = backInLobby ? "lobby" : st.phase;
  document.body.dataset.screen = newScreen;
  const [build, refresh] = backInLobby ? SCREENS.lobby : SCREENS[st.phase] || SCREENS.lobby;
  if (key !== screenKey) {
    endSeq(); clearTimers(); hideOverlay(); hideIris(); hideStripes(); hideBars(); unlockScroll(); stopFloat();
    stage.classList.remove("leaving");
    screenKey = key; build(); window.scrollTo({ top: 0 });
    if (prevScreen === "reveal" && newScreen === "lobby") enterFade();
    if (lastPhase === "answering" && st.phase === "voting") playVoteWipe();
  }
  lastPhase = st.phase;
  if (st.phase !== "lobby" && st.phase !== "reveal") kicked = false;
  refresh();
  refreshTopbar();
  autoAdvance();
}

// Barra do topo ganha borda e sombra quando a página rola
const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 4);
window.addEventListener("scroll", onScroll, { passive: true });

// Reserva: se algum aparelho travar no resultado, o prazo manda todo mundo ao lobby
setInterval(() => { if (G && getState(G).phase === "reveal") autoAdvance(); }, 3000);

function autoAdvance() {
  if (advancing || !progress(G).canAdvance) return;
  advancing = true;
  setTimeout(async () => {
    try { await tryAdvance(G); } catch (e) { console.warn(e); }
    advancing = false;
  }, 700);
}

function refreshTopbar() {
  const st = getState(G), p = me(), info = roundInfo(G);
  let pts = totalScores(G)[myId] || 0;
  // Durante o suspense, o placar do topo ainda não conta a rodada atual
  const onReveal = document.body.dataset.screen === "reveal";
  if (onReveal && revealDoneFor !== `${st.session}.${st.round}`) pts -= roundPoints(G, st.round)[myId] || 0;
  $("#roundTag").textContent =
    st.phase === "lobby" || !onReveal && st.phase === "reveal" ? "Lobby" :
    st.phase === "final" ? "Fim de jogo" : `Rodada ${st.round + 1}/${info.total}`;
  const rev = revealedRounds(G);
  const amTrue = (st.phase !== "lobby" && currentTrue(G) === myId) || (rev.length && rev.every((n) => st.rounds[rk(n)]?.trueId === myId));
  $("#meChip").innerHTML = `${avatar(p, myId, "av-sm")}<span class="me-name">${esc(p.name)}</span>` +
    (amTrue ? `<span class="tag tag-true">verdadeiro</span>` : `<span class="me-pts">${pts} pt${Math.abs(pts) === 1 ? "" : "s"}</span>`);
}

function toggleReady() {
  const st = getState(G), key = readyKey(st);
  const cur = sess(G).ready?.[key]?.[myId];
  set(dbRef(`${sessPath(st)}/ready/${key}/${myId}`), cur ? null : true);
}

/* Só a contagem, nunca quem já enviou */
function refreshCount() {
  const pr = progress(G), st = getState(G);
  const verb = st.phase === "voting" ? "já votaram" : "já enviaram";
  const el = $("#cnt");
  if (el) el.innerHTML = `<strong>${pr.done.length} de ${pr.need.length}</strong> ${verb}`;
  const pips = $("#pips");
  if (pips) pips.innerHTML = pr.need.map((_, i) => `<span class="pip ${i < pr.done.length ? "on" : ""}"></span>`).join("");
}

function waitingHTML(title, text) {
  return `<section class="panel marked waiting">
    <img src="img/problems.svg" class="wait-hex" alt="">
    <h1 class="screen-title">${title}</h1>
    <p class="lede">${text}</p>
    <p class="count-line big" id="cnt" aria-live="polite"></p>
    <div class="pips" id="pips" aria-hidden="true"></div>
  </section>`;
}

function answerHTML(q, a) {
  if (q.type === "photo") return isImage(a) ? `<img class="photo-ans" src="${esc(a)}" alt="Foto enviada" loading="lazy">` : `<span class="qa-a">(sem foto)</span>`;
  if (q.type === "choice") {
    const k = q.options.indexOf(a);
    return `<span class="qa-a choice-ans">${k >= 0 ? `<span class="choice-letter">${letter(k)}</span>` : ""}${esc(a)}</span>`;
  }
  return `<span class="qa-a">${esc(a)}</span>`;
}
function qaHTML(R, answers) {
  const qs = roundQuestions(R), a = toList(answers);
  return `<span class="qa">${qs.map((q, i) => {
    const img = questionImage(G, R, i);
    return `<span class="qa-item">
      <span class="qa-q"><span class="qa-n">${i + 1}</span><span class="qa-qt">${esc(q.text)}</span>${img ? `<img class="qa-img" src="${esc(img)}" alt="">` : ""}</span>
      ${answerHTML(q, a[i] || "")}</span>`;
  }).join("")}</span>`;
}
function cardHead(i, tags = "") {
  return `<span class="card-head">${hexBadge(letter(i))}<span class="card-label">Resposta ${letter(i)}</span><span class="card-tags">${tags}</span></span>`;
}

/* ---------- Configuração faltando ---------- */
function showSetup() {
  document.body.dataset.screen = "join";
  stage.innerHTML = `<section class="join">
    <img src="img/logo.svg" class="logo-lg" alt="Problems">
    <div class="panel join-card">
      <h1 class="screen-title">Falta conectar o Firebase</h1>
      <p>Abra <code>js/firebase-config.js</code>, cole a configuração do seu projeto e publique de novo.</p>
    </div></section>`;
}

/* ---------- Entrar / editar perfil ---------- */
function buildJoin() {
  const p = me();
  const name = p?.name ?? store.get(LS.name) ?? "";
  pendingPhoto = p ? (p.photo || "") : (store.get(LS.photo) || "");
  stage.innerHTML = `<section class="join">
    <img src="img/logo.svg" class="logo-lg" alt="Problems">
    <h1 class="game-title">Quem é o Problems verdadeiro?</h1>
    <form class="panel join-card" id="joinForm" autocomplete="off" novalidate>
      <label class="photo-pick">
        <input type="file" accept="image/*" id="photoIn" class="sr-only">
        <span class="av av-xl"><img id="photoPrev" alt="Sua foto"></span>
        <span class="photo-hint" id="photoHint"></span>
      </label>
      <label class="field"><span>Seu nome</span>
        <input type="text" id="nameIn" maxlength="24" value="${esc(name)}" placeholder="Como vão te chamar" enterkeyhint="go">
      </label>
      <div class="actions center">
        <button class="btn btn-primary" id="joinBtn">${p ? "Salvar perfil" : "Entrar no lobby"}</button>
        ${p ? `<button type="button" class="btn" id="cancelEdit">Cancelar</button>` : ""}
      </div>
      <p class="status" id="joinStatus" role="status"></p>
    </form></section>`;
  const preview = () => {
    $("#photoPrev").src = avatarSrc({ name: $("#nameIn").value || "?", photo: pendingPhoto }, myId || "novo");
    $("#photoHint").textContent = pendingPhoto ? "Trocar foto" : "Escolher foto";
  };
  preview();
  $("#nameIn").addEventListener("input", () => { if (!pendingPhoto) preview(); });
  $("#photoIn").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { pendingPhoto = await resizeImage(f); preview(); $("#joinStatus").textContent = ""; }
    catch { $("#joinStatus").textContent = "Não deu para ler essa imagem. Tente um JPG ou PNG."; }
  });
  $("#cancelEdit")?.addEventListener("click", () => { editing = false; screenKey = ""; render(); });
  $("#joinForm").addEventListener("submit", onJoin);
}

async function onJoin(e) {
  e.preventDefault();
  const name = $("#nameIn").value.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) { $("#joinStatus").textContent = "Digite um nome para entrar."; $("#nameIn").focus(); return; }
  $("#joinBtn").disabled = true;
  try {
    if (!myId) { myId = push(dbRef("players")).key; store.set(LS.id, myId); }
    store.set(LS.name, name);
    store.set(LS.photo, pendingPhoto || null);
    if (me()) await update(dbRef(`players/${myId}`), { name, photo: pendingPhoto || "" });
    else await set(dbRef(`players/${myId}`), { name, photo: pendingPhoto || "", joinedAt: serverTimestamp(), online: true });
    editing = false; armed = false; screenKey = "";
    render();
  } catch (err) {
    console.error(err);
    $("#joinStatus").textContent = "Não foi possível entrar. Confira as regras do Realtime Database.";
    $("#joinBtn").disabled = false;
  }
}

async function leave() {
  const ok = await confirmBox({ title: "Sair do lobby?", text: "Seus pontos desta partida serão perdidos.", ok: "Sair" });
  if (!ok) return;
  const id = myId;
  myId = null; store.set(LS.id, null);
  try { await onDisconnect(dbRef(`players/${id}/online`)).cancel(); } catch {}
  await remove(dbRef(`players/${id}`));
  screenKey = ""; render();
}

/* ---------- Lobby (também entre as rodadas) ---------- */
// Rodada que começa quando todos estiverem prontos neste lobby
const lobbyRound = (st) => (st.phase === "lobby" ? st.round : st.round + 1);
const lobbyKey = (st) => `lobby_${lobbyRound(st)}`;
function toggleLobbyReady() {
  const st = getState(G), key = lobbyKey(st);
  const cur = sess(G).ready?.[key]?.[myId];
  set(dbRef(`${sessPath(st)}/ready/${key}/${myId}`), cur ? null : true);
}
function buildLobby() {
  const st = getState(G), midGame = revealedRounds(G).length > 0 || st.phase === "reveal";
  const info = roundInfo(G), next = lobbyRound(st) + 1;
  ensureSpace();
  stage.innerHTML = `<section class="space-lobby">
    <div class="space-field" id="field" role="list" aria-label="Jogadores no lobby"></div>
    <div class="panel lobby-dock">
      <h1 class="screen-title">Lobby</h1>
      <p class="lede">${midGame
        ? `Os pontos continuam. A rodada ${next} de ${info.total} começa quando todo mundo estiver pronto.`
        : "Todo mundo responde ao mesmo formulário sobre o Problems. Ache as respostas dele de verdade e engane os outros com as suas."}</p>
      ${kicked ? `<p class="role">O tempo do resultado acabou, então você voltou ao lobby.</p>` : ""}
      <div class="actions">
        <button class="btn btn-primary" id="readyBtn"></button>
        <button class="btn" id="editBtn">Editar perfil</button>
        <button class="btn btn-quiet" id="leaveBtn">Sair do jogo</button>
      </div>
      <p class="status" id="status" role="status"></p>
      ${midGame ? `<h2 class="sub">Placar</h2><ol class="board" id="board"></ol>` : ""}
    </div>
  </section>`;
  $("#readyBtn").addEventListener("click", toggleLobbyReady);
  $("#editBtn").addEventListener("click", () => { editing = true; screenKey = ""; render(); });
  $("#leaveBtn").addEventListener("click", leave);
  startFloat();
}
function refreshLobby() {
  const st = getState(G), rd = sess(G).ready?.[lobbyKey(st)] || {}, pr = progress(G);
  syncFloaters();
  $("#readyBtn").textContent = rd[myId] ? "Cancelar pronto" : "Estou pronto";
  if (st.phase === "reveal") {
    $("#status").textContent = `${pr.done.length} de ${pr.need.length} já voltaram do resultado. Você já pode marcar que está pronto.`;
  } else {
    const count = `${pr.done.length} de ${pr.need.length} prontos.`;
    $("#status").textContent = pr.blocker ? `${count} ${pr.blocker}` : `${count} A rodada começa quando todos estiverem.`;
  }
  if ($("#board")) $("#board").innerHTML = boardHTML(ranking(G), myId);
}

/* Fundo de espaço (estrelas, planetas, estrada arco-íris) */
function ensureSpace() {
  if ($("#spaceBg")) return;
  const bg = document.createElement("div");
  bg.id = "spaceBg"; bg.className = "space-bg"; bg.setAttribute("aria-hidden", "true");
  let stars = "";
  for (let i = 0; i < 80; i++) {
    const big = Math.random() < 0.12;
    stars += `<i class="star ${big ? "big" : ""} ${Math.random() < 0.35 ? "tw" : ""}" style="left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;--s:${big ? 10 + Math.random() * 8 : 1 + Math.random() * 2.6}px;--d:${(1.6 + Math.random() * 3).toFixed(2)}s;--dl:${(-Math.random() * 4).toFixed(2)}s"></i>`;
  }
  bg.innerHTML = `<div class="nebula"></div>
    <svg class="rainbow" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="rb" x1="0" x2="1">
        <stop offset="0" stop-color="#ff5d8f"/><stop offset=".2" stop-color="#ffb347"/><stop offset=".4" stop-color="#ffe66d"/>
        <stop offset=".6" stop-color="#6dffb0"/><stop offset=".8" stop-color="#5dc8ff"/><stop offset="1" stop-color="#b58cff"/></linearGradient></defs>
      <path d="M-100 700 C 200 520, 380 760, 640 560 S 1050 260, 1300 380" />
      <path class="lane" d="M-100 700 C 200 520, 380 760, 640 560 S 1050 260, 1300 380" />
    </svg>
    ${stars}
    <i class="shoot" style="--y:12%;--dl:0s"></i><i class="shoot" style="--y:34%;--dl:3.2s"></i><i class="shoot" style="--y:58%;--dl:6.1s"></i>
    <div class="saturn"><i class="ring back"></i><i class="saturn-body"></i><i class="ring front"></i></div><div class="planet p2"></div>
    <img src="img/problems.svg" class="space-hex" alt="">`;
  document.body.prepend(bg);
}

/* ============================================================================
   Lobby compartilhado: todo mundo vê as mesmas posições e as mesmas brincadeiras.
   Um aparelho (o "anfitrião", escolhido sozinho) calcula o movimento e publica as
   posições; os outros só desenham suavizando. Empurrões do mouse, arrastos, cliques
   e arremessos de qualquer pessoa vão para o anfitrião pelo Firebase.
   Se o caminho "ao vivo" não tiver permissão, cada tela anima sozinha como antes.
   ============================================================================ */
const VW = 1000, VH = 560, FW = 120, FH = 118;          // espaço virtual igual para todos
const floaters = new Map();
let floatRAF = 0, floatLast = 0;
const pointer = { x: -1e4, y: -1e4, drag: null, lastX: 0, lastY: 0, lastT: 0, moved: 0, sentAt: 0 };
const live = { ok: true, host: false, subs: [], cursors: {}, drags: {}, timeOffset: 0, claimTimer: 0, pubAt: 0, curAt: 0, dragAt: 0 };
const nowServer = () => Date.now() + live.timeOffset;
const amSim = () => live.host || !live.ok;               // este aparelho calcula o movimento?

function startLive() {
  if (live.subs.length || !configOk) return;
  live.subs.push(onValue(ref(db, ".info/serverTimeOffset"), (s) => { live.timeOffset = s.val() || 0; }));
  const denied = () => { live.ok = false; };
  live.subs.push(onValue(liveRef("pos"), (snap) => {
    const v = snap.val(); if (!v || live.host) return;
    for (const [id, a] of Object.entries(v.p || {})) {
      const f = floaters.get(id); if (!f || f === pointer.drag) continue;
      f.tx = a[0]; f.ty = a[1]; f.tang = a[2] || 0; f.tsc = (a[3] || 100) / 100;
      if (!f.placed) { f.x = f.tx; f.y = f.ty; f.placed = true; f.el.style.visibility = ""; popIn(f); }
    }
  }, denied));
  live.subs.push(onValue(liveRef("cur"), (snap) => { live.cursors = snap.val() || {}; }, denied));
  live.subs.push(onValue(liveRef("drag"), (snap) => { live.drags = snap.val() || {}; }, denied));
  // Eventos de clique/arremesso: TODO mundo toca o efeito; só o anfitrião aplica a física
  const seenFx = new Set();
  live.subs.push(onChildAdded(liveRef("fx"), (snap) => {
    const e = snap.val(), key = snap.key || snap.ref?.p;
    if (!e || seenFx.has(key)) return;
    seenFx.add(key);
    if (nowServer() - (e.t || 0) > 4000) { if (live.host) remove(snap.ref).catch(() => {}); return; }
    const f = floaters.get(e.id); if (!f) return;
    if (e.kind === "boing") clickFx(f, e.emoji);
    if (live.host) {
      if (e.kind === "boing") { f.rv += 900; f.sc = 1.35; f.vy -= 120; }
      if (e.kind === "fling") { f.vx = e.vx || 0; f.vy = e.vy || 0; f.rv += (e.vx || 0) * 1.5; }
      setTimeout(() => remove(snap.ref).catch(() => {}), 3000);
    }
  }, denied));
  const claim = async () => {
    if (!live.ok) return;
    try {
      const res = await runTransaction(liveRef("host"), (cur) => {
        if (!cur || cur.pid === myId || nowServer() - (cur.at || 0) > 3500) return { pid: myId, at: nowServer() };
        return;
      });
      const was = live.host;
      live.host = res.committed && res.snapshot.val()?.pid === myId;
      if (live.host && !was) {
        onDisconnect(liveRef("host")).remove();
        for (const f of floaters.values()) { f.placed = true; f.el.style.visibility = ""; }
      }
    } catch { live.ok = false; live.host = false; }
  };
  claim();
  live.claimTimer = setInterval(claim, 1000);
  if (myId) onDisconnect(liveRef(`cur/${myId}`)).remove();
}
function stopLive() {
  live.subs.forEach((u) => { try { u(); } catch {} });
  live.subs = [];
  clearInterval(live.claimTimer);
  if (configOk && myId) {
    remove(liveRef(`cur/${myId}`)).catch(() => {});
    if (live.host) remove(liveRef("host")).catch(() => {});
  }
  live.host = false;
}

// Conversão entre o espaço virtual e a tela de cada um
function fieldBox() { const field = $("#field"); return field ? { field, W: field.clientWidth, H: field.clientHeight } : null; }
function toLocal(f, box) {
  return { px: (f.x / (VW - FW)) * Math.max(0, box.W - f.w), py: (f.y / (VH - FH)) * Math.max(0, box.H - f.h) };
}
function toVirtual(px, py, f, box) {
  return { x: (px / Math.max(1, box.W - f.w)) * (VW - FW), y: (py / Math.max(1, box.H - f.h)) * (VH - FH) };
}

function syncFloaters() {
  const box = fieldBox(); if (!box) return;
  const { field } = box;
  if (!field.dataset.bound) bindField(field);
  const st = getState(G), players = validPlayers(G), rd = sess(G).ready?.[lobbyKey(st)] || {};
  const tId = st.phase === "lobby" ? currentTrue(G) : null;
  byJoin(players).forEach((id) => {
    const p = players[id];
    let f = floaters.get(id);
    if (!f || !field.contains(f.el)) {
      const el = document.createElement("div");
      el.className = "floater"; el.setAttribute("role", "listitem"); el.dataset.id = id;
      f = { id, el, html: "", w: 120, h: 110,
        x: 20 + Math.random() * (VW - FW - 40), y: 20 + Math.random() * (VH - FH - 40),
        vx: (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 22), vy: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 18),
        ph: (id.charCodeAt(1) || 3) % 10, sp: 0.6 + ((id.charCodeAt(2) || 5) % 8) / 10, ang: 0, rv: 0, sc: 1, placed: false };
      f.tx = f.x; f.ty = f.y; f.tang = 0; f.tsc = 1;
      field.appendChild(el);
      floaters.set(id, f);
      // Quem só desenha espera a posição oficial antes de aparecer
      if (amSim() || reduceMotion()) { f.placed = true; popIn(f); } else el.style.visibility = "hidden";
    }
    const tags = `${id === myId && tId === myId ? `<span class="tag tag-true">você é o verdadeiro</span>` : ""}${!p.online ? `<span class="tag tag-off">offline</span>` : rd[id] ? `<span class="tag tag-ok">pronto ✓</span>` : ""}`;
    const html = `<span class="floater-av">${avatar(p, id, "av-md")}</span><span class="floater-name">${esc(p.name)}${id === myId ? " <small>(você)</small>" : ""}</span><span class="floater-tags">${tags}</span>`;
    if (f.html !== html) { f.el.innerHTML = html; f.html = html; f.w = f.el.offsetWidth || 120; f.h = f.el.offsetHeight || 110; }
    f.el.classList.toggle("ready", !!(rd[id] && p.online));
    f.el.classList.toggle("offline", !p.online);
    f.el.classList.toggle("is-me", id === myId);
    place(f, nowServer() / 1000, box);
  });
  for (const [id, f] of floaters) if (!players[id]) { explode(field, f, box); floaters.delete(id); }
}
function popIn(f) {
  if (reduceMotion()) return;
  f.el.classList.add("pop"); setTimeout(() => f.el.classList.remove("pop"), 450);
  const box = fieldBox(); if (box) puff(box.field, f, box);
}

// Mouse/dedo: empurra, clica (boing), arrasta e arremessa — tudo vai para o anfitrião
function bindField(field) {
  field.dataset.bound = "1";
  const local = (e) => { const r = field.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const sendCursor = (x, y) => {
    if (!live.ok || !myId || performance.now() - live.curAt < 80) return;
    live.curAt = performance.now();
    set(liveRef(`cur/${myId}`), { x: Math.round(x), y: Math.round(y), t: nowServer() }).catch(() => {});
  };
  field.addEventListener("pointermove", (e) => {
    const box = fieldBox(); if (!box) return;
    const p = local(e); pointer.x = p.x; pointer.y = p.y;
    sendCursor((p.x / box.W) * VW, (p.y / box.H) * VH);
    const d = pointer.drag;
    if (d) {
      const now = performance.now(), dt = Math.max(1, now - pointer.lastT) / 1000;
      const v = toVirtual(p.x - d.offX, p.y - d.offY, d, box);
      const vPrev = toVirtual(pointer.lastX - d.offX, pointer.lastY - d.offY, d, box);
      d.dvx = (v.x - vPrev.x) / dt; d.dvy = (v.y - vPrev.y) / dt;
      d.x = Math.max(0, Math.min(VW - FW, v.x)); d.y = Math.max(0, Math.min(VH - FH, v.y));
      pointer.moved += Math.abs(p.x - pointer.lastX) + Math.abs(p.y - pointer.lastY);
      pointer.lastX = p.x; pointer.lastY = p.y; pointer.lastT = now;
      if (live.ok && !live.host && now - live.dragAt > 40) {
        live.dragAt = now;
        set(liveRef(`drag/${d.id}`), { by: myId, x: Math.round(d.x), y: Math.round(d.y), t: nowServer() }).catch(() => {});
      }
    }
  });
  field.addEventListener("pointerleave", () => {
    if (pointer.drag) return;
    pointer.x = pointer.y = -1e4;
    if (live.ok && myId) remove(liveRef(`cur/${myId}`)).catch(() => {});
  });
  field.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".floater"); if (!el) return;
    const f = floaters.get(el.dataset.id); if (!f) return;
    const box = fieldBox(), p = local(e), lp = toLocal(f, box);
    pointer.drag = Object.assign(f, { offX: p.x - lp.px, offY: p.y - lp.py, dvx: 0, dvy: 0 });
    pointer.lastX = p.x; pointer.lastY = p.y; pointer.lastT = performance.now(); pointer.moved = 0;
    f.el.classList.add("grab"); field.setPointerCapture?.(e.pointerId);
    if (live.ok && !live.host) onDisconnect(liveRef(`drag/${f.id}`)).remove();
    e.preventDefault();
  });
  const release = () => {
    const f = pointer.drag; if (!f) return;
    pointer.drag = null; f.el.classList.remove("grab");
    let fx;
    if (pointer.moved < 6) fx = { id: f.id, kind: "boing", emoji: CLICK_EMOJI[Math.floor(Math.random() * CLICK_EMOJI.length)], t: nowServer() };
    else {
      let vx = f.dvx || 0, vy = f.dvy || 0; const sp = Math.hypot(vx, vy), max = 1100;
      if (sp > max) { vx *= max / sp; vy *= max / sp; }
      fx = { id: f.id, kind: "fling", vx: Math.round(vx), vy: Math.round(vy), t: nowServer() };
    }
    if (!live.ok) {                                  // sem Firebase ao vivo: só na minha tela
      if (fx.kind === "boing") { f.rv += 900; f.sc = 1.35; f.vy -= 120; clickFx(f, fx.emoji); }
      else { f.vx = fx.vx; f.vy = fx.vy; f.rv += fx.vx * 1.5; }
      return;
    }
    if (!live.host) { f.tx = f.x; f.ty = f.y; remove(liveRef(`drag/${f.id}`)).catch(() => {}); }
    push(liveRef("fx"), fx);                         // todos (inclusive eu) recebem e tocam o efeito
  };
  field.addEventListener("pointerup", release);
  field.addEventListener("pointercancel", release);
}
// Efeito do clique que todo mundo vê: pulo com giro, estrelinhas e um emoji subindo
const CLICK_EMOJI = ["😂", "😎", "🤩", "😜", "🥳", "😱", "🤪", "💥", "⭐", "💖", "👋", "🔥"];
function clickFx(f, emoji) {
  const av = f.el.querySelector(".floater-av"); if (!av) return;
  av.classList.remove("boing"); void av.offsetWidth; av.classList.add("boing");
  setTimeout(() => av.classList.remove("boing"), 800);
  burst(av, 14);
  if (emoji) {
    const b = document.createElement("span");
    b.className = "click-emoji"; b.textContent = emoji;
    f.el.appendChild(b);
    setTimeout(() => b.remove(), 1200);
  }
}
// Aparece com um "puf" no próprio lugar
function puff(field, f, box) {
  const lp = toLocal(f, box);
  const p = document.createElement("div");
  p.className = "boom puff";
  p.style.left = `${lp.px + f.w / 2}px`; p.style.top = `${lp.py + 40}px`;
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("i"), a = (i / 10) * Math.PI * 2, d = 34 + Math.random() * 26;
    s.style.setProperty("--dx", `${Math.cos(a) * d}px`); s.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    s.style.setProperty("--c", ["#fff", "#ffd84d", "#22e5ea"][i % 3]);
    p.appendChild(s);
  }
  field.appendChild(p);
  setTimeout(() => p.remove(), 650);
}
// Saiu do lobby: estoura rapidinho
function explode(field, f, box) {
  if (reduceMotion()) { f.el.remove(); return; }
  const lp = toLocal(f, box);
  const boom = document.createElement("div");
  boom.className = "boom";
  boom.style.left = `${lp.px + f.w / 2}px`; boom.style.top = `${lp.py + 40}px`;
  const colors = ["#ffd84d", "#ff5d8f", "#22e5ea", "#fff", "#b58cff"];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement("i"), a = (i / 18) * Math.PI * 2 + Math.random() * .3, d = 50 + Math.random() * 70;
    s.style.setProperty("--dx", `${Math.cos(a) * d}px`); s.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    s.style.setProperty("--c", colors[i % colors.length]);
    boom.appendChild(s);
  }
  field.appendChild(boom);
  f.el.classList.add("popout");
  setTimeout(() => f.el.remove(), 260);
  setTimeout(() => boom.remove(), 700);
}
function place(f, t, box) {
  const lp = toLocal(f, box);
  const bob = Math.sin(t * f.sp + f.ph) * 7, rot = Math.sin(t * f.sp * 0.7 + f.ph) * 7 + f.ang;
  f.el.style.transform = `translate3d(${lp.px.toFixed(1)}px, ${(lp.py + bob).toFixed(1)}px, 0) rotate(${rot.toFixed(1)}deg) scale(${f.sc.toFixed(3)})`;
}
// Movimento calculado pelo anfitrião (no espaço virtual)
function simulate(dt) {
  const list = [...floaters.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    if (d < 150) { const k = ((150 - d) / 150) * 130 * dt, ux = dx / d, uy = dy / d; a.vx -= ux * k; a.vy -= uy * k; b.vx += ux * k; b.vy += uy * k; }
  }
  // cursores de todo mundo (o meu local e os que chegam do Firebase)
  const box = fieldBox();
  const cursors = [];
  if (box && pointer.x > -1e3) cursors.push({ x: (pointer.x / box.W) * VW, y: (pointer.y / box.H) * VH });
  const now = nowServer();
  for (const [pid, c] of Object.entries(live.cursors || {})) if (pid !== myId && c && now - (c.t || 0) < 1500) cursors.push(c);
  for (const f of list) {
    const rd0 = live.drags?.[f.id];
    const remoteDrag = rd0 && now - (rd0.t || 0) < 1500 ? rd0 : null;   // arrasto abandonado não prende ninguém
    if (f === pointer.drag || (remoteDrag && remoteDrag.by !== myId)) {
      if (remoteDrag && f !== pointer.drag) {
        const nx = remoteDrag.x, ny = remoteDrag.y;
        f.vx = (nx - f.x) / Math.max(dt, 0.016) * 0.5; f.vy = (ny - f.y) / Math.max(dt, 0.016) * 0.5;
        f.x += (nx - f.x) * Math.min(1, dt * 18); f.y += (ny - f.y) * Math.min(1, dt * 18);
      }
      f.ang *= 1 - 3 * dt; f.sc += (1.12 - f.sc) * 10 * dt;
      continue;
    }
    const cx = f.x + FW / 2, cy = f.y + FH / 2;
    for (const c of cursors) {
      const mx = cx - c.x, my = cy - c.y, md = Math.hypot(mx, my);
      if (md < 140) { const k = ((140 - md) / 140) * 950 * dt; f.vx += (mx / (md || 1)) * k; f.vy += (my / (md || 1)) * k; f.rv += (mx > 0 ? 1 : -1) * 600 * dt; }
    }
    f.vx += (Math.random() - 0.5) * 30 * dt; f.vy += (Math.random() - 0.5) * 30 * dt;
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > 46) { const k = Math.max(46 / sp, 1 - 2.2 * dt); f.vx *= k; f.vy *= k; }
    else if (sp < 14) { f.vx *= 14 / (sp || 1); f.vy *= 14 / (sp || 1); }
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx) * 0.8; } if (f.x > VW - FW) { f.x = VW - FW; f.vx = -Math.abs(f.vx) * 0.8; }
    if (f.y < 0) { f.y = 0; f.vy = Math.abs(f.vy) * 0.8; } if (f.y > VH - FH) { f.y = VH - FH; f.vy = -Math.abs(f.vy) * 0.8; }
    f.ang += f.rv * dt; f.rv *= 1 - 2.5 * dt; if (Math.abs(f.rv) < 20) f.ang *= 1 - 3 * dt;
    f.sc += (1 - f.sc) * 8 * dt;
  }
}
function publish() {
  if (!live.host || !live.ok || performance.now() - live.pubAt < 85) return;
  live.pubAt = performance.now();
  const p = {};
  for (const f of floaters.values()) p[f.id] = [Math.round(f.x), Math.round(f.y), Math.round(f.ang), Math.round(f.sc * 100)];
  set(liveRef("pos"), { t: nowServer(), p }).catch(() => { live.ok = false; });
}
function floatStep(ts) {
  const box = fieldBox();
  if (!box) { floatRAF = 0; return; }
  const dt = Math.min(0.05, (ts - (floatLast || ts)) / 1000); floatLast = ts;
  const t = nowServer() / 1000;        // mesmo relógio para todos → o balanço fica igual em todas as telas
  if (amSim()) { simulate(dt); publish(); }
  else {
    // Só desenha: vai suavemente até a posição oficial (o que eu arrasto segue meu dedo)
    for (const f of floaters.values()) {
      if (f === pointer.drag) { f.sc += (1.12 - f.sc) * 10 * dt; continue; }
      const k = Math.min(1, dt * 9);
      f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k;
      f.ang += (f.tang - f.ang) * k; f.sc += (f.tsc - f.sc) * k;
    }
  }
  for (const f of floaters.values()) place(f, t, box);
  floatRAF = requestAnimationFrame(floatStep);
}
function startFloat() {
  startLive();
  syncFloaters();
  if (reduceMotion() || floatRAF) return;
  floatLast = 0;
  floatRAF = requestAnimationFrame(floatStep);
}
function stopFloat() {
  if (floatRAF) cancelAnimationFrame(floatRAF);
  floatRAF = 0;
  floaters.clear();
  pointer.drag = null;
  stopLive();
}

/* ---------- Respondendo o formulário ---------- */
const draftKey = (st) => `qp.draft.${st.session}.${st.round}`;
const loadDraft = (st) => { try { return JSON.parse(store.get(draftKey(st)) || "[]"); } catch { return []; } };
const autoGrow = (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + 4 + "px"; };
function readForm(qs) {
  return qs.map((q, i) => {
    if (q.type === "choice") return stage.querySelector(`input[name="q${i}"]:checked`)?.value || "";
    if (q.type === "photo") return photoVals[i] || "";
    return stage.querySelector(`textarea[data-i="${i}"]`)?.value || "";
  });
}
function fieldHTML(q, i, draft) {
  if (q.type === "choice") {
    return `<div class="choices" role="radiogroup" aria-labelledby="ql${i}">${q.options.map((o, k) => `
      <label class="choice"><input type="radio" name="q${i}" value="${esc(o)}" ${draft[i] === o ? "checked" : ""}>
        <span class="choice-letter">${letter(k)}</span><span class="choice-text">${esc(o)}</span></label>`).join("")}</div>`;
  }
  if (q.type === "photo") {
    return `<div class="photo-field">
      <label class="btn"><input type="file" accept="image/*" class="sr-only" data-photo="${i}"><span id="pb${i}">${isImage(draft[i]) ? "Trocar foto" : "Escolher foto"}</span></label>
      <img class="photo-ans" id="pp${i}" alt="Sua foto" ${isImage(draft[i]) ? `src="${esc(draft[i])}"` : "hidden"}>
    </div>`;
  }
  return `<textarea id="a${i}" data-i="${i}" rows="2" maxlength="300" placeholder="Sua resposta…" aria-labelledby="ql${i}">${esc(draft[i] || "")}</textarea>`;
}

function buildAnswering() {
  const st = getState(G), R = st.rounds[rk(st.round)] || {}, isTrue = R.trueId === myId;
  if (isSubmitted(sess(G).answers?.[rk(st.round)]?.[myId])) {
    stage.innerHTML = waitingHTML("Respostas enviadas!", "Agora é só esperar o resto da galera terminar.");
    return;
  }
  const qs = roundQuestions(R), draft = loadDraft(st);
  photoVals = {};
  qs.forEach((q, i) => { if (q.type === "photo" && isImage(draft[i])) photoVals[i] = draft[i]; });
  const goKey = `qp.go.${st.session}.${st.round}`;
  let ready = false; try { ready = sessionStorage.getItem(goKey) === "1"; } catch {}
  if (document.hidden) ready = true;
  if (!ready) {
    // A tela preta entra antes de o formulário existir, então nada aparece antes da contagem
    showOverlay("black", `<div class="ov-inner">
      <p class="ov-title">${esc(roundTitle(R, st.round))}</p>
      <p class="ov-sub">Prepare-se! O formulário abre em</p>
      <p class="ov-count" id="prepN" aria-live="polite">5</p></div>`);
    lockScroll(true, 9000);
  }
  stage.innerHTML = `<section class="panel marked" id="formPanel">
    <p class="role ${isTrue ? "role-true" : ""}">${isTrue
      ? "Você é o Problems verdadeiro. Responda de verdade."
      : "Responda como se fosse o Problems. Quanto mais convincente, mais gente cai."}</p>
    <h1 class="question">${esc(roundTitle(R, st.round))}</h1>
    <p class="lede">${qs.length === 1 ? "Uma pergunta" : `${qs.length} perguntas`}. Responda tudo e envie quando terminar.</p>
    <ol class="form-qs">${qs.map((q, i) => {
      const img = questionImage(G, R, i);
      return `<li data-type="${q.type}">
        <div class="q-label" id="ql${i}"><span class="q-idx">${i + 1}</span><span>${esc(q.text)}</span></div>
        ${img ? `<img class="q-img" src="${esc(img)}" alt="Foto da pergunta ${i + 1}">` : ""}
        ${fieldHTML(q, i, draft)}
      </li>`;
    }).join("")}</ol>
    <div class="submit-bar">
      <span class="submit-info" id="fill"></span>
      <button class="btn btn-primary" id="send">Enviar respostas</button>
    </div>
    <p class="count-line" id="cnt"></p>
  </section>`;
  const saveDraft = () => { try { store.set(draftKey(st), JSON.stringify(readForm(qs))); } catch {} };
  const updateFill = () => {
    const vals = readForm(qs), filled = vals.filter((v) => v.trim()).length;
    $("#fill").textContent = `${filled} de ${vals.length} respondidas`;
    $("#send").disabled = filled < vals.length;
  };
  const panel = $("#formPanel");
  panel.addEventListener("input", (e) => {
    if (e.target.matches("textarea[data-i]")) { autoGrow(e.target); saveDraft(); updateFill(); }
  });
  panel.addEventListener("change", async (e) => {
    if (e.target.type === "radio") { saveDraft(); updateFill(); return; }
    const i = e.target.dataset.photo; if (i == null) return;
    const f = e.target.files?.[0]; if (!f) return;
    try {
      photoVals[i] = await resizeImageFit(f, 560, 0.75);
      const img = $("#pp" + i); img.src = photoVals[i]; img.hidden = false;
      $("#pb" + i).textContent = "Trocar foto";
      saveDraft(); updateFill();
    } catch { alert("Não deu para ler essa imagem. Tente um JPG ou PNG."); }
  });
  stage.querySelectorAll("textarea[data-i]").forEach(autoGrow);
  $("#send").addEventListener("click", () => submitForm(st, qs));
  updateFill();
  if (ready) return;
  const open = () => {
    endSeq();
    try { sessionStorage.setItem(goKey, "1"); } catch {}
    unlockScroll();
    stage.querySelectorAll("textarea[data-i]").forEach(autoGrow);
  };
  runSeq(() => { hideOverlay(); hideBars(); open(); });
  [5, 4, 3, 2, 1].forEach((x, i) => later(i * 1000, () => {
    const el = $("#prepN"); if (!el) return;
    el.textContent = x;
    el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
  }));
  later(5000, () => barsIn(() => { hideOverlay(); open(); barsOut(); }, "down"));
}

async function submitForm(st0, qs) {
  const vals = readForm(qs).map((v, i) => (qs[i].type === "photo" ? v : v.trim().slice(0, 300)));
  if (!vals.length || vals.some((v) => !v)) return;
  const ok = await confirmBox({
    title: "Enviar de vez?",
    text: "Depois de enviar não dá para voltar atrás: suas respostas ficam definitivas. Aí é só aguardar os outros.",
    ok: "Enviar respostas"
  });
  if (!ok) return;
  const st = getState(G);
  if (st.phase !== "answering" || st.round !== st0.round || st.session !== st0.session) return;
  await set(dbRef(`${sessPath(st)}/answers/${rk(st.round)}/${myId}`), vals);
  store.set(draftKey(st), null);
}

/* ---------- Votação ---------- */
// Na visão do Problems verdadeiro: quem escreveu cada resposta
function writtenBy(id) {
  const p = validPlayers(G)[id] || { name: "Jogador que saiu" };
  return `<span class="written-by">${avatar(p, id, "av-xs")}<span>Escrita por <strong>${esc(p.name)}</strong></span></span>`;
}
const chip = (players, v, cls, extra = "") =>
  `<span class="voter ${cls}">${avatar(players[v], v, "av-xs")}${esc(players[v]?.name || "?")}${extra}</span>`;

function buildVoting() {
  pick = null;
  const st = getState(G), S = sess(G), n = st.round, R = st.rounds[rk(n)] || {};
  const isTrue = R.trueId === myId, myVote = S.votes?.[rk(n)]?.[myId], locked = isTrue || !!myVote;
  const ans = S.answers?.[rk(n)] || {}, order = answerOrder(G, n);
  const cards = order.map((id, i) => {
    const mine = id === myId, voted = myVote === id;
    const tags = mine
      ? (isTrue ? `<span class="tag tag-true">Sua resposta verdadeira</span>` : `<span class="tag">Sua resposta</span>`)
      : voted ? `<span class="tag tag-ready">Seu voto</span>` : "";
    return `<button class="card-ans ${mine ? (isTrue ? "mine-true" : "mine") : ""} ${voted ? "picked" : ""}" data-i="${i}" ${locked || mine ? "disabled" : ""} aria-pressed="${voted}">
      ${cardHead(i, tags)}${isTrue && !mine ? writtenBy(id) : ""}${qaHTML(R, ans[id])}${isTrue ? `<span class="live" id="live${i}"></span>` : ""}
    </button>`;
  }).join("");

  if (isTrue) {
    stage.innerHTML = `<section class="panel marked true-view">
      <div class="true-banner">
        <img src="img/problems.svg" alt="">
        <div><p class="true-kicker">${esc(roundTitle(R, n))}</p>
          <h1 class="screen-title">Você é o Problems verdadeiro!</h1>
          <p class="lede">Sua resposta está em destaque. Acompanhe ao vivo quem está escolhendo cada uma e quem já confirmou.</p></div>
      </div>
      <div class="tv-layout">
        <div class="answers vote-grid compact" id="answers">${cards}</div>
        <aside class="vote-guide" aria-label="Votos ao vivo">
          <p class="guide-title">Votos ao vivo <span id="cnt"></span></p>
          <ul id="guide"></ul>
        </aside>
      </div>
    </section>`;
    return;
  }

  const note = myVote ? "Voto enviado! Agora é aguardar os outros."
    : "Toque na resposta que você acha que é do Problems verdadeiro.";
  stage.innerHTML = `<section class="panel marked">
    <p class="role">${esc(roundTitle(R, n))}</p>
    <h1 class="question">Qual destas é do Problems verdadeiro?</h1>
    <p class="lede">${note}</p>
    <div class="answers vote-grid" id="answers">${cards}</div>
    ${locked ? "" : `<div class="submit-bar">
      <span class="submit-info" id="pickInfo">Nenhuma escolhida</span>
      <button class="btn btn-primary" id="voteBtn" disabled>Enviar voto</button>
    </div>`}
    <p class="count-line" id="cnt"></p>
  </section>`;
  if (locked) return;
  $("#answers").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b || b.disabled) return;
    pick = Number(b.dataset.i);
    stage.querySelectorAll("#answers .card-ans").forEach((c) => {
      const on = Number(c.dataset.i) === pick;
      c.classList.toggle("picked", on);
      c.setAttribute("aria-pressed", on);
    });
    $("#pickInfo").textContent = `Escolhida: resposta ${letter(pick)}`;
    $("#voteBtn").disabled = false;
    const target = answerOrder(G, n)[pick];
    if (target) set(dbRef(`${sessPath(st)}/picks/${rk(n)}/${myId}`), target);
  });
  $("#voteBtn").addEventListener("click", async () => {
    if (pick == null) return;
    const ok = await confirmBox({
      title: `Votar na resposta ${letter(pick)}?`,
      text: "O voto é definitivo: não dá para trocar depois. Se for de um impostor, você perde 1 ponto.",
      ok: "Votar"
    });
    if (!ok) return;
    const now = getState(G);
    if (now.phase !== "voting" || now.round !== n || now.session !== st.session) return;
    const target = answerOrder(G, n)[pick];
    if (!target || target === myId) return;
    // O horário do voto serve para o desempate (quem chegou primeiro à pontuação)
    await update(dbRef(sessPath(now)), { [`votes/${rk(n)}/${myId}`]: target, [`voteAt/${rk(n)}/${myId}`]: serverTimestamp() });
  });
}

function refreshVoting() {
  refreshCount();
  const st = getState(G), S = sess(G), n = st.round, R = st.rounds[rk(n)] || {};
  if (R.trueId !== myId || !$("#guide")) return;
  const picks = S.picks?.[rk(n)] || {}, votes = S.votes?.[rk(n)] || {}, players = validPlayers(G);
  answerOrder(G, n).forEach((id, i) => {
    const el = $("#live" + i); if (!el) return;
    const locked = Object.keys(votes).filter((v) => votes[v] === id && v !== myId);
    const choosing = Object.keys(picks).filter((v) => picks[v] === id && !votes[v] && v !== myId);
    const html = locked.map((v) => chip(players, v, "locked", ` <b>✓</b>`)).join("") +
      choosing.map((v) => chip(players, v, "choosing", ` <i>escolhendo…</i>`)).join("");
    if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
  });
  // Guia: cada pessoa e a alternativa em que confirmou (ou está pensando); dourado se for a dele
  const order = answerOrder(G, n), mineIdx = order.indexOf(myId);
  const rows = progress(G).need.map((v) => {
    const target = votes[v] || picks[v], idx = target ? order.indexOf(target) : -1;
    const state = votes[v] ? "locked" : picks[v] ? "choosing" : "idle";
    const pill = idx < 0 ? `<span class="g-pill idle">pensando…</span>`
      : `<span class="g-pill ${state} ${idx === mineIdx ? "is-mine" : ""}">${state === "locked" ? "✓" : "…"} ${letter(idx)}</span>`;
    return `<li class="${state}">${avatar(players[v], v, "av-xs")}<span class="g-name">${esc(players[v]?.name || "?")}</span>${pill}</li>`;
  }).join("");
  const guide = $("#guide");
  if (guide.dataset.h !== rows) { guide.dataset.h = rows; guide.innerHTML = rows || `<li class="idle">Ninguém para votar.</li>`; }
}

/* ---------- Revelação com suspense ---------- */
function buildReveal() {
  const st = getState(G), S = sess(G), n = st.round, R = st.rounds[rk(n)] || {}, players = validPlayers(G);
  const ans = S.answers?.[rk(n)] || {}, votes = S.votes?.[rk(n)] || {}, order = answerOrder(G, n);
  const myPick = votes[myId], asTrue = R.trueId === myId;
  const cards = order.map((id, i) => {
    const isT = id === R.trueId;
    const p = players[id] || { name: "Jogador que saiu" };
    const voters = Object.keys(votes).filter((v) => votes[v] === id && v !== R.trueId && v !== id);
    const tag = myPick === id
      ? `<span class="rv-part tag ${isT ? "tag-ok" : "tag-bad"}">${isT ? "Seu voto: acertou!" : "Seu voto: caiu nessa!"}</span>`
      : asTrue && isT ? `<span class="tag tag-true">Sua resposta</span>` : "";
    return `<article class="card-ans rv ${asTrue && isT ? "mine-true" : ""}" data-i="${i}" data-true="${isT ? 1 : 0}" data-mine="${myPick === id ? 1 : 0}" data-votes="${voters.length}">
      ${cardHead(i, tag)}
      ${qaHTML(R, ans[id])}
      <div class="rv-part author">${avatar(p, id, "av-sm")}
        <div class="who"><strong>${esc(p.name)}</strong><span>${isT ? "Problems verdadeiro" : "Impostor"}</span></div>
        ${!isT && voters.length ? `<span class="gain">+${voters.length}</span>` : ""}
      </div>
      <div class="rv-part voters">${voters.length
        ? voters.map((v, k) => `<span class="voter ${isT ? "right" : "wrong"}" style="--k:${k}">${avatar(players[v], v, "av-xs")}${esc(players[v]?.name || "?")}${asTrue ? ` <b>${isT ? "✓" : "✗"}</b>` : ` <b>${isT ? "+1" : "−1"}</b>`}</span>`).join("")
        : `<span class="novote">Ninguém votou nesta.</span>`}</div>
    </article>`;
  }).join("");
  stage.innerHTML = `<section class="panel marked reveal-panel ${asTrue ? "as-true" : ""}">
    <div id="rb">
      <p class="role">${esc(roundTitle(R, n))}</p>
      <h1 class="question" id="rvHead">${asTrue ? "Quem caiu na conversa?" : "Quem escreveu cada uma?"}</h1>
      <div class="answers vote-grid" id="cards">${cards}</div>
      <div id="after" hidden>
        <h2 class="sub">Placar</h2>
        <ol class="board" id="board"></ol>
        <div class="actions"><button class="btn btn-primary" id="nextBtn"></button></div>
        <div class="wait-box" id="waitBox" hidden aria-live="polite"></div>
        <p class="status" id="status" role="status"></p>
      </div>
    </div>
  </section>`;
  $("#nextBtn").addEventListener("click", () => returnFromReveal(false));
  kickLeft = null;
  playReveal(st, R, asTrue);
}

function playReveal(st, R, asTrue) {
  const seenKey = `qp.seen.${st.session}.${st.round}`;
  let seen = false; try { seen = sessionStorage.getItem(seenKey) === "1"; } catch {}
  const cards = [...stage.querySelectorAll("#cards .card-ans")];
  const trueCard = cards.find((c) => c.dataset.true === "1");
  const impostors = cards.filter((c) => c !== trueCard);
  const right = Number(trueCard?.dataset.votes || 0);
  const wrong = impostors.reduce((t, c) => t + Number(c.dataset.votes), 0);
  const allRight = right > 0 && wrong === 0;
  const finalHead = allRight ? "Todos acertaram!!" : asTrue
    ? `${right} acert${right === 1 ? "ou" : "aram"} e ${wrong} ca${wrong === 1 ? "iu" : "íram"} na conversa!`
    : trueCard ? `O Problems verdadeiro escreveu a ${letter(Number(trueCard.dataset.i))}!`
    : "O Problems verdadeiro não respondeu nesta rodada.";
  const show = (c, animate) => {
    c.classList.add("shown");
    if (c === trueCard) { c.classList.add("is-true"); if (allRight) c.classList.add("all-right"); return; }
    if (c.dataset.mine === "1") animate ? later(450, () => c.classList.add("fell")) : c.classList.add("fell");
    // Ninguém escolheu esta: fica cinza. Enganou alguém: fica levemente avermelhada
    const cls = Number(c.dataset.votes) === 0 ? "nobody" : "fooled-tint";
    animate ? later(500, () => c.classList.add(cls)) : c.classList.add(cls);
  };
  const done = () => {
    endSeq();
    unlockScroll();
    $("#after").hidden = false;
    revealDoneFor = `${st.session}.${st.round}`;
    refreshTopbar();
    animateBoard(!instantMode);
    startKick();
    try { sessionStorage.setItem(seenKey, "1"); } catch {}
  };
  let instantMode = false;
  const instant = () => {
    instantMode = true;
    endSeq(); clearTimers(); hideOverlay(); hideStripes();
    stage.querySelectorAll(".zoom-back").forEach((e) => e.remove());
    cards.forEach((c) => { c.classList.remove("zooming", "drum"); c.style.translate = ""; c.style.scale = ""; show(c, false); });
    $("#rb").hidden = false;
    $("#rvHead").textContent = finalHead;
    done();
  };
  if (seen || reduceMotion() || document.hidden) { instant(); return; }
  runSeq(instant);
  const focus = (c) => c?.scrollIntoView({ behavior: "smooth", block: "center" });
  lockScroll(true);
  let t = titleThenStripes(asTrue ? "Hora da verdade!" : "Quem é o Problems verdadeiro?",
    () => { $("#rb").hidden = false; window.scrollTo({ top: 0 }); });
  t += 500;
  // Cada alternativa: tela escurece, zoom nela, revela quem escreveu e os votos, volta
  const zoomImpostor = (c, extra = () => {}) => {
    const hold = 1500 + Number(c.dataset.votes) * 320;
    later(t, () => zoomCard(c, hold, () => { show(c, true); extra(c); }));
    t += ZOOM.dark + ZOOM.go + hold + ZOOM.back + 250;
  };

  if (asTrue) {
    // Visão do Problems: cada erro cai animado, cada acerto comemora na resposta dele
    impostors.forEach((c) => zoomImpostor(c, (el) => { if (Number(el.dataset.votes)) el.classList.add("fooled"); }));
    later(t, () => {
      $("#rvHead").textContent = "E quem acertou?";
      if (trueCard) { focus(trueCard); trueCard.classList.add("drum"); }
    });
    t += 1300;
    if (trueCard) {
      const hold = 900 + right * 450;
      later(t, () => { trueCard.classList.remove("drum"); zoomCard(trueCard, hold, () => { show(trueCard, true); burst(trueCard, 18); if (allRight) celebrateAll(trueCard); }); });
      for (let k = 0; k < right; k++) later(t + ZOOM.dark + ZOOM.go + 300 + k * 450, () => burst(trueCard, 14));
      t += ZOOM.dark + ZOOM.go + hold + ZOOM.back;
    }
    later(t, () => { $("#rvHead").textContent = finalHead; if (trueCard && right) burst(trueCard, 28); });
    later(t + 1400, done);
    return;
  }

  impostors.forEach((c) => zoomImpostor(c));
  later(t, () => {
    $("#rvHead").textContent = "E o Problems verdadeiro é…";
    if (trueCard) { focus(trueCard); trueCard.classList.add("drum"); }
  });
  t += 1300;
  later(t, () => {
    if (!trueCard) { $("#rvHead").textContent = finalHead; return; }
    trueCard.classList.remove("drum");
    const hold = 1500 + right * 420;
    zoomCard(trueCard, hold, () => {
      $("#rvHead").textContent = finalHead; show(trueCard, true); burst(trueCard, 26);
      if (allRight) celebrateAll(trueCard);
    });
    // uma estrelinha para cada pessoa que acertou, no ritmo em que os nomes aparecem
    for (let k = 0; k < right; k++) later(ZOOM.dark + ZOOM.go + 350 + k * 420, () => burst(trueCard, 12));
  });
  t += trueCard ? ZOOM.dark + ZOOM.go + 1500 + right * 420 + ZOOM.back + 200 : 600;
  later(t, done);
}

function burst(el, count) {
  const layer = document.createElement("span");
  layer.className = "sparks";
  const colors = ["#ffd84d", "#ffffff", "#22e5ea", "#1f7fd1", "#ff9eb5"];
  for (let i = 0; i < count; i++) {
    const s = document.createElement("i");
    const ang = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 170;
    s.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(ang) * dist}px`);
    s.style.setProperty("--r", `${Math.round(Math.random() * 360)}deg`);
    s.style.setProperty("--d", `${(Math.random() * 0.15).toFixed(2)}s`);
    s.style.setProperty("--sz", `${12 + Math.random() * 16}px`);
    s.style.setProperty("--c", colors[i % colors.length]);
    layer.appendChild(s);
  }
  el.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}

// Volta ao lobby (por conta própria ou pelo tempo)
function returnFromReveal(auto) {
  const st = getState(G);
  if (st.phase !== "reveal") return;
  if (auto) kicked = true;
  kickLeft = null;
  set(dbRef(`${sessPath(st)}/ready/${readyKey(st)}/${myId}`), true);
}
// Caixa "aguardando os outros" (fica na tela até todo mundo confirmar)
function waitBoxHTML(verb) {
  const pr = progress(G), players = validPlayers(G), done = new Set(pr.done);
  const missing = pr.need.filter((id) => !done.has(id)).map((id) => players[id]?.name).filter(Boolean);
  return `<img src="img/problems.svg" class="wait-hex" alt="">
    <div class="wb-text"><strong>Aguardando os outros…</strong>
      <span>${pr.done.length} de ${pr.need.length} ${verb}</span>
      <span class="pips">${pr.need.map((_, i) => `<span class="pip ${i < pr.done.length ? "on" : ""}"></span>`).join("")}</span>
      ${missing.length ? `<span class="wb-missing">Faltam: ${esc(joinNames(missing))}</span>` : ""}</div>`;
}
function startKick() {
  kickLeft = KICK_SECONDS;
  const tick = () => {
    if (kickLeft == null) return;
    if (kickLeft <= 0) { returnFromReveal(true); return; }
    refreshReveal();
    kickLeft -= 1;
    later(1000, tick);
  };
  tick();
}
// Chuva de confete pela tela toda
function confettiRain(count = 70, ms = 3400) {
  const rain = document.createElement("div");
  rain.className = "confetti";
  const colors = ["#ff5d8f", "#ffb347", "#ffe66d", "#6dffb0", "#5dc8ff", "#b58cff", "#fff"];
  for (let i = 0; i < count; i++) {
    const c = document.createElement("i");
    c.style.left = `${Math.random() * 100}%`;
    c.style.setProperty("--c", colors[i % colors.length]);
    c.style.setProperty("--d", `${(Math.random() * 0.8).toFixed(2)}s`);
    c.style.setProperty("--t", `${(1.6 + Math.random() * 1.2).toFixed(2)}s`);
    c.style.setProperty("--x", `${(Math.random() * 160 - 80).toFixed(0)}px`);
    c.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
    rain.appendChild(c);
  }
  document.body.appendChild(rain);
  setTimeout(() => rain.remove(), ms);
}
// Todos acertaram: chuva de confete e brilho arco-íris no card
function celebrateAll(card) {
  card.classList.add("all-right");
  confettiRain();
  [0, 350, 700, 1050].forEach((ms) => later(ms, () => burst(card, 22)));
}
// Quem ficou em 1º: PARABÉNS gigante, confete e fogos
function congrats() {
  const el = document.createElement("div");
  el.className = "congrats";
  el.innerHTML = `<div class="congrats-inner"><p class="congrats-text" aria-label="Parabéns!">${bigText("PARABÉNS!")}</p><p class="congrats-sub">Você ficou em 1º lugar!</p></div>`;
  document.body.appendChild(el);
  confettiRain(130, 5200);
  for (let i = 0; i < 7; i++) setTimeout(() => {
    const fw = document.createElement("span");
    fw.className = "fw";
    fw.style.left = `${10 + Math.random() * 80}%`; fw.style.top = `${10 + Math.random() * 60}%`;
    document.body.appendChild(fw);
    burst(fw, 26);
    setTimeout(() => fw.remove(), 1700);
  }, 200 + i * 420);
  setTimeout(() => el.classList.add("out"), 3600);
  setTimeout(() => el.remove(), 4300);
}
// Placar depois da revelação: linhas saem da posição antiga e deslizam para a nova
function animateBoard(animate) {
  const board = $("#board"); if (!board) return;
  const st = getState(G), now = ranking(G);
  const prevList = standings({ ...G, state: { ...G.state, phase: "voting" } }).list;
  const prevIdx = Object.fromEntries(prevList.map((r, i) => [r.id, i]));
  const prevPts = Object.fromEntries(prevList.map((r) => [r.id, r.pts]));
  const first = revealedRounds(G).length <= 1;
  board.dataset.anim = "1";
  board.innerHTML = now.map((r, i) => {
    const before = prevIdx[r.id];
    const mv = first || before == null ? "" : before > i ? `<span class="mv up">▲${before - i}</span>` : before < i ? `<span class="mv down">▼${i - before}</span>` : `<span class="mv same">＝</span>`;
    return `<li class="${r.place === 1 && r.pts > 0 ? "lead" : ""} ${r.id === myId ? "is-me" : ""}" data-id="${esc(r.id)}">
      <span class="pos">${r.place}º</span>${avatar(r.p, r.id, "av-sm")}
      <span class="p-name">${esc(r.p.name)}${r.id === myId ? " <small>(você)</small>" : ""} ${mv}</span>
      <span class="pts"><b class="pts-n">${r.pts}</b> pt${Math.abs(r.pts) === 1 ? "" : "s"}${r.delta ? `<span class="delta ${r.delta < 0 ? "neg" : ""}">${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)}</span>` : ""}</span>
    </li>`;
  }).join("") || `<li class="empty">Ninguém no placar ainda.</li>`;
  if (!animate) return;
  $("#after").scrollIntoView({ behavior: "smooth", block: "start" });
  const items = [...board.children];
  const pitch = items.length > 1 ? items[1].offsetTop - items[0].offsetTop : 50;
  items.forEach((li, i) => {
    const before = prevIdx[li.dataset.id];
    const dy = before == null ? 0 : (before - i) * pitch;
    li.style.transition = "none";
    li.style.transform = `translateY(${dy}px)`;
    const n = li.querySelector(".pts-n"), to = Number(n.textContent), from = prevPts[li.dataset.id] ?? to;
    n.textContent = from;
    later(500 + i * 90, () => {
      li.style.transition = "transform .8s cubic-bezier(.3, 1.3, .4, 1)";
      li.style.transform = "";
      if (before != null && before !== i) li.classList.add(before > i ? "rise" : "drop");
      if (from !== to) {
        const t0 = performance.now();
        const tick = (ts) => {
          const k = Math.min(1, (ts - t0) / 700);
          n.textContent = Math.round(from + (to - from) * k);
          if (k < 1) requestAnimationFrame(tick); else n.parentElement.classList.add("bump");
        };
        requestAnimationFrame(tick);
      }
    });
  });
}
function refreshReveal() {
  const st = getState(G), rd = sess(G).ready?.[readyKey(st)] || {}, pr = progress(G), last = roundInfo(G).isLast;
  if (!$("#board").dataset.anim) $("#board").innerHTML = boardHTML(ranking(G), myId);
  const base = last ? "Ver resultado final" : "Próxima rodada";
  $("#nextBtn").textContent = rd[myId] ? "Pronto, esperando os outros" : kickLeft != null ? `${base} (${kickLeft}s)` : base;
  $("#nextBtn").disabled = !!rd[myId];
  $("#status").textContent = last
    ? `${pr.done.length} de ${pr.need.length} prontos para o resultado final.`
    : `${pr.done.length} de ${pr.need.length} prontos para a próxima rodada. Quem não clicar segue automaticamente.`;
  const wb = $("#waitBox");
  if (wb) { wb.hidden = !rd[myId]; if (rd[myId]) wb.innerHTML = waitBoxHTML(last ? "prontos para o resultado final" : "prontos para a próxima rodada"); }
}

/* ---------- Final ---------- */
const CROWN = `<svg class="crown" viewBox="0 0 64 44" aria-hidden="true"><path d="M6 40 L4 10 L20 24 L32 4 L44 24 L60 10 L58 40 Z" fill="#ffd84d" stroke="#000" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="30" r="4" fill="#fff" stroke="#000" stroke-width="3"/></svg>`;
// Troféu 3D: fatias da silhueta giradas em volta do eixo formam um sólido que gira
const TROPHY = (() => {
  const shape = (fill, handles, star) => `
    ${handles ? `<path d="M12 12 C-1 12 -1 33 17 35 M48 12 C61 12 61 33 43 35" fill="none" stroke="${handles}" stroke-width="6" stroke-linecap="round"/>` : ""}
    <path d="M10 6 H50 V22 C50 38 41 46 30 46 C19 46 10 38 10 22 Z" fill="${fill}"/>
    <rect x="26" y="45" width="8" height="13" fill="${fill}"/>
    <rect x="17" y="57" width="26" height="7" rx="2" fill="${fill}"/>
    <rect x="12" y="64" width="36" height="14" rx="3" fill="${star ? "#6d4824" : "#4a2f15"}"/>
    ${star ? `<path d="M15 10 H22 C19 20 20 32 26 42 C17 38 14 26 15 10 Z" fill="#fff8d1" opacity=".75"/>
      <path d="M30 13 L33.5 21 L42 21.5 L35.5 27 L37.5 35 L30 30.5 L22.5 35 L24.5 27 L18 21.5 L26.5 21 Z" fill="#fff" stroke="#b77f00" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="18" y="67" width="24" height="7" rx="2" fill="#ffd84d"/>` : ""}`;
  // Camadas empilhadas na profundidade: frente/verso com desenho, miolo mais escuro (a "borda" do troféu)
  const layers = [];
  for (let z = -5; z <= 5; z += 1) {
    const face = Math.abs(z) === 5;
    layers.push(`<svg class="t-layer ${face ? "t-face" : ""}" style="transform: translateZ(${z}px)${z < 0 ? " rotateY(180deg)" : ""}" viewBox="0 0 60 84" aria-hidden="true">${face ? shape("#ffd84d", "#d99a00", true) : shape("#c48a00", "#a87400", false)}</svg>`);
  }
  return `<div class="trophy3d" aria-label="Troféu"><div class="t-spin">${layers.join("")}</div><div class="t-shadow"></div></div>`;
})();
const ptsLabel = (n) => `${n} pt${Math.abs(n) === 1 ? "" : "s"}`;

function podiumHTML(list) {
  // Mesma posição (empate que sobrou depois do desempate) = mesmo degrau
  const tiers = [];
  for (const r of list) {
    if (!tiers.length || tiers[tiers.length - 1][0].place !== r.place) tiers.push([]);
    tiers[tiers.length - 1].push(r);
  }
  const step = (tier, place) => !tier ? "" : `<div class="step s${place}">
    ${place === 1 ? CROWN : ""}
    <div class="step-people">${tier.map((r, k) => `<div class="pod-p" style="--k:${k}">
      ${avatar(r.p, r.id, place === 1 ? "av-lg" : "av-md")}
      <span class="pod-name">${esc(r.p.name)}${r.id === myId ? " <small>(você)</small>" : ""}</span>
      <span class="pod-pts">${ptsLabel(r.pts)}</span></div>`).join("")}</div>
    <div class="step-block"><span>${place}º</span>${place === 1 ? TROPHY : ""}</div>
  </div>`;
  let k = 0;
  const rest = tiers.slice(3).flatMap((tier) => tier.map((r) => `<li class="${r.id === myId ? "is-me" : ""}" style="--k:${k++}">
    <span class="pos">${r.place}º</span>${avatar(r.p, r.id, "av-sm")}
    <span class="p-name">${esc(r.p.name)}${r.id === myId ? " <small>(você)</small>" : ""}</span>
    <span class="pts">${ptsLabel(r.pts)}</span></li>`)).join("");
  return `<div class="podium">${step(tiers[1], 2)}${step(tiers[0], 1)}${step(tiers[2], 3)}</div>
    ${rest ? `<ol class="board rest">${rest}</ol>` : ""}`;
}
function tiebreakHTML(ties) {
  if (!ties.length) return "";
  return `<div class="tiebreak">
    <p class="tb-title">Como os empates foram decididos</p>
    <ul>${ties.map((t) => `<li><strong>${esc(joinNames(t.names))}</strong> fizeram ${esc(ptsLabel(t.pts))}. ${t.lines.map(esc).join(" ")}</li>`).join("")}</ul>
    <p class="tb-rule">Regra de desempate: com a mesma pontuação, fica na frente quem chegou a ela primeiro (pela ordem das rodadas e dos votos). Se ainda empatar, vale quem acertou o Problems verdadeiro mais vezes.</p>
  </div>`;
}

function buildFinal() {
  const st = getState(G), { list, ties } = standings(G);
  const top = list.length ? list[0].pts : 0;
  const winners = list.filter((r) => r.place === 1 && top > 0);
  const win = !winners.length ? "Ninguém terminou com pontos positivos."
    : winners.length === 1 ? `${winners[0].p.name} venceu com ${ptsLabel(top)}!`
    : `Empate no 1º lugar entre ${joinNames(winners.map((w) => w.p.name))} com ${ptsLabel(top)}!`;
  stage.innerHTML = `<section class="panel marked final-panel">
    <div class="podium-wrap" id="podiumWrap">
      <h1 class="screen-title final-title">Resultados</h1>
      <p class="lede win">${esc(win)}</p>
      ${list.length ? podiumHTML(list) : ""}
      ${tiebreakHTML(ties)}
    </div>
    <div class="actions center"><button class="btn btn-primary" id="againBtn"></button></div>
    <div class="wait-box center" id="waitBox" hidden aria-live="polite"></div>
    <p class="status center-text" id="status" role="status"></p>
  </section>`;
  $("#againBtn").addEventListener("click", () => {
    const st = getState(G);
    set(dbRef(`${sessPath(st)}/ready/${readyKey(st)}/${myId}`), true);
  });

  const seenKey = `qp.final.${st.session}`;
  let seen = false; try { seen = sessionStorage.getItem(seenKey) === "1"; } catch {}
  const wrap = $("#podiumWrap");
  const instant = () => { endSeq(); hideOverlay(); hideIris(); hideBars(); unlockScroll(); wrap.classList.add("play", "instant"); };
  if (seen || reduceMotion() || document.hidden) { instant(); return; }
  runSeq(() => { clearTimers(); try { sessionStorage.setItem(seenKey, "1"); } catch {} instant(); });
  lockScroll(true, 120000);
  // 1) troféu  2) histórico de pontos  3) barras pretas  4) RESULTADOS + íris  5) pódio
  const introMs = playTrophyIntro();
  let raceMs = 0;
  later(introMs, () => { raceMs = playRace(); later(raceMs, () => barsIn(() => {
    titleThenIris("RESULTADOS", () => {
    try { sessionStorage.setItem(seenKey, "1"); } catch {}
    window.scrollTo({ top: 0 });
  }, () => {
    endSeq();
    unlockScroll();
    wrap.classList.add("play");
    const first = wrap.querySelector(".step.s1");
    if (first) { later(1900, () => burst(first, 30)); later(2500, () => burst(first, 18)); }
    if (list.some((r) => r.id === myId && r.place === 1 && r.pts > 0)) later(2600, congrats);
  });
    barsOut();
  })); });
}

// Troféu gigante abrindo o fim de jogo
function playTrophyIntro() {
  showOverlay("trophy-intro", `<div class="ti">
    <div class="ti-rays"></div>
    <div class="ti-trophy" id="tiTrophy">${TROPHY}</div>
    <p class="ti-text">Fim de jogo!</p></div>`);
  later(650, () => { const t = $("#tiTrophy"); if (t) { burst(t, 30); later(350, () => burst(t, 20)); } });
  return 2600;
}
// Barras pretas entrando da esquerda para a direita, de baixo para cima
const bars = $("#bars");
function hideBars() { bars.hidden = true; bars.className = "bars"; }
function barsIn(then, dir = "up") {
  bars.hidden = false; bars.className = `bars in ${dir}`;
  later(950, then);
}
function barsOut() {
  bars.className = bars.className.replace(" in", " out");
  later(700, hideBars);
}

// Evolução das posições rodada a rodada (tela cheia, rápida e chamativa)
function playRace() {
  const rev = revealedRounds(G), final = standings(G).list;
  if (!final.length) return 0;
  const cum = {}, steps = [];
  const snap = (label, isFinal, gains) => {
    let rows;
    if (isFinal) rows = final.map((r) => ({ id: r.id, p: r.p, pts: r.pts, place: r.place }));
    else {
      rows = final.map((r) => ({ id: r.id, p: r.p, pts: cum[r.id] || 0 }));
      rows.sort((a, b) => b.pts - a.pts || a.p.name.localeCompare(b.p.name));
      let place = 0, prev = null;
      for (const r of rows) { if (r.pts !== prev) { place++; prev = r.pts; } r.place = place; }
    }
    steps.push({ label, rows, gains: gains || {} });
  };
  snap("Antes da primeira rodada", false);
  rev.forEach((n, i) => {
    const gains = roundPoints(G, n);
    for (const [id, v] of Object.entries(gains)) cum[id] = (cum[id] || 0) + v;
    snap(`Depois da rodada ${i + 1}`, i === rev.length - 1, gains);
  });
  const ROW = innerWidth < 560 ? 52 : 60;
  showOverlay("race", `<div class="race-card" id="raceCard">
    <p class="race-title">Como foi a partida</p>
    <p class="race-step" id="raceStep"></p>
    <div class="race-list" style="height:${final.length * ROW}px">${final.map((r) => `
      <div class="race-row" data-id="${esc(r.id)}" style="height:${ROW - 8}px">
        <span class="race-pos"></span>${avatar(r.p, r.id, "av-sm")}
        <span class="race-name">${esc(r.p.name)}${r.id === myId ? " <small>(você)</small>" : ""}</span>
        <span class="race-crown">${CROWN}</span>
        <span class="race-move"></span><span class="race-pts"></span>
      </div>`).join("")}</div>
  </div>`);
  const rowsEl = {};
  overlay.querySelectorAll(".race-row").forEach((el) => { rowsEl[el.dataset.id] = el; });
  let lastPos = {}, lastLead = null;
  const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const apply = (step, i) => {
    const label = $("#raceStep"); label.textContent = step.label; retrigger(label, "slam");
    if (i > 0) retrigger($("#raceCard"), "punch");
    const leadIds = step.rows.filter((r) => r.place === 1 && r.pts > 0).map((r) => r.id);
    step.rows.forEach((r, idx) => {
      const el = rowsEl[r.id]; if (!el) return;
      el.style.transform = `translateY(${idx * ROW}px)`;
      el.querySelector(".race-pos").textContent = `${r.place}º`;
      el.dataset.tier = i === 0 ? "" : r.place <= 3 && r.pts > 0 ? String(r.place) : "";
      const ptsEl = el.querySelector(".race-pts");
      ptsEl.textContent = `${r.pts} pt${Math.abs(r.pts) === 1 ? "" : "s"}`;
      const g = step.gains[r.id] || 0;
      if (g) {
        retrigger(ptsEl, "bump");
        const pop = document.createElement("span");
        pop.className = `race-gain ${g > 0 ? "pos" : "neg"}`;
        pop.textContent = `${g > 0 ? "+" : "−"}${Math.abs(g)}`;
        el.appendChild(pop); setTimeout(() => pop.remove(), 1100);
      }
      const mv = el.querySelector(".race-move"), before = lastPos[r.id];
      mv.className = "race-move"; mv.textContent = "";
      el.classList.remove("rise", "drop");
      if (i > 0 && before != null && before !== idx) {
        const up = before > idx;
        mv.classList.add(up ? "up" : "down"); mv.textContent = up ? `▲${before - idx}` : `▼${idx - before}`;
        void el.offsetWidth; el.classList.add(up ? "rise" : "drop");
      }
      el.classList.toggle("lead", leadIds.includes(r.id) && i > 0);
    });
    // Novo líder: estrelinhas no card
    const lead = leadIds.length === 1 ? leadIds[0] : null;
    if (i > 0 && lead && lead !== lastLead) { const el = rowsEl[lead]; if (el) burst(el, 18); }
    lastLead = lead;
    lastPos = Object.fromEntries(step.rows.map((r, idx) => [r.id, idx]));
  };
  apply(steps[0], 0);
  const STEP = 1300;
  steps.slice(1).forEach((step, k) => later(900 + k * STEP, () => apply(step, k + 1)));
  return 900 + Math.max(0, steps.length - 1) * STEP + 1300;
}
function refreshFinal() {
  const st = getState(G), rd = sess(G).ready?.[readyKey(st)] || {}, pr = progress(G);
  $("#againBtn").textContent = rd[myId] ? "Pronto, esperando os outros" : "Jogar de novo";
  $("#againBtn").disabled = !!rd[myId];
  $("#status").textContent = `${pr.done.length} de ${pr.need.length} querem jogar de novo.`;
  const wb = $("#waitBox");
  wb.hidden = !rd[myId];
  if (rd[myId]) wb.innerHTML = waitBoxHTML("prontos para voltar ao lobby");
}
