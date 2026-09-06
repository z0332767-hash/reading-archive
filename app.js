import { demoArchive } from "./data.js";
import { filterBooks, makeIdeaFromAnnotation, mergeArchive, normalizeArchive, previewMerge, selectReviewItems, toMarkdown, upgradeArchiveShape } from "./core.mjs";
import { composeLocalAnswer, prepareSources, searchArchive } from "./search.mjs";
import { buildTopicMap, buildTopicTimeline, relatedTopics } from "./map.mjs";

const STORAGE_KEY = "reading-archive-phase1-v1";
const THEME_KEY = "reading-archive-theme";
const TEXT_SIZE_KEY = "reading-archive-text-size";
const LINE_HEIGHT_KEY = "reading-archive-line-height";
const clone = (value) => JSON.parse(JSON.stringify(value));
const statusNames = { reading: "在读", finished: "已读", wishlist: "想读" };
let archive = loadArchive();
let activeBookId = null;
let pendingPreview = null;
let pendingSource = "import";
let pendingSyncSummary = null;
let ideaFilter = "all";
let searchScope = "all";
let openAIConfigured = false;
let lastSearchResults = [];
let selectedTopic = "";

const elements = {
  views: [...document.querySelectorAll(".view")],
  nav: [...document.querySelectorAll(".nav-item")],
  bookList: document.querySelector("#book-list"),
  search: document.querySelector("#book-search"),
  status: document.querySelector("#status-filter"),
  tag: document.querySelector("#tag-filter"),
  detail: document.querySelector("#book-detail"),
  inbox: document.querySelector("#inbox-workspace"),
  inboxCount: document.querySelector("#inbox-count"),
  toast: document.querySelector("#toast"),
  importText: document.querySelector("#import-text"),
  importFile: document.querySelector("#import-file"),
  importError: document.querySelector("#import-error"),
  importPreview: document.querySelector("#import-preview"),
  importPlaceholder: document.querySelector("#import-placeholder"),
  syncDot: document.querySelector("#sync-dot"),
  connectionState: document.querySelector("#connection-state"),
  startSync: document.querySelector("#start-sync"),
  syncError: document.querySelector("#sync-error"),
  syncPreview: document.querySelector("#sync-preview"),
  syncPreviewSection: document.querySelector("#sync-preview-section"),
  ideaCount: document.querySelector("#idea-count"),
  todayReviews: document.querySelector("#today-reviews"),
  ideaList: document.querySelector("#idea-list")
  , archiveQuery: document.querySelector("#archive-query")
  , askOutput: document.querySelector("#ask-output")
  , sourceList: document.querySelector("#source-list")
  , sourceSection: document.querySelector("#source-section")
  , useAI: document.querySelector("#use-ai")
  , topicList: document.querySelector("#topic-list")
  , topicWorkspace: document.querySelector("#topic-workspace")
};

function applyTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem(THEME_KEY, resolved);
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) toggle.textContent = resolved === "dark" ? "切换浅色模式" : "切换深色模式";
}

function initializeTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  applyTheme(stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
}

function applyTextSize(size) {
  const resolved = ["standard", "comfortable", "large"].includes(size) ? size : "comfortable";
  document.documentElement.dataset.textSize = resolved;
  localStorage.setItem(TEXT_SIZE_KEY, resolved);
  const labels = { standard: "标准", comfortable: "舒适", large: "大字" };
  const toggle = document.querySelector("#text-size-toggle");
  if (toggle) toggle.textContent = `显示大小：${labels[resolved]}`;
  document.querySelectorAll("[data-text-size-option]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.textSizeOption === resolved));
  });
}

function applyLineHeight(value) {
  const resolved = ["1.65", "1.85", "2.05"].includes(value) ? value : "1.85";
  document.documentElement.style.setProperty("--reading-line-height", resolved);
  localStorage.setItem(LINE_HEIGHT_KEY, resolved);
  document.querySelector("#reading-line-height").value = resolved;
}

function openDisplaySettings() {
  document.querySelector("#display-settings").showModal();
}

function loadArchive() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return upgradeArchiveShape(stored ? JSON.parse(stored) : clone(demoArchive));
  } catch {
    return upgradeArchiveShape(clone(demoArchive));
  }
}

function saveArchive(message = "更改已保存") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
  renderCounts();
  if (message) showToast(message);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function route(name, params = {}) {
  const viewName = name === "detail" ? "detail" : name;
  elements.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  elements.nav.forEach((button) => button.classList.toggle("active", button.dataset.route === name || (name === "detail" && button.dataset.route === "library")));
  if (params.bookId) activeBookId = params.bookId;
  if (name === "library") renderLibrary();
  if (name === "detail") renderDetail();
  if (name === "inbox") renderInbox();
  if (name === "today") renderToday();
  if (name === "ideas") renderIdeas();
  if (name === "ask") refreshOpenAIStatus();
  if (name === "map") renderThoughtMap();
  if (name === "sync") refreshWeReadStatus();
  window.scrollTo({ top: 0, behavior: "instant" });
  document.querySelector("main").focus({ preventScroll: true });
}

function renderCounts() {
  const pending = archive.annotations.filter((note) => !note.organized).length;
  elements.inboxCount.textContent = pending;
  elements.ideaCount.textContent = archive.ideas.length;
  document.querySelector("#system-record-count").textContent = `${archive.books.length + archive.annotations.length + archive.ideas.length + Object.keys(archive.bookClosures).length} RECORDS`;
  document.querySelector("#library-summary").textContent = `${archive.books.length} 本书，${archive.annotations.length} 条划线与点评，${pending} 条等待整理。`;
}

function localDay(date = new Date()) {
  return date.toLocaleDateString("sv-SE");
}

