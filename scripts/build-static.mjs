import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const contentRoot = path.join(root, "content", "colleges");
const outDir = path.join(root, "dist");
const publicDir = path.join(root, "public");
const assetsDir = path.join(root, "assets");

function cleanBasePath(raw = "") {
  const value = raw.trim();
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

const basePath = cleanBasePath(process.env.BASE_PATH ?? "");
const siteOrigin = (process.env.SITE_URL || "https://example.com").replace(/\/+$/, "");
const publicSiteUrl = `${siteOrigin}${basePath}`;

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function parseValue(raw) {
  const text = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith('"') && text.endsWith('"'))) {
    return JSON.parse(text);
  }
  return text;
}

function parseFrontmatter(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Нет frontmatter: ${file}`);
  const data = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`Некорректная строка frontmatter в ${file}: ${line}`);
    data[line.slice(0, separator).trim()] = parseValue(line.slice(separator + 1));
  }
  return { data, markdown: match[2].trim() };
}

function plainText(markdown) {
  return markdown
    .replace(/^> \[!(?:NOTE|IMPORTANT)\]\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`|\[\]!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value = "") {
  return escapeHtml(value);
}

function routeHref(route) {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return `${basePath}${normalized}` || "/";
}

function absoluteUrl(route) {
  const normalized = route === "/" ? "/" : route.startsWith("/") ? route : `/${route}`;
  return `${publicSiteUrl}${normalized}`;
}

function ensureTrailingSlash(route) {
  if (route === "/") return route;
  return route.endsWith("/") ? route : `${route}/`;
}

function slugifyHeading(value) {
  return value.toLowerCase().replace(/[^a-zа-яё0-9\s-]/gi, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
}

function safeContentHref(raw) {
  if (raw.startsWith("/")) return routeHref(raw);
  return raw;
}

function renderInline(text) {
  const tokens = String(text).split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return tokens.map((token) => {
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return `<a href="${escapeHtml(safeContentHref(link[2]))}">${escapeHtml(link[1])}</a>`;
    if (token.startsWith("**") && token.endsWith("**")) return `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    if (token.startsWith("`") && token.endsWith("`")) return `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    return escapeHtml(token);
  }).join("");
}

function splitCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isTableRule(line) {
  return /^\s*\|?\s*:?-{3,}/.test(line) && line.includes("|");
}

function extractToc(markdown) {
  return markdown.split("\n").flatMap((line) => {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    return match ? [{ level: match[1].length, text: match[2].replace(/\*\*/g, ""), id: slugifyHeading(match[2]) }] : [];
  });
}

function renderMarkdown(source) {
  const lines = source.replace(/\r/g, "").split("\n");
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line.trim()) { i += 1; continue; }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      nodes.push(`<h${level} id="${escapeHtml(slugifyHeading(heading[2]))}">${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.startsWith("> [!")) {
      const kind = line.includes("IMPORTANT") ? "important" : "note";
      const title = kind === "important" ? "Важно" : "Обратите внимание";
      const body = [];
      i += 1;
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        body.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i += 1;
      }
      nodes.push(`<aside class="callout ${kind}"><span class="callout-title">${title}</span>${body.map((part) => `<p>${renderInline(part)}</p>`).join("")}</aside>`);
      continue;
    }

    if (line.trim().startsWith("![")) {
      const image = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (image) nodes.push(`<img class="article-image" src="${escapeHtml(safeContentHref(image[2]))}" alt="${escapeHtml(image[1])}" loading="lazy">`);
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const headers = splitCells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      nodes.push(`<div class="table-scroll"><table class="article-table"><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items = [];
      while (i < lines.length) {
        const match = lines[i].trim().match(orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        i += 1;
      }
      const tag = orderedList ? "ol" : "ul";
      nodes.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      nodes.push("<hr>");
      i += 1;
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{2,4})\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i].trim()) &&
      !lines[i].trimStart().startsWith("> [!") &&
      !lines[i].trim().startsWith("![") &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableRule(lines[i + 1]))
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    nodes.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return nodes.join("\n");
}

