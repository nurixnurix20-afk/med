(() => {
  const basePath = document.body.dataset.basePath || "";
  const normalize = (value) => String(value || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const escapeText = (value) => String(value ?? "");

  // Reading progress v2. Old buggy v1 values are deliberately ignored and cleared.
  try {
    const oldPrefix = "medkonspekt:reading-progress:v1:";
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(oldPrefix)) stale.push(key);
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch {}

  const resume = document.getElementById("reading-resume");
  if (resume) {
    const topicKey = resume.dataset.topicKey;
    const storageKey = "medkonspekt:reading-progress:v2:" + topicKey;
    const percentNode = document.getElementById("reading-resume-percent");
    let previous = null;
    let decisionPending = false;
    let allowCurrentSave = true;
    let ticking = false;

    // Read only progress that existed before this page load.
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) previous = JSON.parse(raw);
    } catch {}

    const previousIsMeaningful = previous
      && Number.isFinite(previous.y)
      && Number.isFinite(previous.ratio)
      && previous.y >= 180
      && previous.ratio >= 0.06
      && previous.ratio <= 0.93;

    if (previousIsMeaningful) {
      decisionPending = true;
      allowCurrentSave = false; // Do not overwrite the old position while the prompt is awaiting a choice.
      const percent = Math.min(99, Math.max(1, Math.round(previous.ratio * 100)));
      if (percentNode) percentNode.textContent = "Вы остановились примерно на " + percent + "% темы.";
      resume.hidden = false;
    } else {
      // Finished / tiny / invalid positions should not trigger a prompt later.
      try { localStorage.removeItem(storageKey); } catch {}
      resume.hidden = true;
    }

    const currentProgress = () => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      if (maxScroll <= 0) return null;
      const y = Math.max(0, scrollY);
      return { y, ratio: Math.min(1, Math.max(0, y / maxScroll)), maxScroll, updatedAt: Date.now() };
    };

    const save = () => {
      if (!allowCurrentSave || decisionPending) return;
      const progress = currentProgress();
      if (!progress) return;

      // Do not create a resume point unless the reader actually got into the article.
      if (progress.y < 180 || progress.ratio < 0.06) {
        try { localStorage.removeItem(storageKey); } catch {}
        return;
      }
      // Near the end counts as finished, so no resume prompt on the next visit.
      if (progress.ratio > 0.93) {
        try { localStorage.removeItem(storageKey); } catch {}
        return;
      }
      try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch {}
    };

    addEventListener("scroll", () => {
      if (ticking || !allowCurrentSave) return;
      ticking = true;
      requestAnimationFrame(() => { save(); ticking = false; });
    }, { passive: true });
    addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });

    resume.querySelector('[data-action="continue"]')?.addEventListener("click", () => {
      if (!previousIsMeaningful) {
        resume.hidden = true;
        decisionPending = false;
        allowCurrentSave = true;
        return;
      }
      const currentMax = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const changed = previous.maxScroll > 0 && Math.abs(currentMax - previous.maxScroll) / previous.maxScroll > 0.12;
      const target = changed ? previous.ratio * currentMax : Math.min(previous.y, currentMax);
      resume.hidden = true;
      decisionPending = false;
      allowCurrentSave = true;
      scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    });

    resume.querySelector('[data-action="restart"]')?.addEventListener("click", () => {
      resume.hidden = true;
      decisionPending = false;
      allowCurrentSave = true;
      previous = null;
      try { localStorage.removeItem(storageKey); } catch {}
      scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Full-text browser search, no server required.
  const form = document.getElementById("search-form");
  if (form) {
    const input = document.getElementById("search-input");
    const status = document.getElementById("search-status");
    const resultsNode = document.getElementById("search-results");
    let index = [];

    const render = (query) => {
      const normalized = normalize(query).trim();
      resultsNode.replaceChildren();
      status.replaceChildren();
      if (normalized.length < 2) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "Введите не менее двух символов. Поиск работает и по полному тексту тем.";
        status.append(empty);
        return;
      }
      const terms = normalized.split(/\s+/).filter(Boolean);
      const results = index.map((item) => {
        const title = normalize(item.title);
        const subject = normalize(item.subject);
        const section = normalize(item.section || "");
        const keywords = normalize((item.keywords || []).join(" "));
        const body = normalize(item.plainText);
        let score = 0;
        for (const term of terms) {
          if (title.includes(term)) score += 10;
          if (subject.includes(term)) score += 6;
          if (section.includes(term)) score += 5;
          if (keywords.includes(term)) score += 4;
          if (body.includes(term)) score += 1;
        }
        const bodyIndex = body.indexOf(terms[0] || "");
        const first = Math.max(0, bodyIndex - 90);
        const excerpt = item.plainText.slice(first, first + 250);
        return { item, score, excerpt: (first > 0 ? "…" : "") + excerpt + (first + 250 < item.plainText.length ? "…" : "") };
      }).filter((result) => result.score > 0).sort((a,b) => b.score - a.score || a.item.order - b.item.order);

      const count = document.createElement("p");
      count.className = "search-status";
      count.textContent = "Найдено: " + results.length;
      status.append(count);
      if (!results.length) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "По вашему запросу ничего не найдено. Попробуйте другое слово или более короткую формулировку.";
        resultsNode.append(empty);
        return;
      }
      for (const result of results) {
        const a = document.createElement("a");
        a.className = "search-result";
        a.href = basePath + result.item.url;
        const small = document.createElement("small");
        small.textContent = result.item.course + " курс · " + result.item.subject + (result.item.section ? " · " + result.item.section : "");
        const strong = document.createElement("strong");
        strong.textContent = result.item.title;
        const p = document.createElement("p");
        p.textContent = escapeText(result.excerpt);
        a.append(small, strong, p);
        resultsNode.append(a);
      }
    };

    const initial = new URL(location.href).searchParams.get("q") || "";
    input.value = initial;
    status.innerHTML = '<div class="search-empty">Загружаем индекс материалов…</div>';
    fetch(basePath + "/search-index.json")
      .then((response) => { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); })
      .then((data) => { index = data; render(input.value); })
      .catch(() => { status.innerHTML = '<div class="search-empty">Не удалось загрузить индекс поиска. Обновите страницу.</div>'; });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = new URL(location.href);
      const q = input.value.trim();
      if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      render(q);
    });
  }

  // Study system v1. The content itself lives on each topic page in #study-data,
  // so future topics can reuse the same engine without new JS logic.
  const STUDY_STORE_KEY = "medkonspekt:study:v1";
  const DAY = 24 * 60 * 60 * 1000;
  const loadStudyStore = () => {
    try {
      const raw = localStorage.getItem(STUDY_STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { queue: parsed.queue || {}, results: parsed.results || {} };
    } catch { return { queue: {}, results: {} }; }
  };
  const saveStudyStore = (store) => { try { localStorage.setItem(STUDY_STORE_KEY, JSON.stringify(store)); } catch {} };
  const scheduleReview = ({ id, prompt, answer, topicTitle, topicUrl, rating = "again" }) => {
    const store = loadStudyStore();
    const existing = store.queue[id];
    let days = rating === "known" ? 7 : rating === "partial" ? 3 : 1;
    if (existing && rating === "known") days = Math.min(30, Math.max(7, (existing.intervalDays || 7) * 2));
    store.queue[id] = { id, prompt, answer, topicTitle, topicUrl, intervalDays: days, dueAt: Date.now() + days * DAY, lastRating: rating };
    saveStudyStore(store);
  };
  const clearReview = (id) => {
    const store = loadStudyStore();
    delete store.queue[id];
    saveStudyStore(store);
  };
  const dueReviews = () => {
    const now = Date.now();
    return Object.values(loadStudyStore().queue).filter((item) => Number(item.dueAt) <= now).sort((a,b) => a.dueAt - b.dueAt);
  };

  const dailyReview = document.getElementById("daily-review");
  if (dailyReview) {
    const due = dueReviews();
    if (due.length) {
      const topics = [...new Set(due.map((item) => item.topicTitle))];
      const count = document.getElementById("daily-review-count");
      const topicNode = document.getElementById("daily-review-topics");
      const action = document.getElementById("daily-review-action");
      if (count) count.textContent = due.length + " " + (due.length === 1 ? "вопрос" : due.length < 5 ? "вопроса" : "вопросов") + " · ≈ " + Math.max(1, Math.ceil(due.length * .45)) + " мин";
      if (topicNode) topicNode.textContent = topics.slice(0,2).join(", ") + (topics.length > 2 ? " и ещё " + (topics.length - 2) : "");
      if (action) action.href = basePath + due[0].topicUrl + "?review=1#study";
      dailyReview.hidden = false;
    }
  }

  const dataNode = document.getElementById("study-data");
  const studyPanel = document.querySelector("[data-study-panel]");
  if (dataNode && studyPanel) {
    let data = null;
    try { data = JSON.parse(dataNode.textContent); } catch {}
    if (data) {
      const start = document.querySelector("[data-study-start]");
      const close = document.querySelector("[data-study-close]");
      const carousel = document.querySelector("[data-study-carousel]");
      const dots = [...document.querySelectorAll("[data-study-dots] button")];
      const workspace = document.querySelector("[data-study-workspace]");
      let quizState = null;

      const revealPanel = () => {
        studyPanel.hidden = false;
        start?.setAttribute("aria-expanded", "true");
        setTimeout(() => studyPanel.scrollIntoView({ behavior: "smooth", block: "nearest" }), 20);
      };
      start?.setAttribute("aria-expanded", "false");
      start?.addEventListener("click", revealPanel);
      close?.addEventListener("click", () => {
        studyPanel.hidden = true;
        workspace.hidden = true;
        workspace.replaceChildren();
        start?.setAttribute("aria-expanded", "false");
        document.getElementById("study")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      const setDot = (index) => dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
      const carouselIndex = () => {
        if (!carousel) return 0;
        const cards = [...carousel.querySelectorAll(".study-mode-card")];
        const x = carousel.scrollLeft;
        let best = 0, distance = Infinity;
        cards.forEach((card, i) => {
          const d = Math.abs(card.offsetLeft - x - carousel.offsetLeft);
          if (d < distance) { distance = d; best = i; }
        });
        return best;
      };
      let carouselTick = false;
      carousel?.addEventListener("scroll", () => {
        if (carouselTick) return;
        carouselTick = true;
        requestAnimationFrame(() => { setDot(carouselIndex()); carouselTick = false; });
      }, { passive: true });
      dots.forEach((dot, i) => dot.addEventListener("click", () => {
        const card = carousel?.querySelectorAll(".study-mode-card")[i];
        card?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      }));

      const head = (title, subtitle, progress = "") => {
        const wrap = document.createElement("div");
        wrap.className = "study-workspace-head";
        const left = document.createElement("div"); left.className = "study-workspace-title";
        const h3 = document.createElement("h3"); h3.textContent = title;
        const p = document.createElement("p"); p.className = "study-workspace-sub"; p.textContent = subtitle;
        left.append(h3,p); wrap.append(left);
        if (progress) { const s = document.createElement("span"); s.className = "study-progress"; s.textContent = progress; wrap.append(s); }
        return wrap;
      };
      const button = (label, cls = "study-primary") => { const b=document.createElement("button"); b.type="button"; b.className=cls; b.textContent=label; return b; };
      const showWorkspace = () => { workspace.hidden = false; setTimeout(() => workspace.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30); };

      const renderRecall = (items = data.recall, title = "Вспомнить", reviewMode = false) => {
        let index = 0;
        const answers = [];
        const draw = () => {
          workspace.replaceChildren();
          if (index >= items.length) {
            workspace.append(head(reviewMode ? "Повторение завершено" : "Готово", reviewMode ? "Сегодняшние вопросы пройдены." : "Вы прошли все вопросы активного воспроизведения."));
            const sum = document.createElement("div"); sum.className = "study-summary";
            const known = answers.filter(x => x === "known").length;
            const partial = answers.filter(x => x === "partial").length;
            const again = answers.filter(x => x === "again").length;
            const score = document.createElement("p"); score.className = "study-summary-score"; score.textContent = reviewMode ? "Повторение закрыто" : known + " уверенно · " + partial + " частично · " + again + " повторить";
            const text = document.createElement("p"); text.textContent = "Слабые вопросы автоматически вернутся в повторение позже. Всё хранится только в этом браузере.";
            const back = button("Вернуться к режимам", "study-ghost"); back.addEventListener("click", () => { workspace.hidden=true; carousel?.scrollIntoView({behavior:"smooth",block:"nearest"}); });
            sum.append(score,text,back); workspace.append(sum); return;
          }
          const item = items[index];
          workspace.append(head(title, reviewMode ? "Вопросы, срок повторения которых уже наступил." : "Сначала попробуйте ответить без подсказки.", (index+1) + " / " + items.length));
          const q = document.createElement("div"); q.className="study-question";
          const label=document.createElement("span"); label.className="study-question-label"; label.textContent=reviewMode ? "Повторение" : "Вопрос";
          const h4=document.createElement("h4"); h4.textContent=item.prompt;
          const answer=document.createElement("div"); answer.className="study-answer"; answer.hidden=true; answer.textContent=item.answer;
          const controls=document.createElement("div"); controls.className="study-controls";
          const reveal=button("Показать ответ", "study-answer-toggle");
          reveal.addEventListener("click",()=>{
            answer.hidden=false; reveal.remove();
            [["Не вспомнил","again"],["Частично","partial"],["Знал","known"]].forEach(([text,rating])=>{
              const r=button(text,"study-rating"); r.dataset.rating=rating;
              r.addEventListener("click",()=>{
                answers.push(rating);
                if (reviewMode) {
                  if (rating === "known") clearReview(item.id); else scheduleReview({...item, rating, topicTitle:item.topicTitle || data.topicTitle, topicUrl:item.topicUrl || data.topicUrl});
                } else {
                  scheduleReview({id:item.id,prompt:item.prompt,answer:item.answer,topicTitle:data.topicTitle,topicUrl:data.topicUrl,rating});
                }
                index += 1; draw();
              }); controls.append(r);
            });
          });
          controls.append(reveal); q.append(label,h4,answer,controls); workspace.append(q);
        };
        draw(); showWorkspace();
      };

      const renderChoiceSession = (kind, items, title, subtitle, introText = "") => {
        let index = 0, score = 0, wrong = [];
        const draw = () => {
          workspace.replaceChildren();
          if (index >= items.length) {
            workspace.append(head(title + " — результат", subtitle));
            const sum=document.createElement("div"); sum.className="study-summary";
            const scoreP=document.createElement("p"); scoreP.className="study-summary-score"; scoreP.textContent=score + " / " + items.length;
            const text=document.createElement("p"); text.textContent = wrong.length ? "Ошибок: " + wrong.length + ". Они добавлены в повторение на завтра." : "Все ответы верные. Отличный результат по этой теме.";
            sum.append(scoreP,text);
            if (wrong.length) { const retry=button("Повторить ошибки", "study-primary"); retry.addEventListener("click",()=>renderChoiceSession(kind, wrong, title, "Повторяем только вопросы с ошибками.")); sum.append(retry); }
            const back=button("К режимам", "study-ghost"); back.style.marginLeft="8px"; back.addEventListener("click",()=>{workspace.hidden=true; carousel?.scrollIntoView({behavior:"smooth",block:"nearest"});}); sum.append(back);
            workspace.append(sum); return;
          }
          const item=items[index];
          workspace.append(head(title, subtitle, (index+1)+" / "+items.length));
          if (index===0 && introText) { const intro=document.createElement("div"); intro.className="study-case-intro"; intro.textContent=introText; workspace.append(intro); }
          const q=document.createElement("div"); q.className="study-question";
          const label=document.createElement("span"); label.className="study-question-label"; label.textContent=kind === "case" ? "Шаг" : "Вопрос";
          const h4=document.createElement("h4"); h4.textContent=item.prompt;
          const opts=document.createElement("div"); opts.className="study-options";
          const feedback=document.createElement("div"); feedback.className="study-feedback"; feedback.hidden=true;
          let answered=false;
          item.options.forEach((text, i)=>{
            const opt=button(text,"study-option");
            opt.addEventListener("click",()=>{
              if(answered) return; answered=true;
              [...opts.children].forEach((node,j)=>{node.disabled=true; if(j===item.correct) node.classList.add("correct");});
              if(i===item.correct){score+=1; clearReview(item.id);} else {opt.classList.add("wrong"); wrong.push(item); scheduleReview({id:item.id,prompt:item.prompt,answer:item.options[item.correct]+". "+item.explanation,topicTitle:data.topicTitle,topicUrl:data.topicUrl,rating:"again"});}
              feedback.textContent=item.explanation; feedback.hidden=false;
              const next=button(index+1===items.length ? "Показать результат" : "Дальше", "study-primary"); next.classList.add("study-next"); next.addEventListener("click",()=>{index+=1;draw();}); q.append(next);
            }); opts.append(opt);
          });
          q.append(label,h4,opts,feedback); workspace.append(q);
        };
        draw(); showWorkspace();
      };

      const renderQuick = () => {
        workspace.replaceChildren();
        workspace.append(head("90 секунд", "Короткое повторение только по текущему конспекту."));
        const grid=document.createElement("div"); grid.className="study-quick-grid";
        data.quick.forEach(item=>{const c=document.createElement("div");c.className="study-quick-card";const s=document.createElement("span");s.textContent=item.label;const b=document.createElement("strong");b.textContent=item.title;const p=document.createElement("p");p.textContent=item.text;c.append(s,b,p);grid.append(c);});
        const note=document.createElement("p"); note.className="study-source-note"; note.textContent="Этот режим — сжатая версия именно этой темы, без добавления сведений извне.";
        workspace.append(grid,note); showWorkspace();
      };

      studyPanel.querySelectorAll("[data-study-mode]").forEach(card=>card.addEventListener("click",()=>{
        const mode=card.dataset.studyMode;
        if(mode==="recall") renderRecall();
        if(mode==="quiz") renderChoiceSession("quiz", data.quiz, "Тест", "После ответа сразу увидите объяснение.");
        if(mode==="case") renderChoiceSession("case", data.case.steps, "Клиническая ситуация", "Идём по ситуации шаг за шагом.", data.case.intro);
        if(mode==="quick") renderQuick();
      }));

      // From the home page: open only reviews that are already due for this topic.
      if (new URL(location.href).searchParams.get("review") === "1") {
        const due = dueReviews().filter((item) => item.topicUrl === data.topicUrl);
        revealPanel();
        if (due.length) renderRecall(due, "Повторение на сегодня", true);
      }
    }
  }

})();