function renderToday() {
  const today = localDay();
  const reviewedToday = archive.reviewRecords.filter((record) => localDay(new Date(record.reviewedAt)) === today).length;
  const remaining = Math.max(0, 3 - reviewedToday);
  const items = remaining ? selectReviewItems(archive, remaining) : [];
  document.querySelector("#today-date").textContent = `ARCHIVE / ${new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}`;
  document.querySelector("#today-progress").textContent = `今日回顾 ${Math.min(3, reviewedToday)} / 3`;

  if (!items.length) {
    elements.todayReviews.innerHTML = `<div class="today-empty"><h2>${reviewedToday >= 3 ? "今天的回顾已经完成" : "暂时没有可回顾的内容"}</h2><p>${reviewedToday >= 3 ? "这些内容会根据你的反馈，在未来重新出现。" : "同步或导入更多笔记后，它们会在这里重新出现。"}</p></div>`;
  } else {
    elements.todayReviews.innerHTML = items.map((item, index) => reviewCardMarkup(item, reviewedToday + index + 1)).join("");
    elements.todayReviews.querySelectorAll("[data-stance]").forEach((button) => button.addEventListener("click", () => showReviewResponse(button.dataset.annotationId, button.dataset.stance)));
  }

  const unfinished = archive.books.find((book) => book.status === "finished" && !archive.bookClosures[book.id]);
  document.querySelector("#closure-prompt").innerHTML = unfinished ? `
    <p class="aside-label">READING CLOSURE</p><h3 class="aside-title">《${escapeHtml(unfinished.title)}》还没有结案</h3>
    <p class="aside-copy">用几句话留下它真正改变了什么，而不只是把它标记为已读。</p>
    <button class="text-button" data-close-book="${unfinished.id}">完成读完仪式 →</button>` : `
    <p class="aside-label">READING CLOSURE</p><h3 class="aside-title">已读书籍都完成了结案</h3><p class="aside-copy">新的已读书籍会在这里提醒你留下自己的判断。</p>`;
  document.querySelector("[data-close-book]")?.addEventListener("click", (event) => route("detail", { bookId: event.currentTarget.dataset.closeBook }));

  const recentIdeas = [...archive.ideas].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 3);
  document.querySelector("#recent-ideas").innerHTML = `<p class="aside-label">RECENT IDEAS</p><h3 class="aside-title">最近形成的观点与问题</h3>${recentIdeas.length ? recentIdeas.map((idea) => `<div class="mini-idea"><span>${idea.type === "question" ? "问题" : "观点"}</span><p>${escapeHtml(idea.title)}</p></div>`).join("") + `<button class="text-button" data-route="ideas">查看思想档案 →</button>` : `<p class="aside-copy">在 Inbox 将一条笔记标记为“洞见”或“问题”，它会出现在这里。</p>`}`;
  bindRouteButtons(document.querySelector("#recent-ideas"));
}

function reviewCardMarkup(item, position) {
  const note = item.annotation;
  const book = archive.books.find((candidate) => candidate.id === note.bookId);
  const responseLabels = { agree: "仍然认同", doubt: "现在存疑", changed: "已经改变", continue: "继续思考", writing: "可用于写作" };
  const history = item.lastReview ? `<p class="review-history">上次回顾：${responseLabels[item.lastReview.response] || "已回顾"}${item.lastReview.thought ? `——${escapeHtml(item.lastReview.thought)}` : ""}</p>` : "";
  return `<article class="review-card" data-review-card="${note.id}">
    <div class="review-index"><span>REVIEW ${String(position).padStart(2, "0")}</span><span>《${escapeHtml(book?.title || "未知书籍")}》 · ${escapeHtml(note.chapter)}</span></div>
    <blockquote class="review-quote">${escapeHtml(note.originalText)}</blockquote>
    ${note.comment ? `<p class="review-comment">${escapeHtml(note.comment)}</p>` : ""}${history}
    <div class="review-actions" aria-label="现在如何看待这条内容">
      ${Object.entries(responseLabels).map(([value, label]) => `<button class="stance-button" data-stance="${value}" data-annotation-id="${note.id}">${label}</button>`).join("")}
    </div><div class="review-form-slot"></div>
  </article>`;
}

function showReviewResponse(annotationId, response) {
  const card = [...document.querySelectorAll("[data-review-card]")].find((item) => item.dataset.reviewCard === annotationId);
  if (!card) return;
  const labels = { agree: "仍然认同", doubt: "现在存疑", changed: "已经改变", continue: "继续思考", writing: "可用于写作" };
  const slot = card.querySelector(".review-form-slot");
  slot.innerHTML = `<form class="review-response-form"><label class="field-label" for="review-thought-${escapeHtml(annotationId)}">${labels[response]}。现在的你还想补充什么？</label><textarea id="review-thought-${escapeHtml(annotationId)}" name="thought" rows="2" placeholder="可以留空；如果想法改变了，建议写下原因。"></textarea><div class="inline-actions"><button class="button primary" type="submit">记录这次回顾</button><button class="text-button muted" type="button" data-cancel-review>取消</button></div></form>`;
  slot.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const thought = String(new FormData(event.currentTarget).get("thought") || "").trim();
    archive.reviewRecords.push({ id: `review_${Date.now()}_${stableId(annotationId)}`, annotationId, response, thought, reviewedAt: new Date().toISOString() });
    const idea = archive.ideas.find((candidate) => candidate.annotationId === annotationId);
    if (idea && response === "doubt") { idea.status = "challenged"; idea.updatedAt = new Date().toISOString(); }
    if (idea && response === "changed") { idea.status = "revised"; idea.updatedAt = new Date().toISOString(); }
    saveArchive("这次回顾已记录");
    renderToday();
  });
  slot.querySelector("[data-cancel-review]").addEventListener("click", () => { slot.innerHTML = ""; });
  slot.querySelector("textarea").focus();
}

function stableId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(-12);
}