const required = ["collegeSlug", "course", "subject", "subjectSlug", "order", "slug", "title", "description"];
const collegeFiles = walk(contentRoot).filter((file) => file.endsWith("college.json"));
const colleges = collegeFiles.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const topicFiles = walk(contentRoot).filter((file) => file.endsWith(".md"));
const topics = topicFiles.map((file) => {
  const { data, markdown } = parseFrontmatter(file);
  for (const field of required) {
    if (data[field] === undefined || data[field] === "") throw new Error(`Поле ${field} не заполнено: ${file}`);
  }
  if (!colleges.some((college) => college.slug === data.collegeSlug)) throw new Error(`Неизвестный колледж ${data.collegeSlug}: ${file}`);
  return { ...data, keywords: data.keywords ?? [], markdown, plainText: plainText(markdown), sourceFile: file };
}).sort((a, b) => a.collegeSlug.localeCompare(b.collegeSlug) || a.course - b.course || a.subject.localeCompare(b.subject, "ru") || (a.section ?? "").localeCompare(b.section ?? "", "ru") || a.order - b.order);

const ids = new Set();
for (const topic of topics) {
  const id = [topic.collegeSlug, topic.course, topic.subjectSlug, topic.sectionSlug ?? "", topic.slug].join("/");
  if (ids.has(id)) throw new Error(`Повторяющийся адрес темы: ${id}`);
  ids.add(id);
}

const getCollege = (slug) => colleges.find((college) => college.slug === slug);
const topicsForCollege = (slug) => topics.filter((topic) => topic.collegeSlug === slug);
const topicsForCourse = (slug, course) => topics.filter((topic) => topic.collegeSlug === slug && topic.course === course);
const topicsForSubject = (slug, course, subjectSlug) => topics.filter((topic) => topic.collegeSlug === slug && topic.course === course && topic.subjectSlug === subjectSlug).sort((a,b) => a.order - b.order);
const uniqueBy = (items, key) => {
  const seen = new Set();
  return items.filter((item) => { const current = key(item); if (seen.has(current)) return false; seen.add(current); return true; });
};
const courseLabel = (course) => `${course} курс`;
const collegeUrl = (collegeSlug) => `/college/${collegeSlug}/`;
const courseUrl = (collegeSlug, course) => `/college/${collegeSlug}/course-${course}/`;
const subjectUrl = (topic) => `${courseUrl(topic.collegeSlug, topic.course)}${topic.subjectSlug}/`;
const sectionUrl = (topic) => topic.sectionSlug ? `${subjectUrl(topic)}${topic.sectionSlug}/` : subjectUrl(topic);
const topicUrl = (topic) => `${sectionUrl(topic)}${topic.slug}/`;

function neighborTopics(topic) {
  const siblings = topicsForSubject(topic.collegeSlug, topic.course, topic.subjectSlug).filter((item) => item.sectionSlug === topic.sectionSlug);
  const index = siblings.findIndex((item) => item.slug === topic.slug);
  return { previous: index > 0 ? siblings[index - 1] : undefined, next: index >= 0 ? siblings[index + 1] : undefined };
}

function icon(name) {
  const paths = {
    activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5z"/>',
    building: '<path d="M4 21h16M6 21V7l6-4 6 4v14M9 10h1M14 10h1M9 14h1M14 14h1M10 21v-3h4v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ""}</svg>`;
}

function siteHeader() {
  return `<header class="site-header"><div class="page-shell header-inner"><a class="brand" href="${routeHref("/")}" aria-label="МедКонспект — главная"><span class="brand-sign">${icon("activity")}</span><span>МедКонспект<small>учебная платформа</small></span></a><nav class="header-nav" aria-label="Основная навигация"><a href="${routeHref("/search/")}">${icon("search")}<span>Поиск</span></a><a href="${routeHref("/about/")}">${icon("info")}<span>О проекте</span></a></nav></div></header>`;
}

function trail(items) {
  const parts = [{ label: "Главная", href: "/" }, ...items];
  return `<nav class="breadcrumb-wrap" aria-label="Хлебные крошки"><ol class="breadcrumb-list">${parts.map((item, index) => {
    const node = item.href ? `<a class="breadcrumb-link" href="${routeHref(item.href)}">${escapeHtml(item.label)}</a>` : `<span class="breadcrumb-page" aria-current="page">${escapeHtml(item.label)}</span>`;
    return `<li class="breadcrumb-fragment"><span class="breadcrumb-item">${node}</span>${index < parts.length - 1 ? `<span class="breadcrumb-separator" aria-hidden="true">${icon("chevron")}</span>` : ""}</li>`;
  }).join("")}</ol></nav>`;
}

function documentHtml({ title, description, canonical, body, structuredData = null }) {
  const fullTitle = title === "МедКонспект" ? "МедКонспект — материалы медицинского колледжа" : `${title} — МедКонспект`;
  const canonicalAbsolute = absoluteUrl(canonical);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonicalAbsolute)}">
