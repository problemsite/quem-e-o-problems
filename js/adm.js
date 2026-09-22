import {
  configOk, dbRef, onValue, set, update, remove, push,
  esc, rk, letter, PHASE_LABEL, toList, roundTitle, roundQuestions, isImage, resizeImageFit, getState, sess, validPlayers, byJoin, sortedForms,
  usedFormIds, defaultTrue, currentTrue, roundInfo, totalScores, progress, tryAdvance, resetGame, avatar
} from "./common.js";

const $ = (s) => document.querySelector(s);
let G = null, advancing = false;
const drafts = {}; // texto que o ADM está digitando e ainda não salvou

const TYPE_LABEL = { text: "Texto", choice: "Alternativas", photo: "Foto" };
const SAMPLE = {
  title: "Rodada de exemplo",
  questions: [
    { text: "Qual é a comida favorita do Problems?", type: "text" },
    { text: "Qual destes jogos o Problems mais joga?", type: "choice", options: ["Minecraft", "Roblox", "Fortnite", "Among Us"] },
    { text: "Mande uma foto do lugar onde o Problems grava", type: "photo" }
  ]
};

if (!configOk) {
  $("#admMain").innerHTML = `<section class="panel"><h2>Falta conectar o Firebase</h2>
    <p>Abra <code>js/firebase-config.js</code>, cole a configuração do seu projeto e publique de novo.</p></section>`;
} else {
  bind();
  onValue(dbRef(), (snap) => { G = snap.val() || {}; render(); });
}

setInterval(() => { if (G && getState(G).phase === "reveal") checkAdvance(); }, 3000);

function render() {
  renderGame(); renderTrue(); renderPlayers(); renderForms(); renderSpoiler();
  checkAdvance();
}
function checkAdvance() {
  if (!advancing && progress(G).canAdvance) {
    advancing = true;
    setTimeout(async () => { try { await tryAdvance(G); } catch {} advancing = false; }, 900);
  }
}

/* Re-renderiza sem perder o que está sendo digitado */
function patch(el, html) {
  const act = document.activeElement;
  const key = el.contains(act) ? act.dataset?.keep : null;
  const sel = key && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
  el.innerHTML = html;
  el.querySelectorAll("[data-keep]").forEach((n) => { if (n.dataset.keep in drafts) n.value = drafts[n.dataset.keep]; });
  if (key) {
    const n = el.querySelector(`[data-keep="${CSS.escape(key)}"]`);
    if (n) { n.focus(); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch {} }
  }
}

/* ---------- Partida ---------- */
function renderGame() {
  const st = getState(G), info = roundInfo(G), pr = progress(G), players = validPlayers(G);
  const R = st.rounds[rk(st.round)];
  const waiting = pr.need.filter((id) => !pr.done.includes(id)).map((id) => players[id]?.name || "?");
  $("#gameInfo").innerHTML = `
    <dl class="facts">
      <div><dt>Fase</dt><dd>${PHASE_LABEL[st.phase]}</dd></div>
      <div><dt>Rodada</dt><dd>${st.phase !== "lobby" ? `${st.round + 1} de ${info.total}` : Object.keys(st.rounds).length ? `Próxima: ${st.round + 1} de ${info.total}` : "Não começou"}</dd></div>
      <div><dt>Concordaram</dt><dd>${pr.done.length} de ${pr.need.length}</dd></div>
    </dl>
    ${R && st.phase !== "lobby" ? `<p class="adm-q">${esc(roundTitle(R, st.round))}</p>` : ""}
    ${pr.blocker ? `<p class="status">${esc(pr.blocker)}</p>` : ""}
    ${waiting.length ? `<p class="status">Esperando: ${esc(waiting.join(", "))}</p>` : ""}`;
  $("#forceBtn").textContent =
    st.phase === "lobby" ? "Começar a rodada sem esperar" :
    st.phase === "reveal" ? (info.isLast ? "Ir para o resultado final" : "Mandar todos ao lobby") :
    st.phase === "final" ? "Voltar ao lobby" : "Pular para a próxima fase";
}

/* ---------- Problems verdadeiro ---------- */
function renderTrue() {
  const players = validPlayers(G), ov = G.config?.trueOverride, manual = ov && players[ov] ? ov : null;
  const def = defaultTrue(players), cur = currentTrue(G);
  const row = (value, checked, inner) => `<li><label class="radio-row ${checked ? "checked" : ""}">
      <input type="radio" name="trueP" value="${esc(value)}" ${checked ? "checked" : ""}>${inner}</label></li>`;
  $("#trueList").innerHTML =
    row("", !manual, `<span class="grow"><strong>Automático</strong><br><small>${def ? `Agora: ${esc(players[def].name)}` : "Ninguém entrou com o nome Problems ainda"}</small></span>`) +
    byJoin(players).map((id) => row(id, manual === id,
      `${avatar(players[id], id, "av-sm")}<span class="grow"><strong>${esc(players[id].name)}</strong>${id === cur ? ` <span class="tag tag-true">atual</span>` : ""}</span>`
    )).join("");
}