function renderTagOptions() {
  const selected = elements.tag.value;
  const tags = [...new Set(archive.books.flatMap((book) => book.tags))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  elements.tag.innerHTML = `<option value="">全部主题</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}`;
  if (tags.includes(selected)) elements.tag.value = selected;
}

function renderLibrary() {
  renderTagOptions();
  const books = filterBooks(archive.books, archive.annotations, elements.search.value, elements.status.value, elements.tag.value)
    .sort((a, b) => (b.lastReadAt || b.finishedAt || "").localeCompare(a.lastReadAt || a.finishedAt || ""));
  document.querySelector("#result-count").textContent = `显示 ${books.length} / ${archive.books.length} 本`;
  document.querySelector("#library-empty").hidden = books.length > 0;
  elements.bookList.innerHTML = books.map((book) => `
    <button class="book-row" data-book-id="${book.id}" aria-label="打开《${escapeHtml(book.title)}》">
      <span class="mini-cover cover-${book.coverTone}">${escapeHtml(shortTitle(book.title))}</span>
      <span class="book-primary"><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)}</span></span>
      <span class="book-summary">${escapeHtml(book.summary || "尚未写下这本书留下了什么。")}</span>
      <span class="book-tags tag-list">${book.tags.slice(0, 3).map(tagMarkup).join("")}</span>
      <span class="book-progress"><span class="status-label">${statusNames[book.status]}</span><span class="progress-track"><i style="width:${book.progress}%"></i></span></span>
    </button>`).join("");
  elements.bookList.querySelectorAll("[data-book-id]").forEach((row) => row.addEventListener("click", () => route("detail", { bookId: row.dataset.bookId })));
}

function renderDetail() {
  const book = archive.books.find((item) => item.id === activeBookId);
  if (!book) return route("library");
  const notes = archive.annotations.filter((note) => note.bookId === book.id);
  const pending = notes.filter((note) => !note.organized).length;
  elements.detail.innerHTML = `
    <article>
      <div class="detail-hero">
        <div class="large-cover cover-${book.coverTone}">${escapeHtml(book.title)}</div>
        <div class="detail-meta">
          <p class="eyebrow">${statusNames[book.status].toUpperCase()} / ${book.progress}%</p>
          <h1 id="detail-title">${escapeHtml(book.title)}</h1>
          ${book.subtitle ? `<p class="detail-subtitle">${escapeHtml(book.subtitle)}</p>` : ""}
          <p class="detail-author">${escapeHtml(book.author)}${book.publisher ? ` · ${escapeHtml(book.publisher)}` : ""}</p>
          <div class="tag-list">${book.tags.map(tagMarkup).join("")}</div>
          <p class="detail-summary">${escapeHtml(book.summary || "尚未写下这本书真正留下了什么。")}</p>
          <div class="detail-facts">
            <span>${notes.length} 条划线与点评</span>
            <span>${pending} 条待整理</span>
            ${book.finishedAt ? `<span>读完于 ${formatDate(book.finishedAt)}</span>` : ""}
            ${book.rating ? `<span>个人评分 ${book.rating} / 5</span>` : ""}
          </div>
        </div>
      </div>
      ${closureMarkup(book)}
      <div class="detail-body">
        <section>
          <div class="detail-section-head"><h2>划线与点评</h2><span>作者原文与个人想法已分开</span></div>
          ${notes.length ? notes.map(annotationMarkup).join("") : `<div class="empty-state"><p>这本书还没有导入笔记。</p></div>`}
        </section>
        <aside class="detail-aside">
          <section><h3>关于这本书</h3><p>${book.status === "finished" ? "已完成阅读，可继续补充长期留下的观点。" : book.status === "reading" ? `正在阅读，当前进度 ${book.progress}%。` : "已加入想读档案。"}</p></section>
          <section><h3>整理状态</h3><p>${pending ? `还有 ${pending} 条内容没有转化为自己的语言。` : "所有导入内容都已完成初步整理。"}</p>${pending ? `<button class="text-button" data-go-inbox>前往待整理 →</button>` : ""}</section>
          <section><h3>主题</h3><div class="tag-list">${book.tags.map(tagMarkup).join("")}</div></section>
        </aside>
      </div>
    </article>`;
  elements.detail.querySelector("[data-go-inbox]")?.addEventListener("click", () => route("inbox"));
  bindClosure(book);
}

function closureMarkup(book) {
  if (book.status !== "finished") return "";
  const closure = archive.bookClosures[book.id];
  const fields = [
    ["oneSentence", "它真正讨论的是什么"],
    ["changed", "它改变了我什么"],
    ["disagree", "我仍然不同意什么"],
    ["connection", "它与什么产生了连接"],
    ["remember", "三个月后仍想记得什么"],
    ["writing", "可以继续写成什么"]
  ];
  const summary = closure ? `<div class="closure-summary">${fields.filter(([key]) => closure[key]).map(([key, label]) => `<div class="closure-item"><span>${label}</span><p>${escapeHtml(closure[key])}</p></div>`).join("")}</div>` : "";
  const form = `<form class="closure-form" id="closure-form" ${closure ? "hidden" : ""}>${fields.map(([key, label], index) => `<div><label class="field-label" for="closure-${key}">${index + 1}. ${label}</label><textarea id="closure-${key}" name="${key}" rows="2" ${key === "oneSentence" || key === "remember" ? "required" : ""}>${escapeHtml(closure?.[key] || "")}</textarea></div>`).join("")}<div class="inline-actions"><button class="button primary" type="submit">保存结案页</button>${closure ? `<button class="text-button muted" type="button" data-cancel-closure>取消</button>` : ""}</div></form>`;
  return `<section class="closure-section"><div class="closure-head"><div><p class="eyebrow">READING CLOSURE</p><h2>这本书真正留下了什么</h2><p>${closure ? `完成于 ${formatDate(closure.completedAt?.slice(0, 10))}` : "读完不是结束；留下自己的判断，才算完成归档。"}</p></div>${closure ? `<button class="text-button" data-edit-closure>编辑结案页</button>` : ""}</div>${summary}${form}</section>`;
}

function bindClosure(book) {
  const form = document.querySelector("#closure-form");
  if (!form) return;
  document.querySelector("[data-edit-closure]")?.addEventListener("click", () => { form.hidden = false; form.querySelector("textarea").focus(); });
  document.querySelector("[data-cancel-closure]")?.addEventListener("click", () => { form.hidden = true; });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    archive.bookClosures[book.id] = {
      bookId: book.id,
      oneSentence: String(data.get("oneSentence") || "").trim(),
      changed: String(data.get("changed") || "").trim(),
      disagree: String(data.get("disagree") || "").trim(),
      connection: String(data.get("connection") || "").trim(),
      remember: String(data.get("remember") || "").trim(),
      writing: String(data.get("writing") || "").trim(),
      completedAt: archive.bookClosures[book.id]?.completedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveArchive("读完仪式已完成");
    renderDetail();
  });
}

