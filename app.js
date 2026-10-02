/* ============================================================
   Memoriza · RVR60 — Lógica de la aplicación
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- utilidades DOM ---------------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const screens = {
    home: $("#screen-home"),
    quiz: $("#screen-quiz"),
    results: $("#screen-results"),
    library: $("#screen-library"),
  };

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- persistencia ---------------- */
  const STORE_KEY = "rvr60_memoriza_v1";
  const defaultState = () => ({
    points: 0,
    streak: 0,
    plays: 0,
    // mastery[ref] = { g: giros exitosos, t: intentos, m: 1 dominado }
    mastery: {},
    lastDay: null,
    dailyDone: false,
  });

  let state;
  try {
    state = Object.assign(defaultState(), JSON.parse(localStorage.getItem(STORE_KEY)) || {});
    if (!state.mastery) state.mastery = {};
  } catch (e) {
    state = defaultState();
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }
  if (state.lastDay !== todayKey()) {
    state.lastDay = todayKey();
    state.dailyDone = false;
  }

  /* ---------------- categorías / pool ---------------- */
  // deduplicar por referencia (la misma categoría puede repetir versículos)
  const seenRefs = new Set();
  const verses = VERSES.map(([ref, text, cat]) => ({ ref, text, cat: cat.trim() })).filter(
    (v) => (seenRefs.has(v.ref) ? false : (seenRefs.add(v.ref), true))
  );
  const byRef = Object.fromEntries(verses.map((v) => [v.ref, v]));
  let selectedCats = new Set(CATEGORIES);

  function pool() {
    return verses.filter((v) => selectedCats.has(v.cat));
  }

  /* ---------------- helpers ---------------- */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function stripAccents(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function norm(s) {
    return stripAccents(String(s).toLowerCase())
      .replace(/[.,;:¡!¿?"'()«»“”]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    return 1 - levenshtein(a, b) / max;
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function shuffleWords(text) {
    const words = text.split(/\s+/);
    return shuffle(words);
  }

  /* ============================================================
     HOME
     ============================================================ */
  function renderHomeStats() {
    const mastered = Object.values(state.mastery).filter((m) => m.m).length;
    $("#hs-total").textContent = verses.length;
    $("#hs-mastered").textContent = mastered;
    $("#hs-streak").textContent = state.streak;
    $("#hs-points").textContent = state.points;
  }

  function renderChips() {
    const wrap = $("#cat-chips");
    wrap.innerHTML = "";
    CATEGORIES.forEach((c) => {
      const chip = el("button", "chip" + (selectedCats.has(c) ? " on" : ""), c);
      chip.type = "button";
      chip.onclick = () => {
        if (selectedCats.has(c)) {
          if (selectedCats.size <= 1) {
            toast("Debe quedar al menos una categoría activa.");
            return;
          }
          selectedCats.delete(c);
        } else selectedCats.add(c);
        renderChips();
      };
      wrap.appendChild(chip);
    });
    const all = el("button", "chip", "Todas");
    all.type = "button";
    if (selectedCats.size === CATEGORIES.length) all.classList.add("on");
    all.onclick = () => {
      selectedCats = new Set(CATEGORIES);
      renderChips();
    };
    wrap.appendChild(all);
  }

  $$(".mode-card").forEach((card) => {
    card.addEventListener("click", () => startGame(card.dataset.mode));
  });

  $("#btn-daily").addEventListener("click", () => {
    if (state.dailyDone) {
      toast("Ya completaste el reto de hoy. ¡Vuelve mañana! 🌙");
      return;
    }
    startGame("daily");
  });

  $("#btn-reset").addEventListener("click", () => {
    if (confirm("¿Seguro que quieres borrar todo tu progreso?")) {
      state = defaultState();
      state.lastDay = todayKey();
      save();
      renderHomeStats();
      toast("Progreso reiniciado.");
    }
  });

  /* ============================================================
     JUEGO
     ============================================================ */
  const MODES = {
    choice: { label: "Opción múltiple", total: 10, kind: "choice" },
    reference: { label: "¿Qué versículo es?", total: 10, kind: "reference" },
    write: { label: "Escribe el texto", total: 8, kind: "write" },
    fill: { label: "Completa la frase", total: 10, kind: "fill" },
    flash: { label: "Tarjetas de estudio", total: 12, kind: "flash" },
    speed: { label: "Ráfaga relámpago", total: 15, kind: "speed" },
    daily: { label: "Reto del día", total: 10, kind: "daily" },
  };

  let game = null;
  let timerId = null;

  function startGame(modeKey) {
    const cfg = MODES[modeKey];
    const p = pool();
    if (p.length < 4) {
      toast("Selecciona al menos 4 versículos (más categorías) para jugar.");
      return;
    }
    // orden de preguntas: prioriza no dominados y los que menos se han visto
    const ordered = shuffle(p).sort((a, b) => {
      const ma = state.mastery[a.ref] || { t: 0, m: 0 };
      const mb = state.mastery[b.ref] || { t: 0, m: 0 };
      if (ma.m !== mb.m) return ma.m - mb.m;
      return ma.t - mb.t;
    });

    let total = cfg.total;
    if (modeKey === "daily") {
      total = Math.min(10, p.length);
    }
    total = Math.min(total, p.length);

    game = {
      mode: modeKey,
      kind: cfg.kind === "daily" ? "daily" : cfg.kind,
      label: cfg.label,
      queue: ordered,
      total,
      idx: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      points: 0,
      missed: [],
      answered: false,
      speed: modeKey === "speed",
      time: modeKey === "speed" ? 45 : 0,
      startTime: Date.now(),
      flashRevealed: false,
    };

    $("#mode-label").textContent = cfg.label;
    $("#pill-timer").classList.toggle("show", game.speed);
    $("#pill-timer").classList.remove("low");
    $("#pill-timer").textContent = "45s";
    $("#btn-giveup").style.display = game.kind === "flash" ? "none" : "";
    updateHUD();

    clearInterval(timerId);
    if (game.speed) {
      timerId = setInterval(() => {
        game.time--;
        const pill = $("#pill-timer");
        pill.textContent = game.time + "s";
        pill.classList.toggle("low", game.time <= 10);
        if (game.time <= 0) {
          clearInterval(timerId);
          endGame();
        }
      }, 1000);
    }

    show("quiz");
    nextQuestion();
  }

  function updateHUD() {
    const shown = Math.min(game.idx + 1, game.total);
    $("#qp-text").textContent = `${shown} / ${game.total}`;
    $("#qp-fill").style.width = ((game.idx / game.total) * 100).toFixed(1) + "%";
    $("#pill-streak").textContent = "🔥 " + game.streak;
    $("#pill-pts").textContent = game.points + " pts";
  }

  function hideBlocks() {
    $$(".q-block").forEach((b) => b.classList.remove("active"));
    $("#feedback").classList.add("hidden");
  }

  function currentVerse() {
    return game.queue[game.idx % game.queue.length];
  }

  function distractors(correct, n, keyFn) {
    const others = shuffle(verses.filter((v) => v.ref !== correct.ref && v.cat === correct.cat));
    const rest = shuffle(verses.filter((v) => v.ref !== correct.ref && v.cat !== correct.cat));
    const list = others.concat(rest);
    const seen = new Set([keyFn(correct)]);
    const out = [];
    for (const v of list) {
      const k = keyFn(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
      if (out.length >= n) break;
    }
    return out;
  }

  function nextQuestion() {
    if (game.idx >= game.total) {
      endGame();
      return;
    }
    game.answered = false;
    game.flashRevealed = false;
    hideBlocks();
    updateHUD();

    // los modos mixtos rotan entre tipos
    let kind = game.kind;
    if (kind === "daily") {
      const rotation = ["choice", "reference", "fill", "choice", "write", "reference", "choice", "fill", "flash", "choice"];
      kind = rotation[game.idx % rotation.length];
      if (kind === "write" && game.idx > 0 && Math.random() < 0.5) kind = "choice";
    }
    if (game.speed) {
      kind = Math.random() < 0.6 ? "choice" : Math.random() < 0.5 ? "reference" : "fill";
    }

    const v = currentVerse();
    game.currentKind = kind;
    const tag = $("#q-category-tag");
    if (tag) {
      tag.textContent = v.cat ? "· " + v.cat + " ·" : "";
      tag.style.cssText =
        "position:static;pointer-events:auto;text-align:center;color:var(--muted);font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:16px;opacity:.9";
    }
    renderQuestion(v, kind);
  }

  function renderQuestion(v, kind) {
    const block = $("#q-block-" + kind);
    if (!block) return;
    block.classList.add("active");

    if (kind === "choice") {
      $("#q-prompt-choice").innerHTML = `¿Cuál es el texto correcto?<span class="ref">${v.ref}</span>`;
      const wrap = $("#options-choice");
      wrap.innerHTML = "";
      const opts = shuffle([v, ...distractors(v, 3, (x) => x.text)]);
      opts.forEach((o, i) => {
        const btn = el("button", "opt", `<span class="key">${"ABCD"[i]}</span>${o.text}`);
        btn.onclick = () => answerChoice(btn, wrap, o.ref === v.ref, v);
        wrap.appendChild(btn);
      });
    }

    if (kind === "reference") {
      $("#q-verse-ref").textContent = `“${v.text}”`;
      const wrap = $("#options-reference");
      wrap.innerHTML = "";
      const opts = shuffle([v, ...distractors(v, 3, (x) => x.ref)]);
      opts.forEach((o) => {
        const btn = el("button", "opt", o.ref);
        btn.onclick = () => answerChoice(btn, wrap, o.ref === v.ref, v);
        wrap.appendChild(btn);
      });
    }

    if (kind === "fill") {
      const words = v.text.split(/\s+/);
      const idxs = words.map((w, i) => (w.replace(/[.,;:¡!¿?"']/g, "").length >= 5 ? i : -1)).filter((i) => i >= 0);
      const target = idxs.length ? idxs[Math.floor(Math.random() * idxs.length)] : Math.min(3, words.length - 1);
      const answer = words[target];
      const before = words.slice(0, target).join(" ");
      const after = words.slice(target + 1).join(" ");
      $("#q-prompt-fill").innerHTML =
        `${before} <span style="color:var(--gold)">______</span> ${after}<span class="ref">${v.ref}</span>`;
      const wrap = $("#options-fill");
      wrap.innerHTML = "";
      const poolWords = shuffle(
        verses
          .filter((x) => x.ref !== v.ref)
          .flatMap((x) => x.text.split(/\s+/))
          .filter((w) => w.replace(/[.,;:¡!¿?"']/g, "").length >= 4 && w !== answer)
      );
      const wrong = [];
      for (const w of poolWords) {
        if (wrong.length >= 3) break;
        if (norm(w) !== norm(answer) && !wrong.some((x) => norm(x) === norm(w))) wrong.push(w);
      }
      const opts = shuffle([answer, ...wrong]);
      opts.forEach((w) => {
        const btn = el("button", "opt", w);
        btn.onclick = () => answerChoice(btn, wrap, norm(w) === norm(answer), v);
        wrap.appendChild(btn);
      });
    }

    if (kind === "write") {
      $("#q-prompt-write").innerHTML = `Escribe este versículo:<span class="ref">${v.ref}</span>`;
      const ta = $("#write-input");
      ta.value = "";
      ta.classList.remove("good", "bad");
      $("#write-hint").textContent =
        "Pista: se ignoran mayúsculas, tildes y puntuación. Similitud mínima 80%.";
      const old = $("#write-result");
      if (old) old.remove();
      setTimeout(() => ta.focus(), 60);
    }

    if (kind === "flash") {
      $("#flash-front").innerHTML = `<small>${v.ref}</small><div>${v.cat}</div><div style="font-size:13px;color:var(--muted)">Toca para girar</div>`;
      $("#flash-back").innerHTML = `<div>“${v.text}”</div><div class="ref">${v.ref}</div>`;
      $("#flash-card").classList.remove("flipped");
      $("#btn-flash-reveal").classList.remove("hidden");
      $("#flash-grade").classList.add("hidden");
    }
  }

  /* ---- respuesta opción/fill ---- */
  function answerChoice(btn, wrap, ok, correctVerse) {
    if (game.answered) return;
    game.answered = true;
    Array.from(wrap.children).forEach((b) => (b.disabled = true));
    btn.classList.add(ok ? "correct" : "wrong");
    if (!ok) {
      // resaltar la opción correcta no elegida
      Array.from(wrap.children).forEach((b) => {
        if (b.textContent.includes(correctVerse.ref) || b.textContent.includes(correctVerse.text)) {
          b.classList.add("reveal");
        }
      });
    }
    registerAnswer(ok, correctVerse, btn);
  }

  /* ---- respuesta escrita ---- */
  function checkWrite() {
    if (game.answered) return;
    const v = currentVerse();
    const input = $("#write-input").value.trim();
    if (!input) {
      toast("Escribe algo antes de comprobar ✍️");
      return;
    }
    game.answered = true;
    const sim = similarity(norm(input), norm(v.text));
    const ok = sim >= 0.8;
    let res = $("#write-result");
    if (!res) {
      res = el("div", "write-result");
      $("#q-block-write").appendChild(res);
    }
    res.className = "write-result " + (ok ? "good" : "bad");
    const pct = Math.round(sim * 100);
    res.innerHTML =
      (ok ? "✅ ¡Casi perfecto!" : "❌ Aún no es suficiente") +
      ` — coincidencia <b>${pct}%</b>` +
      `<span class="expected">${v.ref}: “${v.text}”</span>`;
    $("#btn-check-write").disabled = true;
    $("#btn-skip-write").disabled = true;
    setTimeout(() => {
      $("#btn-check-write").disabled = false;
      $("#btn-skip-write").disabled = false;
      registerAnswer(ok, v, null);
    }, ok ? 700 : 2400);
  }

  $("#btn-check-write").addEventListener("click", checkWrite);
  $("#write-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      checkWrite();
    }
  });
  $("#btn-skip-write").addEventListener("click", () => {
    if (game.answered) return;
    game.answered = true;
    registerAnswer(false, currentVerse(), null);
  });

  /* ---- flashcards ---- */
  function flipCard() {
    const card = $("#flash-card");
    card.classList.toggle("flipped");
    if (card.classList.contains("flipped")) {
      game.flashRevealed = true;
      $("#btn-flash-reveal").classList.add("hidden");
      $("#flash-grade").classList.remove("hidden");
    }
  }
  $("#flash-card").addEventListener("click", flipCard);
  $("#btn-flash-reveal").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!game.flashRevealed) flipCard();
  });
  $$("#flash-grade .btn").forEach((b) => {
    b.addEventListener("click", () => {
      const grade = Number(b.dataset.grade);
      const v = currentVerse();
      if (grade === 2) {
        registerAnswer(true, v, null, 1.4);
      } else if (grade === 1) {
        registerAnswer(true, v, null, 0.8);
      } else {
        registerAnswer(false, v, null, 0.3);
      }
    });
  });

  /* ---- registro de respuesta ---- */
  function registerAnswer(ok, verse, btnEl, mult) {
    mult = mult === undefined ? 1 : mult;
    const m = state.mastery[verse.ref] || (state.mastery[verse.ref] = { g: 0, t: 0, m: 0 });
    m.t++;
    if (ok) {
      m.g++;
      if (m.g >= 3) m.m = 1;
      game.correct++;
      game.streak++;
      game.bestStreak = Math.max(game.bestStreak, game.streak);
      const gain = Math.round((10 + game.streak * 2 + (game.speed ? 5 : 0)) * mult);
      game.points += gain;
      state.points += gain;
    } else {
      m.g = Math.max(0, m.g - 1);
      if (m.g < 3) m.m = 0;
      game.wrong++;
      game.streak = 0;
      if (!game.missed.some((x) => x.ref === verse.ref)) game.missed.push(verse);
      if (game.speed) game.time = Math.max(0, game.time - 4);
    }
    save();
    updateHUD();
    showFeedback(ok, verse);
  }

  function showFeedback(ok, verse) {
    const fb = $("#feedback");
    fb.classList.remove("hidden");
    $("#fb-head").textContent = ok
      ? ["¡Correcto! 🎯", "¡Excelente! 🌟", "¡Perfecto! 🏆"][Math.floor(Math.random() * 3)]
      : "Esta es la respuesta correcta:";
    $("#fb-head").className = "fb-head " + (ok ? "ok" : "bad");
    $("#fb-verse").innerHTML = `“${verse.text}”<span class="ref">${verse.ref} · ${verse.cat}</span>`;
    fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  $("#btn-next").addEventListener("click", () => {
    game.idx++;
    nextQuestion();
  });

  $("#btn-giveup").addEventListener("click", () => {
    if (!game || game.answered) return;
    if (confirm("¿Rendirte en esta partida? Se verá el resultado.")) endGame();
  });

  $("#btn-exit").addEventListener("click", () => {
    clearInterval(timerId);
    if (game && game.idx > 0 && !confirm("Salir de la partida actual. ¿Continuar?")) return;
    game = null;
    show("home");
    renderHomeStats();
    renderChips();
  });

  /* ---- fin de partida ---- */
  function endGame() {
    clearInterval(timerId);
    const answered = game.correct + game.wrong;
    const pct = answered ? Math.round((game.correct / answered) * 100) : 0;
    const seconds = Math.round((Date.now() - game.startTime) / 1000);
    const xp = Math.round(game.points * 1.5);

    state.plays++;
    save();

    const emoji = pct >= 90 ? "🏆" : pct >= 70 ? "🌟" : pct >= 50 ? "💪" : "📖";
    const title = pct >= 90 ? "¡Dominio divino!" : pct >= 70 ? "¡Muy bien!" : pct >= 50 ? "¡Buen intento!" : "Sigue practicando";
    $("#res-emoji").textContent = emoji;
    $("#res-title").textContent = title;
    $("#res-score").textContent = pct + "%";
    $("#res-grid").innerHTML = `
      <div class="rstat"><b>${game.correct}</b><span>aciertos</span></div>
      <div class="rstat"><b>${game.wrong}</b><span>errores</span></div>
      <div class="rstat"><b>${game.bestStreak}</b><span>racha máx.</span></div>
      <div class="rstat"><b>${seconds}s</b><span>tiempo</span></div>`;
    $("#res-xp").textContent = `+${game.points} puntos · +${xp} XP de progreso`;

    const list = $("#missed-list");
    list.innerHTML = "";
    if (game.missed.length) {
      $("#missed-wrap").style.display = "";
      game.missed.forEach((v) => {
        list.appendChild(el("li", "", `<span class="ref">${v.ref}</span> ${v.text}`));
      });
    } else {
      $("#missed-wrap").style.display = "none";
    }

    if (game.mode === "daily" && !state.dailyDone) {
      state.dailyDone = true;
      state.points += 50;
      save();
      $("#res-xp").textContent += " · +50 por el reto diario 📅";
    }

    game._lastMode = game.mode;
    show("results");
    renderHomeStats();
  }

  $("#btn-again").addEventListener("click", () => startGame((game && game._lastMode) || "choice"));
  $("#btn-home").addEventListener("click", () => {
    game = null;
    show("home");
    renderHomeStats();
    renderChips();
  });

  /* ============================================================
     BIBLIOTECA
     ============================================================ */
  let libQuery = "";
  let libCat = "Todas";

  function openLibrary() {
    show("library");
    renderLibChips();
    renderLibrary();
  }

  function renderLibChips() {
    const wrap = $("#lib-chips");
    wrap.innerHTML = "";
    ["Todas", ...CATEGORIES].forEach((c) => {
      const chip = el("button", "chip" + (libCat === c ? " on" : ""), c);
      chip.type = "button";
      chip.onclick = () => {
        libCat = c;
        renderLibChips();
        renderLibrary();
      };
      wrap.appendChild(chip);
    });
  }

  function renderLibrary() {
    const grid = $("#lib-grid");
    grid.innerHTML = "";
    const q = norm(libQuery);
    const list = verses.filter((v) => {
      const okCat = libCat === "Todas" || v.cat === libCat;
      const okQ = !q || norm(v.ref).includes(q) || norm(v.text).includes(q);
      return okCat && okQ;
    });
    $("#lib-count").textContent = `${list.length} versículos`;
    list.forEach((v) => {
      const m = state.mastery[v.ref] || { g: 0, t: 0, m: 0 };
      const pctv = m.m ? 100 : Math.min(95, Math.round((m.g / 3) * 100));
      const card = el("div", "lib-card", `
        <div class="ref">${v.ref} <span>${m.m ? "✅" : m.t ? "📘" : "🆕"}</span></div>
        <div class="txt">“${v.text}”</div>
        <div class="cat">${v.cat}</div>
        <div class="meter"><i style="width:${pctv}%"></i></div>`);
      grid.appendChild(card);
    });
    if (!list.length) grid.appendChild(el("div", "lib-card", "<div class='txt'>No se encontraron versículos.</div>"));
  }

  $("#lib-search-input").addEventListener("input", (e) => {
    libQuery = e.target.value;
    renderLibrary();
  });
  $("#btn-lib-back").addEventListener("click", () => show("home"));

  // acceso a la biblioteca desde el home (atajo de teclado + botón lateral)
  const libBtn = el("button", "mode-card", `
    <div class="mode-emoji">📚</div>
    <div class="mode-name">Biblioteca completa</div>
    <div class="mode-desc">Explora, busca y revisa todos los versículos con tu nivel de dominio.</div>`);
  libBtn.style.marginTop = "14px";
  libBtn.addEventListener("click", openLibrary);
  document.querySelector("#screen-home .panel").appendChild(libBtn);

  /* ============================================================
     INICIO
     ============================================================ */
  renderChips();
  renderHomeStats();
})();