/* ---------- Jogadores ---------- */
function renderPlayers() {
  const players = validPlayers(G), tot = totalScores(G), cur = currentTrue(G), ids = byJoin(players);
  $("#playerList").innerHTML = ids.length ? ids.map((id) => {
    const p = players[id], pts = tot[id] || 0;
    return `<li>${avatar(p, id, "av-sm")}
      <span class="grow"><strong>${esc(p.name)}</strong>${id === cur ? ` <span class="tag tag-true">Problems verdadeiro</span>` : ""}<br>
      <small><span class="dot ${p.online ? "on" : ""}"></span> ${p.online ? "online" : "offline"}, ${pts} pt${Math.abs(pts) === 1 ? "" : "s"}</small></span>
      <button class="icon-btn del" data-remove="${esc(id)}" aria-label="Remover ${esc(p.name)}">✕</button></li>`;
  }).join("") : `<li class="empty">Ninguém no lobby ainda.</li>`;
  $("#purgeBtn").hidden = !ids.some((id) => !players[id].online);
  $("#removeAllBtn").hidden = !ids.length;
}

/* ---------- Formulários ---------- */
function questionRow(f, q, j) {
  const opts = q.type === "choice" && q.options.length
    ? `<span class="q-opts">${q.options.map((o, k) => `<span><b>${letter(k)}</b> ${esc(o)}</span>`).join("")}</span>` : "";
  return `<li class="q-row">
    <span class="q-num">${j + 1}</span>
    <span class="grow">
      <span class="q-text">${esc(q.text)}</span>
      <span class="q-type tag ${q.type !== "text" ? "tag-ready" : ""}">${TYPE_LABEL[q.type]}</span>
      ${opts}
      <span class="q-imgline">
        ${q.image ? `<img class="q-thumb" src="${esc(q.image)}" alt="Foto da pergunta">` : ""}
        <label class="link-btn"><input type="file" accept="image/*" class="sr-only" data-qimg="${esc(f.id)}" data-qid="${esc(q.id)}">${q.image ? "Trocar foto" : "Pôr foto na pergunta"}</label>
        ${q.image ? `<button class="link-btn" data-qimgdel="${esc(f.id)}" data-qid="${esc(q.id)}">Tirar foto</button>` : ""}
      </span>
    </span>
    <span class="q-tools">
      <button class="icon-btn" data-qmove="${esc(f.id)}" data-j="${j}" data-dir="-1" ${j === 0 ? "disabled" : ""} aria-label="Subir pergunta">↑</button>
      <button class="icon-btn" data-qmove="${esc(f.id)}" data-j="${j}" data-dir="1" ${j === f.questions.length - 1 ? "disabled" : ""} aria-label="Descer pergunta">↓</button>
      <button class="icon-btn del" data-qdel="${esc(f.id)}" data-qid="${esc(q.id)}" aria-label="Remover pergunta">✕</button>
    </span>
  </li>`;
}
function addBlock(f) {
  const id = esc(f.id), type = drafts[`type-${f.id}`] || "text", img = drafts[`img-${f.id}`];
  const hint = { text: "Resposta escrita. Uma pergunta por linha adiciona várias de uma vez.",
    choice: "Os jogadores escolhem uma alternativa. Preencha pelo menos duas.",
    photo: "Os jogadores respondem enviando uma foto." }[type];
  return `<div class="fb-add" data-type="${type}">
    <p class="fb-sub">Nova pergunta</p>
    <div class="type-pick" role="radiogroup" aria-label="Tipo de resposta">
      ${["text", "choice", "photo"].map((t) => `<label class="${type === t ? "on" : ""}"><input type="radio" class="sr-only" name="type-${id}" value="${t}" data-qtype="${id}" ${type === t ? "checked" : ""}>${{ text: "Texto", choice: "Alternativas (A, B, C, D)", photo: "Foto" }[t]}</label>`).join("")}
    </div>
    <p class="fb-hint">${hint}</p>
    <textarea rows="2" data-keep="newq-${id}" data-newq="${id}" placeholder="Escreva a pergunta" aria-label="Texto da pergunta"></textarea>
    <div class="opts">${[0, 1, 2, 3].map((k) => `<label class="opt"><span class="choice-letter">${letter(k)}</span>
      <input type="text" maxlength="80" data-keep="opt-${id}-${k}" placeholder="Alternativa ${letter(k)}"></label>`).join("")}</div>
    <div class="img-pick">
      ${isImage(img) ? `<img class="q-thumb" src="${esc(img)}" alt="Foto escolhida"><button class="link-btn" data-newimgdel="${id}">Tirar foto</button>` : ""}
      <label class="link-btn"><input type="file" accept="image/*" class="sr-only" data-newimg="${id}">${isImage(img) ? "Trocar foto" : "Pôr uma foto na pergunta (opcional)"}</label>
    </div>
    <div class="actions"><button class="btn btn-primary" data-addq="${id}">Adicionar pergunta</button></div>
  </div>`;
}
function renderForms() {
  const forms = sortedForms(G), used = usedFormIds(G);
  $("#fCount").textContent = forms.length ? `(${forms.length})` : "";
  $("#sampleBtn").hidden = forms.length > 0;
  patch($("#formList"), forms.length ? forms.map((f, i) => `
    <article class="form-block">
      <div class="fb-head">
        <span class="fb-num" title="Rodada ${i + 1}">${i + 1}</span>
        <input type="text" class="fb-title" maxlength="60" data-keep="title-${esc(f.id)}" data-title="${esc(f.id)}"
          value="${esc(f.title)}" placeholder="Rodada ${i + 1}" aria-label="Nome do formulário ${i + 1}">
        <div class="fb-tools">
          <button class="icon-btn" data-fmove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir formulário">↑</button>
          <button class="icon-btn" data-fmove="${i}" data-dir="1" ${i === forms.length - 1 ? "disabled" : ""} aria-label="Descer formulário">↓</button>
          <button class="icon-btn del" data-fdel="${esc(f.id)}" aria-label="Apagar formulário">✕</button>
        </div>
      </div>
      <div class="fb-meta">
        <span class="tag">${f.questions.length} pergunta${f.questions.length === 1 ? "" : "s"}</span>
        ${used.has(f.id) ? `<span class="tag tag-ready">já usado nesta partida</span>` : ""}
        ${!f.questions.length ? `<span>Sem perguntas, então esse formulário é pulado.</span>` : ""}
      </div>
      ${f.questions.length ? `<p class="fb-sub">Perguntas</p><ol class="rows">${f.questions.map((q, j) => questionRow(f, q, j)).join("")}</ol>` : ""}
      ${addBlock(f)}
    </article>`).join("") : `<p class="empty-note">Nenhum formulário ainda. Crie um acima ou use o de exemplo.</p>`);
}

