import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("статическая сборка содержит основные страницы", () => {
  for (const file of [
    "index.html",
    "about/index.html",
    "search/index.html",
    "college/bashlarova/index.html",
    "college/bashlarova/course-3/index.html",
    "college/bashlarova/course-3/therapy/index.html",
    "college/bashlarova/course-3/therapy/bronchitis/index.html",
    "search-index.json",
    "sitemap.xml",
    "robots.txt",
    "assets/site.js",
  ]) assert.ok(fs.existsSync(path.join(root, file)), `Нет файла ${file}`);
});

test("Терапия ведёт сразу к списку тем без Пульмонологии", () => {
  const html = read("college/bashlarova/course-3/therapy/index.html");
  assert.match(html, /Бронхит/);
  assert.doesNotMatch(html, />Пульмонология</);
});

test("над курсами указано направление Лечебное дело", () => {
  assert.match(read("college/bashlarova/index.html"), /class="program-label">Лечебное дело</);
});

test("прогресс чтения хранится локально и отдельно по теме", () => {
  const html = read("college/bashlarova/course-3/therapy/bronchitis/index.html");
  const js = read("assets/site.js");
  assert.match(html, /data-topic-key="\/college\/bashlarova\/course-3\/therapy\/bronchitis"/);
  assert.match(js, /medkonspekt:reading-progress:v1:/);
  assert.match(js, /localStorage\.setItem/);
});

test("поиск статический и индекс содержит все темы из content", () => {
  const index = JSON.parse(read("search-index.json"));
  const topicsDir = path.resolve("content/colleges/bashlarova/topics");
  const topicCount = fs.readdirSync(topicsDir).filter((name) => name.endsWith(".md")).length;
  assert.equal(index.length, topicCount);
  assert.match(read("assets/site.js"), /fetch\(basePath \+ "\/search-index\.json"\)/);
});

test("в production-файлах нет Cloudflare или Vinext", () => {
  const all = [read("index.html"), read("assets/site.js"), read("robots.txt")].join("\n");
  assert.doesNotMatch(all, /vinext|cloudflare|wrangler/i);
});