function annotationMarkup(note) {
  if (note.type === "note") return `<article class="annotation">
    <p class="annotation-chapter">${escapeHtml(note.chapter)} · 个人想法 · ${note.organized ? "已整理" : "待整理"}</p>
    <p class="own-comment">${escapeHtml(note.originalText)}</p>
    ${note.tags.length ? `<div class="tag-list" style="margin-top:14px">${note.tags.map(tagMarkup).join("")}</div>` : ""}
  </article>`;
  return `<article class="annotation">
    <p class="annotation-chapter">${escapeHtml(note.chapter)} · ${note.organized ? "已整理" : "待整理"}</p>
    <blockquote>${escapeHtml(note.originalText)}</blockquote>
    ${note.comment ? `<p class="own-comment">${escapeHtml(note.comment)}</p>` : ""}
    ${note.tags.length ? `<div class="tag-list" style="margin-top:14px">${note.tags.map(tagMarkup).join("")}</div>` : ""}
  </article>`;
}

function renderInbox() {
  const note = archive.annotations.find((item) => !item.organized);
  if (!note) {
    elements.inbox.innerHTML = `<div class="inbox-done"><h2>Inbox 已清空</h2><p>所有划线都完成了初步整理。新的导入内容会出现在这里。</p><button class="button" data-route="library">返回书库</button></div>`;
    bindRouteButtons(elements.inbox);
    return;
  }
  const book = archive.books.find((item) => item.id === note.bookId);
  const remaining = archive.annotations.filter((item) => !item.organized).length;
  elements.inbox.innerHTML = `
    <div class="inbox-card">
      <div class="inbox-source"><span>《${escapeHtml(book?.title || "未知书籍")}》 · ${escapeHtml(note.chapter)}</span><span>${remaining} 条待整理</span></div>
      <blockquote class="inbox-quote">${escapeHtml(note.originalText)}</blockquote>
      ${note.comment ? `<p class="inbox-existing">当时的点评：${escapeHtml(note.comment)}</p>` : ""}
      <form class="organize-form" id="organize-form">
        <div><label class="field-label" for="own-words">用自己的话写下一句理解</label><textarea id="own-words" name="comment" rows="3" placeholder="它真正触动我的是什么？">${escapeHtml(note.comment)}</textarea></div>
        <div class="organize-grid">
          <div><label class="field-label" for="note-type">这条内容属于</label><select id="note-type" name="type"><option value="insight">一个洞见</option><option value="question">一个问题</option><option value="agreement">认同</option><option value="disagreement">存疑或反驳</option><option value="connection">与其他内容的连接</option></select></div>
          <div><label class="field-label" for="note-tags">标签，以逗号分隔</label><input id="note-tags" name="tags" value="${escapeHtml(note.tags.join(", "))}" style="width:100%;height:42px;padding:0 12px;border:1px solid var(--line);background:var(--surface)"></div>
        </div>
        <div class="inline-actions"><button class="button primary" type="submit">保存并处理下一条</button><button class="text-button muted" type="button" id="skip-note">暂时跳过</button></div>
      </form>
    </div>`;
  document.querySelector("#organize-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    note.comment = String(data.get("comment") || "").trim();
    note.tags = String(data.get("tags") || "").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    note.reflectionType = data.get("type");
    note.organized = true;
    if (["insight", "question"].includes(note.reflectionType) && !archive.ideas.some((idea) => idea.annotationId === note.id)) {
      archive.ideas.push(makeIdeaFromAnnotation(note, book));
    }
    saveArchive("已整理，下一条已就绪");
    renderInbox();
  });
  document.querySelector("#skip-note").addEventListener("click", () => {
    const index = archive.annotations.indexOf(note);
    archive.annotations.push(...archive.annotations.splice(index, 1));
    saveArchive("");
    renderInbox();
  });
}

function renderIdeas() {
  document.querySelectorAll("[data-idea-filter]").forEach((button) => button.classList.toggle("active", button.dataset.ideaFilter === ideaFilter));
  const ideas = [...archive.ideas]
    .filter((idea) => ideaFilter === "all" || idea.type === ideaFilter)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const statusLabels = { open: "仍待回答", tentative: "暂时认同", challenged: "正在存疑", revised: "观点已变化" };
  elements.ideaList.innerHTML = ideas.length ? ideas.map((idea) => {
    const book = archive.books.find((candidate) => candidate.id === idea.bookId);
    const history = idea.annotationId ? archive.reviewRecords.filter((record) => record.annotationId === idea.annotationId).sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt))) : [];
    return `<article class="idea-row">
      <div class="idea-kind">${idea.type === "question" ? "QUESTION" : "CLAIM"}</div>
      <div class="idea-main"><h3>${escapeHtml(idea.title)}</h3>${idea.content && idea.content !== idea.title ? `<p>${escapeHtml(idea.content)}</p>` : ""}${book ? `<p class="idea-source"><button class="text-button" data-idea-book="${book.id}">来自《${escapeHtml(book.title)}》 →</button></p>` : ""}</div>
      <div class="idea-meta"><span class="idea-status">${statusLabels[idea.status] || "持续思考"}</span>${history.length ? `最近回顾 ${formatDate(history[0].reviewedAt.slice(0, 10))}${history[0].thought ? `<br>${escapeHtml(history[0].thought)}` : ""}` : "尚未重新回顾"}</div>
    </article>`;
  }).join("") : `<div class="empty-state"><p>${ideaFilter === "all" ? "还没有形成观点或问题。" : `还没有${ideaFilter === "claim" ? "观点" : "问题"}。`}</p><p>可以从 Inbox 转化，也可以直接新建。</p></div>`;
  elements.ideaList.querySelectorAll("[data-idea-book]").forEach((button) => button.addEventListener("click", () => route("detail", { bookId: button.dataset.ideaBook })));
}