const cleanQ = (q, order) => {
  const out = { text: String(q.text).slice(0, 200), type: q.type || "text", order };
  if (out.type === "choice") out.options = (q.options || []).map((o) => String(o).trim().slice(0, 80)).filter(Boolean);
  if (isImage(q.image)) out.image = q.image;
  return out;
};
async function createForm(title, questions = []) {
  const forms = sortedForms(G);
  const fid = push(dbRef("forms")).key;
  const qs = {};
  questions.forEach((q, i) => { qs[push(dbRef("forms")).key] = cleanQ(typeof q === "string" ? { text: q } : q, i + 1); });
  await set(dbRef(`forms/${fid}`), {
    title: (title || "").slice(0, 60),
    order: (forms.length ? forms[forms.length - 1].order : 0) + 1,
    questions: qs
  });
}
async function addQuestions(fid, items) {
  const f = sortedForms(G).find((x) => x.id === fid); if (!f) return;
  let order = (f.questions.length ? f.questions[f.questions.length - 1].order : 0) + 1;
  const upd = {};
  for (const q of items) upd[`forms/${fid}/questions/${push(dbRef("forms")).key}`] = cleanQ(q, order++);
  await update(dbRef(), upd);
}
async function swap(pathA, pathB, a, b, dir) {
  const oa = a.order, ob = a.order === b.order ? b.order + dir : b.order;
  await update(dbRef(), { [`${pathA}/order`]: ob, [`${pathB}/order`]: oa });
}