<meta property="og:type" content="${structuredData ? "article" : "website"}">
<meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="МедКонспект">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonicalAbsolute)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="${routeHref("/favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${routeHref("/assets/styles.css")}">
${structuredData ? `<script type="application/ld+json">${JSON.stringify(structuredData).replaceAll("<", "\\u003c")}</script>` : ""}
</head>
<body data-base-path="${escapeHtml(basePath)}">
${body}
<script src="${routeHref("/assets/site.js")}" defer></script>
</body>
</html>`;
}

function outputPathForRoute(route) {
  if (route === "/") return path.join(outDir, "index.html");
  const clean = route.replace(/^\/+|\/+$/g, "");
  return path.join(outDir, clean, "index.html");
}

function writeRoute(route, html) {
  const target = outputPathForRoute(route);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
}

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function topicRows(list) {
  return `<div class="list-panel">${list.map((topic) => `<a class="content-row" href="${routeHref(topicUrl(topic))}"><span class="row-index">${String(topic.order).padStart(2, "0")}</span><span class="row-copy"><strong class="row-title">${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.description)}</span></span><span class="row-arrow">${icon("arrowRight")}</span></a>`).join("")}</div>`;
}

function buildHome() {
  const college = colleges[0];
  const availableCourses = [...new Set(topics.map((topic) => topic.course))].sort((a, b) => a - b);
  const subjects = new Set(topics.map((topic) => `${topic.collegeSlug}:${topic.subjectSlug}`)).size;
  const body = `${siteHeader()}<main><section class="home-intro page-shell"><div class="eyebrow">${icon("book")} Учебная платформа</div><h1>Медицинские материалы, собранные по учебной программе</h1><p class="home-lead">Выберите колледж, курс и предмет — без длинных меню и лишних экранов.</p><a class="home-search" href="${routeHref("/search/")}">${icon("search")} Найти тему или термин<span>Поиск по ${topics.length} материалам</span></a></section><section class="page-shell college-section" aria-labelledby="colleges-title"><div class="section-heading"><div><p class="section-kicker">Учебные заведения</p><h2 id="colleges-title">Доступные материалы</h2></div><span class="section-count">${String(colleges.length).padStart(2, "0")}</span></div><a class="college-row" href="${routeHref(collegeUrl(college.slug))}"><span class="college-mark">${icon("building")}</span><span class="college-copy"><strong>${escapeHtml(college.name)}</strong><span>Доступно: ${availableCourses.map((course) => `${course} курс`).join(", ")} · ${subjects} предмет · ${topics.length} тем</span></span><span class="college-action">Открыть ${icon("arrowRight")}</span></a></section></main>`;
  writeRoute("/", documentHtml({ title: "МедКонспект", description: "Удобная платформа с учебными материалами для студентов медицинского колледжа.", canonical: "/", body }));
}

function buildCollege(college) {
  const list = topicsForCollege(college.slug);
  const counts = new Map();
  for (const topic of list) counts.set(topic.course, (counts.get(topic.course) ?? 0) + 1);
  const courses = [1,2,3,4].map((course) => {
    const count = counts.get(course) ?? 0;
    if (!count) return `<div class="course-tile muted"><span class="page-number">${String(course).padStart(2,"0")}</span><strong>${courseLabel(course)}</strong><p>Материалы пока не добавлены</p></div>`;
    return `<a class="course-tile available" href="${routeHref(courseUrl(college.slug, course))}"><span class="page-number">${String(course).padStart(2,"0")}</span><strong>${courseLabel(course)}</strong><p>${count} ${count === 1 ? "тема" : count < 5 ? "темы" : "тем"}</p><span class="course-link">Смотреть предметы ${icon("arrowRight")}</span></a>`;
  }).join("");
  const body = `${siteHeader()}<main class="page-shell subpage">${trail([{ label: college.name }])}<div class="page-heading"><span class="page-number">Учебное заведение</span><h1>${escapeHtml(college.name)}</h1><p>${escapeHtml(college.description)} Выберите курс, чтобы перейти к предметам.</p></div><div class="program-label">${escapeHtml(college.program ?? "Лечебное дело")}</div><div class="course-grid">${courses}</div></main>`;
  writeRoute(collegeUrl(college.slug), documentHtml({ title: college.name, description: college.description, canonical: collegeUrl(college.slug), body }));
}

function buildCourse(college, course, list) {
  const subjects = uniqueBy(list, (topic) => topic.subjectSlug);
  const rows = subjects.map((subject, index) => {
    const count = list.filter((item) => item.subjectSlug === subject.subjectSlug).length;
    return `<a class="content-row" href="${routeHref(subjectUrl(subject))}"><span class="row-index">${String(index + 1).padStart(2,"0")}</span><span class="row-copy"><strong class="row-title">${escapeHtml(subject.subject)}</strong><span>${count} учебных тем</span></span><span class="row-arrow">${icon("arrowRight")}</span></a>`;
  }).join("");
  const body = `${siteHeader()}<main class="page-shell subpage">${trail([{ label: college.shortName, href: collegeUrl(college.slug) }, { label: courseLabel(course) }])}<div class="page-heading"><span class="page-number">Курс ${String(course).padStart(2,"0")}</span><h1>${courseLabel(course)}</h1><p>Выберите предмет. Внутри находятся учебные темы и, при необходимости, разделы.</p></div><div class="list-panel">${rows}</div></main>`;
  writeRoute(courseUrl(college.slug, course), documentHtml({ title: `${courseLabel(course)} — ${college.shortName}`, description: `Предметы и учебные материалы за ${courseLabel(course)}.`, canonical: courseUrl(college.slug, course), body }));
}

function buildSubject(college, course, list) {
  const first = list[0];
  const sectioned = list.filter((topic) => topic.sectionSlug);
  const direct = list.filter((topic) => !topic.sectionSlug);
  const sections = uniqueBy(sectioned, (topic) => topic.sectionSlug ?? "");
  const sectionHtml = sections.length ? `<div class="section-block"><h2 class="section-title"><span>Разделы</span></h2><div class="list-panel">${sections.map((section, index) => {
    const count = sectioned.filter((topic) => topic.sectionSlug === section.sectionSlug).length;
    return `<a class="content-row" href="${routeHref(sectionUrl(section))}"><span class="row-index">${String(index + 1).padStart(2,"0")}</span><span class="row-copy"><strong class="row-title">${escapeHtml(section.section)}</strong><span>${count} учебных тем</span></span><span class="row-arrow">${icon("arrowRight")}</span></a>`;
  }).join("")}</div></div>` : "";
  const directHtml = direct.length ? `<div class="section-block"><h2 class="section-title"><span>Темы</span></h2>${topicRows(direct)}</div>` : "";
  const body = `${siteHeader()}<main class="page-shell subpage">${trail([{ label: college.shortName, href: collegeUrl(college.slug) }, { label: courseLabel(course), href: courseUrl(college.slug, course) }, { label: first.subject }])}<div class="page-heading"><span class="page-number">Предмет</span><h1>${escapeHtml(first.subject)}</h1><p>${list.length} учебных тем. Материалы расположены в порядке изучения.</p></div>${sectionHtml}${directHtml}</main>`;
  writeRoute(subjectUrl(first), documentHtml({ title: first.subject, description: `Учебные темы по предмету «${first.subject}», ${courseLabel(course)}.`, canonical: subjectUrl(first), body }));
}

function buildSection(college, course, list) {
  const first = list[0];
  const body = `${siteHeader()}<main class="page-shell subpage">${trail([{ label: college.shortName, href: collegeUrl(college.slug) }, { label: courseLabel(course), href: courseUrl(college.slug, course) }, { label: first.subject, href: subjectUrl(first) }, { label: first.section ?? "" }])}<div class="page-heading"><span class="page-number">Раздел предмета</span><h1>${escapeHtml(first.section ?? first.subject)}</h1><p>${list.length} учебных тем по разделу. Откройте материал, чтобы перейти к полному конспекту.</p></div>${topicRows(list)}</main>`;
  writeRoute(sectionUrl(first), documentHtml({ title: first.section ?? first.subject, description: `Материалы раздела «${first.section}» по предмету «${first.subject}».`, canonical: sectionUrl(first), body }));
}

function buildTopic(college, topic) {
  const toc = extractToc(topic.markdown);
  const { previous, next } = neighborTopics(topic);
  const words = topic.plainText.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 180));
  const trailItems = [
    { label: college.shortName, href: collegeUrl(college.slug) },
    { label: courseLabel(topic.course), href: courseUrl(college.slug, topic.course) },
    { label: topic.subject, href: subjectUrl(topic) },
  ];
  if (topic.section) trailItems.push({ label: topic.section, href: sectionUrl(topic) });
  trailItems.push({ label: topic.title });
  const topicKey = topicUrl(topic).replace(/\/$/, "");
  const tocLinks = toc.map((item) => `<a class="level-${item.level}" href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a>`).join("");
  const desktopToc = toc.length ? `<aside class="toc toc-desktop" aria-label="Содержание темы"><strong>На этой странице</strong><nav class="toc-links">${tocLinks}</nav></aside>` : "";
  const mobileToc = toc.length ? `<details class="toc toc-mobile"><summary>Содержание темы</summary><nav class="toc-links">${tocLinks}</nav></details>` : "";
  const previousHtml = previous ? `<a href="${routeHref(topicUrl(previous))}">${icon("arrowLeft")}<span>Предыдущая тема<strong>${escapeHtml(previous.title)}</strong></span></a>` : `<span></span>`;
  const nextHtml = next ? `<a href="${routeHref(topicUrl(next))}"><span>Следующая тема<strong>${escapeHtml(next.title)}</strong></span>${icon("arrowRight")}</a>` : "";
  const resume = `<aside class="reading-resume" id="reading-resume" data-topic-key="${escapeHtml(topicKey)}" aria-label="Сохранённый прогресс чтения" hidden><div class="reading-resume-copy"><strong>Продолжить чтение?</strong><span id="reading-resume-percent"></span></div><div class="reading-resume-actions"><button type="button" class="reading-resume-primary" data-action="continue">Продолжить</button><button type="button" class="reading-resume-secondary" data-action="restart">С начала</button></div></aside>`;
  const body = `${siteHeader()}<main class="page-shell subpage">${trail(trailItems)}${resume}<div class="topic-layout"><article><header class="article-header"><span class="page-number">Тема ${String(topic.order).padStart(2,"0")}</span><h1>${escapeHtml(topic.title)}</h1><div class="article-meta"><span>${icon("book")} ${escapeHtml(topic.subject)}${topic.section ? ` · ${escapeHtml(topic.section)}` : ""}</span><span>${icon("clock")} около ${minutes} мин чтения</span><span>${icon("file")} ${words.toLocaleString("ru-RU")} слов</span></div></header><div class="article-body">${renderMarkdown(topic.markdown)}</div><footer class="article-footer"><details class="error-note"><summary>Нашли ошибку?</summary><p>Форма для отправки исправлений появится здесь позже. Пока можно сохранить название темы и место в тексте.</p></details><nav class="topic-nav" aria-label="Соседние темы">${previousHtml}${nextHtml}</nav></footer></article>${desktopToc}${mobileToc}</div></main>`;
  const structuredData = { "@context": "https://schema.org", "@type": "LearningResource", name: topic.title, description: topic.description, educationalLevel: `${topic.course} курс медицинского колледжа`, learningResourceType: "Учебный материал", inLanguage: "ru", isPartOf: { "@type": "Course", name: topic.subject } };
  writeRoute(topicUrl(topic), documentHtml({ title: topic.title, description: topic.description, canonical: topicUrl(topic), body, structuredData }));
}

function buildSearch() {
  const body = `${siteHeader()}<main class="page-shell subpage search-page">${trail([{ label: "Поиск" }])}<div class="page-heading"><span class="page-number">Все материалы</span><h1>Поиск по конспектам</h1><p>Введите название заболевания, симптом, метод диагностики или другой термин.</p></div><form class="search-box" id="search-form" role="search"><label class="search-field"><span class="sr-only">Поисковый запрос</span>${icon("search")}<input class="search-input" id="search-input" name="q" placeholder="Например: бронхиальная обструкция" autocomplete="off"></label><button class="search-submit" type="submit">Найти</button></form><div id="search-status" aria-live="polite"></div><div id="search-results"></div></main>`;
  writeRoute("/search/", documentHtml({ title: "Поиск", description: "Поиск по названиям, предметам, разделам и содержимому учебных материалов.", canonical: "/search/", body }));
}

function buildAbout() {
  const body = `${siteHeader()}<main class="page-shell subpage">${trail([{ label: "О проекте" }])}<div class="page-heading"><span class="page-number">О платформе</span><h1>Зачем создан этот проект</h1><p>Место для короткого и честного рассказа о том, кто собирает материалы и почему.</p></div><div class="about-grid"><div class="author-photo"><div>${icon("camera")}<span>Фотография автора<br>будет добавлена позже</span></div></div><section class="about-copy"><h2>Имя автора</h2><p class="placeholder-line">Здесь можно написать несколько предложений о себе: курс, специальность и роль в проекте.</p><h2>Почему появился «МедКонспект»</h2><p>Здесь будет личная история создания платформы: какую проблему она решает и чем должна помочь студентам колледжа.</p><h2>Цели проекта</h2><p>Место для целей: собрать материалы по курсам, сделать их удобными на телефоне и поддерживать понятную структуру без лишнего усложнения.</p><h2>Связаться</h2><ul class="contact-list"><li>Telegram — добавить ссылку</li><li>Почта — добавить адрес</li><li>Другая социальная сеть</li></ul></section></div></main>`;
  writeRoute("/about/", documentHtml({ title: "О проекте", description: "О создателе и целях учебной платформы «МедКонспект».", canonical: "/about/", body }));
}

function build404() {
  const body = `${siteHeader()}<main class="page-shell subpage"><div class="page-heading"><span class="page-number">Ошибка 404</span><h1>Материал не найден</h1><p>Возможно, адрес изменился или тема ещё не добавлена.</p><p><a class="breadcrumb-link" href="${routeHref("/")}">Вернуться на главную →</a></p></div></main>`;
  fs.writeFileSync(path.join(outDir, "404.html"), documentHtml({ title: "Страница не найдена", description: "Страница не найдена.", canonical: "/404.html", body }));
}

function buildSiteJs() {
  return `(() => {
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
      const terms = normalized.split(/\\s+/).filter(Boolean);
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
})();`;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
copyDirectory(publicDir, outDir);
fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
fs.copyFileSync(path.join(assetsDir, "styles.css"), path.join(outDir, "assets", "styles.css"));
fs.writeFileSync(path.join(outDir, "assets", "site.js"), buildSiteJs());
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

buildHome();
for (const college of colleges) {
  buildCollege(college);
  const collegeTopics = topicsForCollege(college.slug);
  const courses = [...new Set(collegeTopics.map((topic) => topic.course))].sort((a,b) => a-b);
  for (const course of courses) {
    const courseTopics = topicsForCourse(college.slug, course);
    buildCourse(college, course, courseTopics);
    const subjects = uniqueBy(courseTopics, (topic) => topic.subjectSlug);
    for (const subject of subjects) {
      const subjectTopics = topicsForSubject(college.slug, course, subject.subjectSlug);
      buildSubject(college, course, subjectTopics);
      const sections = uniqueBy(subjectTopics.filter((topic) => topic.sectionSlug), (topic) => topic.sectionSlug);
      for (const section of sections) {
        buildSection(college, course, subjectTopics.filter((topic) => topic.sectionSlug === section.sectionSlug));
      }
      for (const topic of subjectTopics) buildTopic(college, topic);
    }
  }
}
buildSearch();
buildAbout();
build404();

const searchIndex = topics.map((topic) => ({
  url: topicUrl(topic),
  course: topic.course,
  subject: topic.subject,
  section: topic.section,
  order: topic.order,
  title: topic.title,
  keywords: topic.keywords,
  plainText: topic.plainText,
}));
fs.writeFileSync(path.join(outDir, "search-index.json"), JSON.stringify(searchIndex));

const routes = ["/", "/about/", "/search/"];
for (const college of colleges) routes.push(collegeUrl(college.slug));
for (const topic of topics) {
  routes.push(courseUrl(topic.collegeSlug, topic.course));
  routes.push(subjectUrl(topic));
  if (topic.sectionSlug) routes.push(sectionUrl(topic));
  routes.push(topicUrl(topic));
}
const uniqueRoutes = [...new Set(routes)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${uniqueRoutes.map((route) => `  <url><loc>${escapeXml(absoluteUrl(route))}</loc><lastmod>2026-09-06</lastmod><changefreq>${route === "/" ? "weekly" : "monthly"}</changefreq><priority>${route === "/" ? "1.0" : route.includes("/course-") ? "0.8" : "0.6"}</priority></url>`).join("\n")}\n</urlset>\n`;
fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap);
fs.writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl("/sitemap.xml")}\n`);

if (process.env.CUSTOM_DOMAIN?.trim()) {
  fs.writeFileSync(path.join(outDir, "CNAME"), process.env.CUSTOM_DOMAIN.trim() + "\n");
}

console.log(`Статическая сборка готова: ${colleges.length} колледж, ${topics.length} тем, ${uniqueRoutes.length} маршрутов.`);
console.log(`Папка публикации: ${outDir}`);
console.log(`BASE_PATH=${basePath || "(пусто)"}`);
console.log(`SITE_URL=${siteOrigin}`);