function saveStandaloneIdea(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const now = new Date().toISOString();
  const title = String(data.get("title") || "").trim();
  const type = data.get("type") === "question" ? "question" : "claim";
  archive.ideas.push({
    id: `idea_manual_${Date.now()}`,
    type,
    title,
    content: String(data.get("content") || "").trim(),
    status: type === "question" ? "open" : "tentative",
    annotationId: "",
    bookId: "",
    sourceTitle: "",
    sourceExcerpt: "",
    createdAt: now,
    updatedAt: now
  });
  event.currentTarget.reset();
  event.currentTarget.hidden = true;
  saveArchive("观点档案已保存");
  renderIdeas();
}

function parseImport(raw) {
  const payload = normalizeArchive(JSON.parse(raw));
  pendingPreview = previewMerge(archive, payload);
  pendingSource = "import";
  pendingSyncSummary = null;
  elements.importPlaceholder.hidden = true;
  elements.importPreview.hidden = false;
  const archiveLayerChanges = pendingPreview.newIdeas.length + pendingPreview.newReviewRecords.length + Object.keys(pendingPreview.updatedBookClosures).length;
  const totalNew = pendingPreview.newBooks.length + pendingPreview.updatedBooks.length + pendingPreview.newAnnotations.length + archiveLayerChanges;
  elements.importPreview.innerHTML = `
    <div class="preview-stats">
      <div class="preview-stat"><strong>${pendingPreview.newBooks.length}</strong><span>新增书籍</span></div>
      <div class="preview-stat"><strong>${pendingPreview.newAnnotations.length}</strong><span>新增笔记</span></div>
      <div class="preview-stat"><strong>${pendingPreview.updatedBooks.length}</strong><span>更新书籍</span></div>
      <div class="preview-stat"><strong>${pendingPreview.duplicateAnnotations.length}</strong><span>重复笔记</span></div>
    </div>
    ${pendingPreview.newBooks.length ? `<h3>即将加入</h3><ul class="preview-list">${pendingPreview.newBooks.map((book) => `<li><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)}</span></li>`).join("")}</ul>` : ""}
    ${archiveLayerChanges ? `<p class="sync-notes">同时恢复 ${pendingPreview.newIdeas.length} 条观点/问题、${pendingPreview.newReviewRecords.length} 条回顾记录和 ${Object.keys(pendingPreview.updatedBookClosures).length} 份结案页。</p>` : ""}
    <button class="button primary" id="confirm-import" ${totalNew ? "" : "disabled"}>确认写入 ${totalNew} 项变更</button>`;
  document.querySelector("#confirm-import").addEventListener("click", confirmImport);
}

