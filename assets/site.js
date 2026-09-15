(() => {
  const basePath = document.body.dataset.basePath || "";
  const normalize = (value) => String(value || "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const escapeText = (value) => String(value ?? "");

  // Независимый прогресс чтения для каждой темы.
  const resume = document.getElementById("reading-resume");
  if (resume) {
    const topicKey = resume.dataset.topicKey;
    const storageKey = "medkonspekt:reading-progress:v1:" + topicKey;
    const percentNode = document.getElementById("reading-resume-percent");
    let saved = null;
    let protectSavedPosition = false;
    let ticking = false;

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {}

    const meaningful = saved && Number.isFinite(saved.y) && Number.isFinite(saved.ratio) && saved.y > 140 && saved.ratio >= 0.06 && saved.ratio <= 0.94;
    if (meaningful) {
      protectSavedPosition = true;
      const percent = Math.min(99, Math.max(1, Math.round(saved.ratio * 100)));
      if (percentNode) percentNode.textContent = "Вы остановились примерно на " + percent + "% темы.";
      resume.hidden = false;
    }

    const save = () => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      if (maxScroll <= 0) return;
      const y = Math.max(0, scrollY);
      if (protectSavedPosition && y < 140) return;
      if (y >= 140) protectSavedPosition = false;
      saved = { y, ratio: Math.min(1, Math.max(0, y / maxScroll)), maxScroll, updatedAt: Date.now() };
      try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}
    };

    addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { save(); ticking = false; });
    }, { passive: true });
    addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });

    resume.querySelector('[data-action="continue"]')?.addEventListener("click", () => {
      if (!saved) return;
      const currentMax = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const changed = saved.maxScroll > 0 && Math.abs(currentMax - saved.maxScroll) / saved.maxScroll > 0.12;
      const target = changed ? saved.ratio * currentMax : Math.min(saved.y, currentMax);
      protectSavedPosition = false;
      resume.hidden = true;
      scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    });

    resume.querySelector('[data-action="restart"]')?.addEventListener("click", () => {
      protectSavedPosition = false;
      saved = null;
      resume.hidden = true;
      try { localStorage.removeItem(storageKey); } catch {}
      scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Полнотекстовый поиск полностью в браузере, без сервера.
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
})();