/* ---------- Limpeza de dados ---------- */
// Remove a pessoa e tudo dela no banco (respostas, votos, escolhas, prontos) de todas as partidas
function cleanupFor(ids) {
  const upd = {};
  for (const id of ids) {
    upd[`players/${id}`] = null;
    for (const [g, data] of Object.entries(G.s || {})) {
      for (const kind of ["answers", "votes", "voteAt", "picks", "ready"]) {
        for (const k of Object.keys(data?.[kind] || {})) upd[`s/${g}/${kind}/${k}/${id}`] = null;
      }
    }
    if (G.config?.trueOverride === id) upd["config/trueOverride"] = null;
  }
  return upd;
}
const freshLobby = () => ({ phase: "lobby", round: 0, session: getState(G).session + 1 });

/* ---------- Spoiler ---------- */
function answerText(q, a) {
  if (q.type === "photo") return isImage(a) ? `<img class="q-thumb big" src="${esc(a)}" alt="Foto enviada">` : "(sem foto)";
  if (q.type === "choice") { const k = q.options.indexOf(a); return `${k >= 0 ? `<b>${letter(k)}</b> ` : ""}${esc(a)}`; }
  return esc(a);
}
function renderSpoiler() {
  const st = getState(G);
  const n = st.phase === "lobby" ? st.round - 1 : st.round;
  if (n < 0) { $("#spoilBody").innerHTML = `<p>A partida ainda não começou.</p>`; return; }
  const S = sess(G), R = st.rounds[rk(n)] || {}, players = validPlayers(G);
  const ans = S.answers?.[rk(n)] || {}, votes = S.votes?.[rk(n)] || {}, qs = roundQuestions(R);
  const name = (id) => esc(players[id]?.name || "?");
  const a = Object.keys(ans).map((id) => {
    const list = toList(ans[id]);
    return `<li><span class="grow"><strong>${name(id)}</strong>${id === R.trueId ? ` <span class="tag tag-true">verdadeiro</span>` : ""}
      <span class="spoil-qa">${qs.map((q, i) => `<span class="spoil-q">${esc(q.text)}</span><span class="spoil-a">${answerText(q, list[i] || "")}</span>`).join("")}</span></span></li>`;
  }).join("");
  const v = Object.keys(votes).map((id) => `<li><span class="grow">${name(id)} votou em <strong>${name(votes[id])}</strong></span></li>`).join("");
  $("#spoilBody").innerHTML = `<p class="adm-q">${esc(roundTitle(R, n))}</p>
    <ul class="rows">${a || `<li class="empty">Ninguém enviou ainda.</li>`}</ul>
    ${v ? `<ul class="rows">${v}</ul>` : ""}`;
}