function confirmImport() {
  if (!pendingPreview) return;
  const added = pendingPreview.newBooks.length + pendingPreview.updatedBooks.length + pendingPreview.newAnnotations.length + pendingPreview.newIdeas.length + pendingPreview.newReviewRecords.length + Object.keys(pendingPreview.updatedBookClosures).length;
  archive = mergeArchive(archive, pendingPreview);
  if (pendingSource === "weread") archive.lastWeReadSync = { syncedAt: new Date().toISOString(), ...pendingSyncSummary };
  saveArchive(pendingSource === "weread" ? `微信读书同步完成：写入 ${added} 项变更` : `已导入 ${added} 条记录`);
  pendingPreview = null;
  pendingSyncSummary = null;
  elements.importText.value = "";
  elements.importPreview.hidden = true;
  elements.importPlaceholder.hidden = false;
  elements.syncPreviewSection.hidden = true;
  route("library");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

async function refreshWeReadStatus() {
  try {
    const status = await requestJson("/api/weread/status");
    elements.syncDot.classList.toggle("connected", status.configured);
    elements.syncDot.setAttribute("aria-label", status.configured ? "已连接" : "未连接");
    elements.connectionState.classList.toggle("connected", status.configured);
    elements.connectionState.textContent = status.configured ? `已连接 · ${status.keyHint}` : "尚未连接";
    elements.startSync.disabled = !status.configured;
    document.querySelector("#key-setup").classList.toggle("configured", status.configured);
    if (status.configured) document.querySelector("#connect-status").textContent = "需要更换账号时，可粘贴新的 Key。";
  } catch (error) {
    elements.connectionState.textContent = "本地服务未响应";
    elements.startSync.disabled = true;
    elements.syncError.textContent = error.message;
  }
}

async function connectWeRead() {
  const button = document.querySelector("#connect-weread");
  const input = document.querySelector("#weread-key");
  const status = document.querySelector("#connect-status");
  const apiKey = input.value.trim();
  status.textContent = "";
  elements.syncError.textContent = "";
  if (!/^wrk-[A-Za-z0-9_-]+$/.test(apiKey)) {
    status.textContent = "请粘贴以 wrk- 开头的完整 API Key。";
    return;
  }
  button.disabled = true;
  button.textContent = "正在验证…";
  try {
    const result = await requestJson("/api/weread/config", { method: "POST", body: JSON.stringify({ apiKey }) });
    input.value = "";
    status.textContent = `连接成功 · ${result.keyHint}`;
    showToast("微信读书已连接");
    await refreshWeReadStatus();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "验证并安全保存";
  }
}

async function startWeReadSync() {
  const originalText = elements.startSync.textContent;
  elements.startSync.disabled = true;
  elements.startSync.textContent = "正在读取微信读书…";
  elements.syncError.textContent = "";
  elements.syncPreviewSection.hidden = true;
  try {
    const payload = await requestJson("/api/weread/sync", {
      method: "POST",
      body: JSON.stringify({
        notebookLimit: Number(document.querySelector("#sync-limit").value),
        includeShelf: document.querySelector("#include-shelf").checked
      })
    });
    const normalized = normalizeArchive(payload);
    pendingPreview = previewMerge(archive, normalized);
    pendingSource = "weread";
    pendingSyncSummary = payload.syncSummary || {};
    renderWeReadPreview();
  } catch (error) {
    elements.syncError.textContent = error.message;
  } finally {
    elements.startSync.disabled = false;
    elements.startSync.textContent = originalText;
  }
}

function renderWeReadPreview() {
  const summary = pendingSyncSummary || {};
  const changes = pendingPreview.newBooks.length + pendingPreview.updatedBooks.length + pendingPreview.newAnnotations.length;
  elements.syncPreviewSection.hidden = false;
  document.querySelector("#sync-source-summary").textContent = `官方返回 ${summary.fetchedNotebookCount ?? 0} 本有笔记的书、${summary.fetchedAnnotationCount ?? 0} 条可导出内容`;
  elements.syncPreview.innerHTML = `
    <div class="preview-stats sync-stats">
      <div class="preview-stat"><strong>${pendingPreview.newBooks.length}</strong><span>新增书籍</span></div>
      <div class="preview-stat"><strong>${pendingPreview.updatedBooks.length}</strong><span>更新现有书籍</span></div>
      <div class="preview-stat"><strong>${pendingPreview.newAnnotations.length}</strong><span>新增划线与想法</span></div>
      <div class="preview-stat"><strong>${pendingPreview.duplicateAnnotations.length}</strong><span>已存在，自动跳过</span></div>
    </div>
    <div class="sync-notes">
      <p>微信读书统计口径共 ${summary.officialNoteCount ?? "—"} 条笔记（包含书签）；本次接口可导出 ${summary.fetchedAnnotationCount ?? 0} 条划线与想法。书签正文暂不由官方接口提供。</p>
    </div>
    ${pendingPreview.newBooks.length ? `<h3>新增书籍</h3><ul class="preview-list">${pendingPreview.newBooks.slice(0, 12).map((book) => `<li><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)}</span></li>`).join("")}</ul>` : ""}
    <button class="button primary" id="confirm-weread" ${changes ? "" : "disabled"}>确认同步 ${changes} 项变更</button>`;
  document.querySelector("#confirm-weread").addEventListener("click", confirmImport);
  elements.syncPreviewSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

const sourceTypeNames = {
  book: "书籍", original: "作者原文", comment: "我的点评", reflection: "个人想法",
  idea: "观点 / 问题", closure: "读完结案", review: "回顾后的想法"
};

function renderThoughtMap() {
  const map = buildTopicMap(archive);
  const stats = document.querySelector("#map-stats");
  const connectedBooks = new Set(map.topics.flatMap((topic) => topic.books)).size;
  stats.innerHTML = `<span><strong>${map.topics.length}</strong> 个主题</span><span><strong>${connectedBooks}</strong> 本书</span><span><strong>${map.edges.length}</strong> 条连接</span>`;
  if (!map.topics.length) {
    elements.topicList.innerHTML = "";
    elements.topicWorkspace.innerHTML = `<div class="map-empty"><h2>还没有足够的主题数据</h2><p>为书籍或笔记添加标签后，主题之间的关系会自动出现在这里。</p><button class="button" data-route="inbox">前往待整理</button></div>`;
    bindRouteButtons(elements.topicWorkspace);
    return;
  }
  if (!map.topics.some((topic) => topic.name === selectedTopic)) selectedTopic = map.topics[0].name;
  const maxRecords = Math.max(...map.topics.map((topic) => topic.records), 1);
  elements.topicList.innerHTML = map.topics.map((topic, index) => `<button class="topic-row ${topic.name === selectedTopic ? "active" : ""}" data-topic="${escapeHtml(topic.name)}" role="option" aria-selected="${topic.name === selectedTopic}">
    <span class="topic-rank">${String(index + 1).padStart(2, "0")}</span><span class="topic-name">${escapeHtml(topic.name)}</span><span class="topic-count">${topic.books.length} BOOK${topic.books.length === 1 ? "" : "S"}</span>
    <i style="--topic-strength:${Math.max(.12, topic.records / maxRecords)}"></i>
  </button>`).join("");
  elements.topicList.querySelectorAll("[data-topic]").forEach((button) => button.addEventListener("click", () => {
    selectedTopic = button.dataset.topic;
    renderThoughtMap();
  }));
  renderTopicWorkspace(map, selectedTopic);
}

function renderTopicWorkspace(map, topicName) {
  const topic = map.topics.find((item) => item.name === topicName);
  const related = relatedTopics(map, topicName);
  const timeline = buildTopicTimeline(archive, topicName);
  const books = topic.books.map((bookId) => archive.books.find((book) => book.id === bookId)).filter(Boolean);
  const stageLabels = { encounter: "初次接触", source: "保存原文", response: "当时回应", question: "形成问题", position: "形成观点", synthesis: "读完结论", revisit: "再次回看", revision: "观点修正" };
  const kindLabels = { book: "BOOK", original: "SOURCE", comment: "COMMENT", reflection: "NOTE", idea: "IDEA", closure: "CLOSURE", review: "REVIEW" };
  elements.topicWorkspace.innerHTML = `
    <header class="topic-hero">
      <div><p class="section-number">SELECTED THREAD</p><h2>${escapeHtml(topic.name)}</h2><p>这个主题出现在 ${topic.books.length} 本书和 ${topic.records} 条档案信号中。</p></div>
      <span class="topic-range">${topic.firstSeen ? formatDate(topic.firstSeen.slice(0, 10)) : "—"}<i></i>${topic.lastSeen ? formatDate(topic.lastSeen.slice(0, 10)) : "—"}</span>
    </header>
    <section class="relation-panel">
      <div class="map-section-head"><h3>与它共同出现的主题</h3><span>RELATION NETWORK</span></div>
      <div class="relation-network">
        <div class="relation-core">${escapeHtml(topic.name)}</div>
        <div class="relation-links">${related.length ? related.map((item) => `<button data-related-topic="${escapeHtml(item.name)}"><strong>${escapeHtml(item.name)}</strong><small>${item.weight} 次共同出现</small></button>`).join("") : `<p>暂时没有跨主题连接。</p>`}</div>
      </div>
      ${books.length ? `<div class="topic-books">${books.map((book) => `<button data-map-book="${book.id}">《${escapeHtml(book.title)}》</button>`).join("")}</div>` : ""}
    </section>
    <section class="timeline-panel">
      <div class="map-section-head"><h3>观点演化时间线</h3><span>${timeline.length} EVENTS</span></div>
      <div class="thought-timeline">${timeline.length ? timeline.map((event) => `<article class="timeline-event ${event.stage === "revision" ? "changed" : ""}">
        <div class="timeline-date">${escapeHtml(formatDate(event.date.slice(0, 10)))}</div>
        <div class="timeline-axis"><i></i></div>
        <div class="timeline-content"><div class="timeline-label"><span>${kindLabels[event.type] || "ARCHIVE"}</span><strong>${stageLabels[event.stage] || "持续思考"}</strong></div><h4>${escapeHtml(event.title)}</h4>${event.quote ? `<blockquote>${escapeHtml(event.quote)}</blockquote>` : ""}<p>${escapeHtml(event.text || "")}</p>${event.bookId ? `<button class="text-button" data-map-book="${event.bookId}">${escapeHtml(event.bookTitle || "查看来源")} →</button>` : ""}</div>
      </article>`).join("") : `<div class="map-empty"><p>这个主题还没有带日期的演化记录。</p></div>`}</div>
    </section>`;
  elements.topicWorkspace.querySelectorAll("[data-related-topic]").forEach((button) => button.addEventListener("click", () => { selectedTopic = button.dataset.relatedTopic; renderThoughtMap(); }));
  elements.topicWorkspace.querySelectorAll("[data-map-book]").forEach((button) => button.addEventListener("click", () => route("detail", { bookId: button.dataset.mapBook })));
}

async function refreshOpenAIStatus() {
  const status = document.querySelector("#ai-mode-status");
  try {
    const result = await requestJson("/api/openai/status");
    openAIConfigured = result.configured;
    elements.useAI.disabled = !result.configured;
    if (!result.configured) elements.useAI.checked = false;
    status.textContent = result.configured ? `已配置 · ${result.model}` : "未配置时使用本地摘要";
    document.querySelector("#openai-model").value = result.model || "gpt-5.6";
    document.querySelector("#index-state").textContent = result.configured ? "LOCAL INDEX + AI" : "LOCAL INDEX";
  } catch {
    openAIConfigured = false;
    elements.useAI.disabled = true;
    status.textContent = "本地服务未响应";
  }
}

async function saveOpenAIConfig() {
  const button = document.querySelector("#save-openai");
  const input = document.querySelector("#openai-key");
  const status = document.querySelector("#openai-config-status");
  const apiKey = input.value.trim();
  if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(apiKey)) {
    status.textContent = "请粘贴完整的 sk- API Key。";
    return;
  }
  button.disabled = true;
  button.textContent = "正在保存…";
  try {
    const result = await requestJson("/api/openai/config", {
      method: "POST",
      body: JSON.stringify({ apiKey, model: document.querySelector("#openai-model").value.trim() })
    });
    input.value = "";
    status.textContent = `已保存 · ${result.keyHint}`;
    elements.useAI.checked = true;
    await refreshOpenAIStatus();
    showToast("AI 综合回答已启用");
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "安全保存";
  }
}

function answerMarkup(result, sourceRefs) {
  const allowed = new Set(sourceRefs);
  const evidence = { sufficient: "证据较充分", partial: "证据有限", none: "未找到证据" }[result.evidenceState] || "证据有限";
  const safe = escapeHtml(result.answer).replace(/\[(S\d+)\]/g, (match, ref) => allowed.has(ref) ? `<button class="citation-link" data-citation="${ref}">[${ref}]</button>` : match).replace(/\n/g, "<br>");
  const followUps = (result.followUps || []).slice(0, 3);
  return `<article class="answer-panel">
    <div class="answer-meta"><span>${result.provider === "openai" ? "AI SYNTHESIS" : "LOCAL SUMMARY"}</span><span class="evidence-state ${result.evidenceState}">${evidence}</span></div>
    <h2>档案回答</h2><div class="answer-copy">${safe}</div>
    ${followUps.length ? `<div class="followup-list"><span>继续追问</span>${followUps.map((question) => `<button type="button" data-followup="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("")}</div>` : ""}
  </article>`;
}

function renderSearchSources(results) {
  const sources = prepareSources(results);
  elements.sourceSection.hidden = !sources.length;
  document.querySelector("#source-count").textContent = `${sources.length} / ${results.length} 条命中`;
  elements.sourceList.innerHTML = sources.map((source, index) => {
    const result = results[index];
    return `<article class="source-card" id="source-${source.ref}" data-source-book="${escapeHtml(result.bookId || "")}">
      <div class="source-top"><span class="source-ref">${source.ref}</span><span class="source-kind">${sourceTypeNames[source.type] || "档案"}</span><span class="source-date">${escapeHtml(formatDate(source.date))}</span></div>
      <h3>${escapeHtml(source.title || source.bookTitle || "未命名来源")}</h3>
      ${source.bookTitle ? `<p class="source-book">《${escapeHtml(source.bookTitle)}》</p>` : ""}
      <p class="source-text">${escapeHtml(source.text)}</p>
      ${result.bookId ? `<button class="text-button source-open" type="button">回到书籍 →</button>` : ""}
    </article>`;
  }).join("");
  elements.sourceList.querySelectorAll(".source-open").forEach((button) => button.addEventListener("click", () => {
    const bookId = button.closest(".source-card").dataset.sourceBook;
    if (bookId) route("detail", { bookId });
  }));
}

function bindAnswerActions() {
  elements.askOutput.querySelectorAll("[data-citation]").forEach((button) => button.addEventListener("click", () => {
    const card = document.querySelector(`#source-${button.dataset.citation}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("source-flash");
    setTimeout(() => card?.classList.remove("source-flash"), 1200);
  }));
  elements.askOutput.querySelectorAll("[data-followup]").forEach((button) => button.addEventListener("click", () => {
    elements.archiveQuery.value = button.dataset.followup;
    elements.archiveQuery.focus();
  }));
}

