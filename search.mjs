const MY_TYPES = new Set(["comment", "reflection", "idea", "closure", "review"]);
const STOP_TERMS = new Set(["什么", "哪些", "怎么", "如何", "为什么", "是否", "我的", "我对", "关于", "看法", "观点", "发生", "变化", "有没有", "可以", "一个"]);

function clean(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function searchable(value) {
  return clean(value).toLocaleLowerCase("zh-CN").replace(/[，。！？、；：“”‘’（）()\[\]《》,.!?;:'"-]/g, " ");
}

function queryTerms(query) {
  const normalized = searchable(query);
  const terms = new Set(normalized.split(/\s+/).filter((term) => term.length >= 2 && !STOP_TERMS.has(term)));
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) || []) {
    if (sequence.length <= 4 && !STOP_TERMS.has(sequence)) terms.add(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) {
      const pair = sequence.slice(index, index + 2);
      if (!STOP_TERMS.has(pair) && !/[我的了是有在和与对]/.test(pair)) terms.add(pair);
    }
  }
  return [...terms];
}

function excerpt(value, max = 220) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildSearchDocuments(archive) {
  const books = new Map((archive.books || []).map((book) => [book.id, book]));
  const notes = new Map((archive.annotations || []).map((note) => [note.id, note]));
  const documents = [];
  const add = (document) => {
    const title = clean(document.title);
    const body = clean(document.body);
    if (!title && !body) return;
    documents.push({ ...document, title, body, searchText: searchable(`${title} ${body} ${(document.tags || []).join(" ")} ${document.bookTitle || ""}`) });
  };

  for (const book of archive.books || []) {
    add({ id: `book:${book.id}`, type: "book", title: book.title, body: [book.author, book.summary, book.category, ...(book.tags || [])].filter(Boolean).join(" · "), bookId: book.id, bookTitle: book.title, date: book.lastReadAt || book.finishedAt || "", tags: book.tags || [] });
  }
  for (const note of archive.annotations || []) {
    const book = books.get(note.bookId);
    if (note.type === "note") {
      add({ id: `reflection:${note.id}`, type: "reflection", title: `个人想法 · ${note.chapter}`, body: note.originalText, bookId: note.bookId, annotationId: note.id, bookTitle: book?.title || "", date: note.sourceCreatedAt, tags: note.tags || [] });
    } else {
      add({ id: `original:${note.id}`, type: "original", title: note.chapter || "划线原文", body: note.originalText, bookId: note.bookId, annotationId: note.id, bookTitle: book?.title || "", date: note.sourceCreatedAt, tags: note.tags || [] });
      if (note.comment) add({ id: `comment:${note.id}`, type: "comment", title: `我的点评 · ${note.chapter}`, body: note.comment, bookId: note.bookId, annotationId: note.id, bookTitle: book?.title || "", date: note.sourceCreatedAt, tags: note.tags || [] });
    }
  }
  for (const idea of archive.ideas || []) {
    const book = books.get(idea.bookId);
    add({ id: `idea:${idea.id}`, type: "idea", title: idea.title, body: idea.content, bookId: idea.bookId, annotationId: idea.annotationId, bookTitle: book?.title || idea.sourceTitle || "", date: idea.updatedAt, tags: [idea.type, idea.status] });
  }
  for (const [bookId, closure] of Object.entries(archive.bookClosures || {})) {
    const book = books.get(bookId);
    const body = [closure.oneSentence, closure.changed, closure.disagree, closure.connection, closure.remember, closure.writing].filter(Boolean).join("；");
    add({ id: `closure:${bookId}`, type: "closure", title: `读完结案 · ${book?.title || "未知书籍"}`, body, bookId, bookTitle: book?.title || "", date: closure.updatedAt || closure.completedAt, tags: [] });
  }
  for (const record of archive.reviewRecords || []) {
    if (!record.thought) continue;
    const note = notes.get(record.annotationId);
    const book = books.get(note?.bookId);
    add({ id: `review:${record.id}`, type: "review", title: "回顾后的新想法", body: record.thought, bookId: note?.bookId || "", annotationId: record.annotationId, bookTitle: book?.title || "", date: record.reviewedAt, tags: [record.response] });
  }
  return documents;
}

export function searchArchive(archive, query, { scope = "all", limit = 24 } = {}) {
  const phrase = searchable(query);
  const terms = queryTerms(query);
  if (!phrase) return [];
  return buildSearchDocuments(archive).filter((document) => {
    if (scope === "mine") return MY_TYPES.has(document.type);
    if (scope === "original") return document.type === "original";
    if (scope === "books") return document.type === "book";
    if (scope === "ideas") return document.type === "idea";
    return true;
  }).map((document) => {
    const title = searchable(document.title);
    let score = document.searchText.includes(phrase) ? 80 : 0;
    for (const term of terms) {
      if (title.includes(term)) score += 16;
      if (document.searchText.includes(term)) score += 6;
    }
    if (MY_TYPES.has(document.type)) score += 2;
    return { ...document, score, excerpt: excerpt(document.body) };
  }).filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)))
    .slice(0, Math.max(1, limit));
}

export function composeLocalAnswer(query, results) {
  if (!results.length) return { answer: `在当前档案中没有找到足以回答“${clean(query)}”的内容。可以尝试缩短问题，或换成书名、作者、主题词。`, citations: [], evidenceState: "none", followUps: ["只搜索我自己的话", "查看尚未回答的问题"] };
  const top = results.slice(0, 5).map((result, index) => ({ ...result, ref: `S${index + 1}` }));
  const books = [...new Set(top.map((result) => result.bookTitle).filter(Boolean))];
  const answer = `档案里找到 ${results.length} 条相关记录${books.length ? `，主要来自《${books.slice(0, 3).join("》《")}》` : ""}。最直接的线索是：${top.slice(0, 3).map((result) => `${result.excerpt} [${result.ref}]`).join("；")}。这是基于关键词与原始档案生成的本地摘要，尚未对观点之间的关系作模型推断。`;
  return { answer, citations: top.map((result) => result.ref), evidenceState: results.length >= 3 ? "sufficient" : "partial", followUps: books.slice(0, 2).map((book) => `只看《${book}》中的相关内容`) };
}

export function prepareSources(results, limit = 12) {
  return results.slice(0, limit).map((result, index) => ({
    ref: `S${index + 1}`,
    type: result.type,
    title: result.title,
    bookTitle: result.bookTitle,
    text: excerpt(result.body, 700),
    date: result.date || ""
  }));
}

export { MY_TYPES };