/* ---------- Eventos ---------- */
function bind() {
  $("#forceBtn").addEventListener("click", async () => {
    if (!confirm("Avançar sem esperar todo mundo concordar?")) return;
    const ok = await tryAdvance(G, { force: true });
    if (!ok) alert(progress(G).blocker || "Não foi possível avançar agora.");
  });
  $("#resetBtn").addEventListener("click", async () => {
    if (!confirm("Reiniciar a partida? Respostas, votos e pontos somem. Jogadores e formulários continuam.")) return;
    await resetGame(G);
  });

  $("#trueList").addEventListener("change", async (e) => {
    if (e.target.name !== "trueP") return;
    const id = e.target.value || null;
    await set(dbRef("config/trueOverride"), id);
    const st = getState(G);
    if (st.phase === "answering" || st.phase === "voting") {
      const t = id || defaultTrue(validPlayers(G));
      if (t) await set(dbRef(`state/rounds/${rk(st.round)}/trueId`), t);
    }
  });

  $("#playerList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-remove]"); if (!b) return;
    const id = b.dataset.remove, p = validPlayers(G)[id];
    if (!confirm(`Remover ${p?.name || "este jogador"} do lobby?`)) return;
    await update(dbRef(), cleanupFor([id]));
  });
  $("#purgeBtn").addEventListener("click", async () => {
    const players = validPlayers(G);
    const ids = Object.keys(G.players || {}).filter((id) => !players[id] || !players[id].online);
    if (ids.length) await update(dbRef(), cleanupFor(ids));
  });
  $("#removeAllBtn").addEventListener("click", async () => {
    if (!confirm("Remover todos os jogadores? Isso apaga fotos, respostas, votos e pontos do Firebase e volta ao lobby.")) return;
    await update(dbRef(), { players: null, s: null, "config/trueOverride": null, state: freshLobby() });
  });
  $("#clearBtn").addEventListener("click", async () => {
    if (!confirm("Limpar histórico? Todas as respostas, votos e pontos saem do Firebase e o jogo volta ao lobby.")) return;
    await update(dbRef(), { s: null, state: freshLobby() });
  });

  $("#newForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await createForm($("#newTitle").value.trim());
    $("#newTitle").value = "";
  });
  $("#sampleBtn").addEventListener("click", () => createForm(SAMPLE.title, SAMPLE.questions));

  const list = $("#formList");
  const readImage = async (file) => {
    try { return await resizeImageFit(file, 720, 0.8); }
    catch { alert("Não deu para ler essa imagem. Tente um JPG ou PNG."); return null; }
  };
  list.addEventListener("input", (e) => { if (e.target.dataset.keep) drafts[e.target.dataset.keep] = e.target.value; });
  list.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.title) {
      await set(dbRef(`forms/${t.dataset.title}/title`), t.value.trim().slice(0, 60));
      delete drafts[t.dataset.keep];
      return;
    }
    if (t.dataset.qtype) { drafts[`type-${t.dataset.qtype}`] = t.value; renderForms(); return; }
    if (t.dataset.newimg && t.files?.[0]) {
      const img = await readImage(t.files[0]);
      if (img) { drafts[`img-${t.dataset.newimg}`] = img; renderForms(); }
      return;
    }
    if (t.dataset.qimg && t.files?.[0]) {
      const img = await readImage(t.files[0]);
      if (img) await set(dbRef(`forms/${t.dataset.qimg}/questions/${t.dataset.qid}/image`), img);
    }
  });
  list.addEventListener("keydown", (e) => {
    if (e.target.dataset.title && e.key === "Enter") e.target.blur();
    if (e.target.dataset.newq && e.key === "Enter" && (e.ctrlKey || e.metaKey)) list.querySelector(`[data-addq="${CSS.escape(e.target.dataset.newq)}"]`)?.click();
  });
  list.addEventListener("click", async (e) => {
    const forms = sortedForms(G);
    const add = e.target.closest("[data-addq]");
    if (add) {
      const fid = add.dataset.addq, type = drafts[`type-${fid}`] || "text", image = drafts[`img-${fid}`];
      const raw = (drafts[`newq-${fid}`] || "").trim();
      if (!raw) { alert("Escreva a pergunta primeiro."); return; }
      let items;
      if (type === "choice") {
        const options = [0, 1, 2, 3].map((k) => (drafts[`opt-${fid}-${k}`] || "").trim()).filter(Boolean);
        if (options.length < 2) { alert("Preencha pelo menos duas alternativas."); return; }
        if (new Set(options).size !== options.length) { alert("As alternativas precisam ser diferentes."); return; }
        items = [{ text: raw, type, options, image }];
      } else if (type === "photo" || image) {
        items = [{ text: raw, type, image }];
      } else {
        items = raw.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text, type }));
      }
      for (const k of Object.keys(drafts)) if (k.endsWith(fid) && !k.startsWith("title-") || k.startsWith(`opt-${fid}-`)) delete drafts[k];
      drafts[`type-${fid}`] = type;
      await addQuestions(fid, items);
      renderForms();
      return;
    }
    const nd = e.target.closest("[data-newimgdel]");
    if (nd) { delete drafts[`img-${nd.dataset.newimgdel}`]; renderForms(); return; }
    const qid = e.target.closest("[data-qimgdel]");
    if (qid) { await remove(dbRef(`forms/${qid.dataset.qimgdel}/questions/${qid.dataset.qid}/image`)); return; }
    const fdel = e.target.closest("[data-fdel]");
    if (fdel) {
      const f = forms.find((x) => x.id === fdel.dataset.fdel);
      if (confirm(`Apagar o formulário "${f?.title || "sem nome"}" e todas as perguntas dele?`)) await remove(dbRef(`forms/${fdel.dataset.fdel}`));
      return;
    }
    const fm = e.target.closest("[data-fmove]");
    if (fm) {
      const i = Number(fm.dataset.fmove), dir = Number(fm.dataset.dir), a = forms[i], b = forms[i + dir];
      if (a && b) await swap(`forms/${a.id}`, `forms/${b.id}`, a, b, dir);
      return;
    }
    const qm = e.target.closest("[data-qmove]");
    if (qm) {
      const f = forms.find((x) => x.id === qm.dataset.qmove); if (!f) return;
      const j = Number(qm.dataset.j), dir = Number(qm.dataset.dir), a = f.questions[j], b = f.questions[j + dir];
      if (a && b) await swap(`forms/${f.id}/questions/${a.id}`, `forms/${f.id}/questions/${b.id}`, a, b, dir);
      return;
    }
    const qd = e.target.closest("[data-qdel]");
    if (qd && confirm("Remover esta pergunta?")) await remove(dbRef(`forms/${qd.dataset.qdel}/questions/${qd.dataset.qid}`));
  });
}