async function runArchiveSearch(event) {
  event?.preventDefault();
  const question = elements.archiveQuery.value.trim();
  if (!question) return;
  const submit = document.querySelector("#run-archive-search");
  submit.disabled = true;
  submit.textContent = "正在检索…";
  lastSearchResults = searchArchive(archive, question, { scope: searchScope, limit: 24 });
  renderSearchSources(lastSearchResults);
  let result = composeLocalAnswer(question, lastSearchResults);
  if (elements.useAI.checked && openAIConfigured && lastSearchResults.length) {
    elements.askOutput.innerHTML = `<div class="ask-loading"><span></span><p>正在比对 ${Math.min(12, lastSearchResults.length)} 条档案证据…</p></div>`;
    try {
      result = await requestJson("/api/archive/ask", { method: "POST", body: JSON.stringify({ question, sources: prepareSources(lastSearchResults) }) });
    } catch (error) {
      showToast(`AI 暂不可用，已改用本地摘要：${error.message}`);
    }
  }
  const refs = prepareSources(lastSearchResults).map((source) => source.ref);
  elements.askOutput.innerHTML = answerMarkup(result, refs);
  bindAnswerActions();
  archive.askHistory = [{ id: `ask_${Date.now()}`, question, mode: result.provider === "openai" ? "openai" : "local", answer: result.answer, evidenceState: result.evidenceState, citations: result.citations || [], askedAt: new Date().toISOString() }, ...(archive.askHistory || [])].slice(0, 50);
  saveArchive("");
  submit.disabled = false;
  submit.textContent = "查询档案";
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast(`已生成 ${filename}`);
}

function tagMarkup(tag) { return `<span class="tag">${escapeHtml(tag)}</span>`; }
function shortTitle(title) { return title.length > 6 ? `${title.slice(0, 5)}…` : title; }
function formatDate(value) { return value ? value.replaceAll("-", ".") : ""; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

function bindRouteButtons(root = document) {
  root.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => route(button.dataset.route)));
}

bindRouteButtons();
[elements.search, elements.status, elements.tag].forEach((control) => control.addEventListener(control === elements.search ? "input" : "change", renderLibrary));
document.querySelector("#clear-filters").addEventListener("click", () => { elements.search.value = ""; elements.status.value = ""; elements.tag.value = ""; renderLibrary(); });
document.querySelector("#preview-import").addEventListener("click", () => {
  elements.importError.textContent = "";
  try { parseImport(elements.importText.value); } catch (error) { elements.importError.textContent = `无法导入：${error.message}`; }
});
document.querySelector("#connect-weread").addEventListener("click", connectWeRead);
elements.startSync.addEventListener("click", startWeReadSync);
document.querySelector("#archive-search-form").addEventListener("submit", runArchiveSearch);
document.querySelectorAll("[data-search-scope]").forEach((button) => button.addEventListener("click", () => {
  searchScope = button.dataset.searchScope;
  document.querySelectorAll("[data-search-scope]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
  if (elements.archiveQuery.value.trim()) runArchiveSearch();
}));
document.querySelectorAll("[data-query]").forEach((button) => button.addEventListener("click", () => {
  elements.archiveQuery.value = button.dataset.query;
  elements.archiveQuery.focus();
}));
document.querySelector("#ai-config-toggle").addEventListener("click", (event) => {
  const body = document.querySelector("#ai-config-body");
  body.hidden = !body.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!body.hidden));
  event.currentTarget.querySelector("span").textContent = body.hidden ? "＋" : "−";
});
document.querySelector("#save-openai").addEventListener("click", saveOpenAIConfig);
document.querySelector("#theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
document.querySelector("#text-size-toggle").addEventListener("click", openDisplaySettings);
document.querySelector("#display-settings-open").addEventListener("click", openDisplaySettings);
document.querySelectorAll("[data-text-size-option]").forEach(button => {
  button.addEventListener("click", () => applyTextSize(button.dataset.textSizeOption));
});
document.querySelector("#reading-line-height").addEventListener("change", event => applyLineHeight(event.target.value));
document.querySelector("#display-reset").addEventListener("click", () => {
  applyTextSize("comfortable");
  applyLineHeight("1.85");
});
document.querySelector("#new-idea").addEventListener("click", () => {
  const form = document.querySelector("#idea-composer");
  form.hidden = false;
  form.querySelector("input").focus();
});
document.querySelector("#cancel-idea").addEventListener("click", () => { document.querySelector("#idea-composer").hidden = true; });
document.querySelector("#idea-composer").addEventListener("submit", saveStandaloneIdea);
document.querySelectorAll("[data-idea-filter]").forEach((button) => button.addEventListener("click", () => { ideaFilter = button.dataset.ideaFilter; renderIdeas(); }));
elements.importFile.addEventListener("change", async () => {
  const [file] = elements.importFile.files;
  if (file) elements.importText.value = await file.text();
});
document.querySelector("#export-json").addEventListener("click", () => download(`reading-archive-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(archive, null, 2), "application/json"));
document.querySelector("#export-markdown").addEventListener("click", () => download(`reading-archive-${new Date().toISOString().slice(0, 10)}.md`, toMarkdown(archive), "text/markdown"));
document.querySelector("#reset-demo").addEventListener("click", () => {
  if (!window.confirm("恢复示例数据会覆盖当前浏览器中的档案，确定继续吗？")) return;
  archive = upgradeArchiveShape(clone(demoArchive));
  saveArchive("示例数据已恢复");
  route("library");
});
document.addEventListener("keydown", (event) => {
  if (document.querySelector("#display-settings").open) return;
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); (document.querySelector("#view-ask").classList.contains("active") ? elements.archiveQuery : elements.search).focus(); }
  if (event.key.toLowerCase() === "l" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) route("library");
  if (event.key.toLowerCase() === "i" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) route("import");
  if (event.key.toLowerCase() === "t" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) route("today");
  if (event.key.toLowerCase() === "m" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) route("map");
});

initializeTheme();
applyTextSize(localStorage.getItem(TEXT_SIZE_KEY) || "comfortable");
applyLineHeight(localStorage.getItem(LINE_HEIGHT_KEY) || "1.85");
renderCounts();
renderLibrary();
renderToday();
refreshWeReadStatus();
