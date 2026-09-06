export function stableHash(value) {
  let hash = 2166136261;
  const input = String(value).trim().replace(/\s+/g, " ");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function upgradeArchiveShape(value) {
  const archive = value && typeof value === "object" ? value : {};
  return {
    ...archive,
    version: Math.max(4, Number(archive.version) || 1),
    books: Array.isArray(archive.books) ? archive.books : [],
    annotations: Array.isArray(archive.annotations) ? archive.annotations : [],
    reflections: Array.isArray(archive.reflections) ? archive.reflections : [],
    ideas: Array.isArray(archive.ideas) ? archive.ideas : [],
    askHistory: Array.isArray(archive.askHistory) ? archive.askHistory : [],
    reviewRecords: Array.isArray(archive.reviewRecords) ? archive.reviewRecords : [],
    bookClosures: archive.bookClosures && typeof archive.bookClosures === "object" ? archive.bookClosures : {}
  };
}

export function selectReviewItems(archive, count = 3, now = new Date()) {
  const recordsByAnnotation = new Map();
  for (const record of archive.reviewRecords || []) {
    const previous = recordsByAnnotation.get(record.annotationId);
    if (!previous || String(record.reviewedAt) > String(previous.reviewedAt)) recordsByAnnotation.set(record.annotationId, record);
  }
  return (archive.annotations || []).map((annotation) => {
    const lastReview = recordsByAnnotation.get(annotation.id);
    const lastDate = lastReview?.reviewedAt ? new Date(lastReview.reviewedAt) : null;
    const ageDays = lastDate && !Number.isNaN(lastDate.valueOf()) ? Math.floor((now - lastDate) / 86_400_000) : 100_000;
    const importance = (annotation.comment ? 35 : 0) + (annotation.organized ? 20 : 0) + Math.min(15, (annotation.tags || []).length * 5);
    return { annotation, lastReview, score: ageDays + importance };
  }).filter((item) => item.annotation.organized || item.annotation.comment || item.annotation.type === "note")
    .filter((item) => !item.lastReview || item.score >= 7)
    .sort((a, b) => b.score - a.score || String(a.annotation.id).localeCompare(String(b.annotation.id)))
    .slice(0, Math.max(0, count));
}

export function makeIdeaFromAnnotation(annotation, book, createdAt = new Date().toISOString()) {
  const isQuestion = annotation.reflectionType === "question";
  const content = (annotation.comment || annotation.originalText || "").trim();
  const title = content.split(/[。！？!?\n]/).find(Boolean)?.trim().slice(0, 72) || (isQuestion ? "未命名问题" : "未命名观点");
  return {
    id: `idea_${stableHash(`${annotation.id}|${annotation.reflectionType || "insight"}`)}`,
    type: isQuestion ? "question" : "claim",
    title,
    content,
    status: isQuestion ? "open" : "tentative",
    annotationId: annotation.id,
    bookId: annotation.bookId,
    sourceTitle: book?.title || "",
    sourceExcerpt: annotation.originalText || "",
    createdAt,
    updatedAt: createdAt
  };
}

export function normalizeArchive(payload) {
  if (!payload || typeof payload !== "object") throw new Error("导入内容必须是 JSON 对象");
  const books = Array.isArray(payload.books) ? payload.books : [];
  const annotations = Array.isArray(payload.annotations) ? payload.annotations : [];
  const reflections = Array.isArray(payload.reflections) ? payload.reflections : [];
  const ideas = Array.isArray(payload.ideas) ? payload.ideas : [];
  const reviewRecords = Array.isArray(payload.reviewRecords) ? payload.reviewRecords : [];
  const askHistory = Array.isArray(payload.askHistory) ? payload.askHistory : [];
  const bookClosures = payload.bookClosures && typeof payload.bookClosures === "object" ? payload.bookClosures : {};

  const normalizedBooks = books.map((book, index) => {
    if (!book.title?.trim()) throw new Error(`第 ${index + 1} 本书缺少 title`);
    const id = String(book.id || `book_${stableHash(`${book.title}|${book.author || ""}`)}`);
    return {
      id,
      title: book.title.trim(),
      subtitle: book.subtitle?.trim() || "",
      author: book.author?.trim() || "佚名",
      publisher: book.publisher?.trim() || "",
      cover: book.cover?.trim() || "",
      category: book.category?.trim() || "",
      status: ["reading", "finished", "wishlist"].includes(book.status) ? book.status : "reading",
      progress: Math.min(100, Math.max(0, Number(book.progress) || 0)),
      rating: Math.min(5, Math.max(0, Number(book.rating) || 0)),
      startedAt: book.startedAt || "",
      finishedAt: book.finishedAt || "",
      lastReadAt: book.lastReadAt || "",
      tags: Array.isArray(book.tags) ? book.tags.map(String) : [],
      summary: book.summary?.trim() || "",
      source: book.source?.trim() || "manual",
      sourceBookId: book.sourceBookId ? String(book.sourceBookId) : "",
      coverTone: Number(book.coverTone ?? index) % 6
    };
  });

  const normalizedAnnotations = annotations.map((note, index) => {
    if (!note.bookId) throw new Error(`第 ${index + 1} 条笔记缺少 bookId`);
    if (!note.originalText?.trim()) throw new Error(`第 ${index + 1} 条笔记缺少 originalText`);
    const signature = `${note.bookId}|${note.chapter || ""}|${note.originalText}`;
    return {
      id: String(note.id || `ann_${stableHash(signature)}`),
      bookId: String(note.bookId),
      chapter: note.chapter?.trim() || "未分章",
      originalText: note.originalText.trim(),
      comment: note.comment?.trim() || "",
      type: ["highlight", "bookmark", "comment", "note"].includes(note.type) ? note.type : "highlight",
      sourceCreatedAt: note.sourceCreatedAt || "",
      source: note.source?.trim() || "manual",
      sourceAnnotationId: note.sourceAnnotationId ? String(note.sourceAnnotationId) : "",
      importedAt: note.importedAt || new Date().toISOString(),
      tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
      organized: Boolean(note.organized),
      contentHash: stableHash(signature)
    };
  });

  return { books: normalizedBooks, annotations: normalizedAnnotations, reflections, ideas, reviewRecords, askHistory, bookClosures };
}

export function previewMerge(current, incoming) {
  const booksById = new Map(current.books.map((book) => [book.id, book]));
  const booksBySignature = new Map(current.books.map((book) => [`${book.title}|${book.author}`, book]));
  const noteHashes = new Set(current.annotations.map((note) => note.contentHash));
  const noteSourceIds = new Set(current.annotations.filter((note) => note.sourceAnnotationId).map((note) => `${note.source}|${note.sourceAnnotationId}`));
  const bookIdMap = new Map();
  const result = { newBooks: [], updatedBooks: [], duplicateBooks: [], newAnnotations: [], duplicateAnnotations: [], newIdeas: [], newReviewRecords: [], newAskHistory: [], updatedBookClosures: {} };

  incoming.books.forEach((book) => {
    const existing = booksById.get(book.id) || booksBySignature.get(`${book.title}|${book.author}`);
    if (!existing) {
      result.newBooks.push(book);
      bookIdMap.set(book.id, book.id);
      return;
    }
    bookIdMap.set(book.id, existing.id);
    const merged = { ...existing, ...book, id: existing.id, tags: [...new Set([...(existing.tags || []), ...(book.tags || [])])] };
    if (JSON.stringify(merged) === JSON.stringify(existing)) result.duplicateBooks.push(book);
    else result.updatedBooks.push({ ...merged, previousId: existing.id });
  });
  incoming.annotations.forEach((note) => {
    const mapped = { ...note, bookId: bookIdMap.get(note.bookId) || note.bookId };
    const sourceKey = mapped.sourceAnnotationId ? `${mapped.source}|${mapped.sourceAnnotationId}` : "";
    if (noteHashes.has(mapped.contentHash) || (sourceKey && noteSourceIds.has(sourceKey))) result.duplicateAnnotations.push(mapped);
    else result.newAnnotations.push(mapped);
  });
  const ideaIds = new Set((current.ideas || []).map((idea) => idea.id));
  (incoming.ideas || []).forEach((idea) => {
    if (!ideaIds.has(idea.id)) result.newIdeas.push({ ...idea, bookId: bookIdMap.get(idea.bookId) || idea.bookId });
  });
  const reviewIds = new Set((current.reviewRecords || []).map((record) => record.id));
  (incoming.reviewRecords || []).forEach((record) => {
    if (!reviewIds.has(record.id)) result.newReviewRecords.push(record);
  });
  const askIds = new Set((current.askHistory || []).map((record) => record.id));
  (incoming.askHistory || []).forEach((record) => {
    if (!askIds.has(record.id)) result.newAskHistory.push(record);
  });
  Object.entries(incoming.bookClosures || {}).forEach(([incomingBookId, closure]) => {
    const targetBookId = bookIdMap.get(incomingBookId) || incomingBookId;
    result.updatedBookClosures[targetBookId] = { ...closure, bookId: targetBookId };
  });
  return result;
}

export function mergeArchive(current, preview) {
  const updates = new Map((preview.updatedBooks || []).map((book) => [book.previousId || book.id, book]));
  return {
    ...current,
    books: [...current.books.map((book) => updates.has(book.id) ? { ...updates.get(book.id), id: book.id, previousId: undefined } : book), ...preview.newBooks],
    annotations: [...current.annotations, ...preview.newAnnotations],
    ideas: [...(current.ideas || []), ...(preview.newIdeas || [])],
    reviewRecords: [...(current.reviewRecords || []), ...(preview.newReviewRecords || [])],
    askHistory: [...(current.askHistory || []), ...(preview.newAskHistory || [])],
    bookClosures: { ...(current.bookClosures || {}), ...(preview.updatedBookClosures || {}) }
  };
}

export function filterBooks(books, annotations, query, status, tag) {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  return books.filter((book) => {
    const bookNotes = annotations.filter((note) => note.bookId === book.id);
    const text = [book.title, book.author, book.summary, ...book.tags, ...bookNotes.flatMap((note) => [note.originalText, note.comment])]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return (!needle || text.includes(needle)) && (!status || book.status === status) && (!tag || book.tags.includes(tag));
  });
}

export function toMarkdown(archive) {
  return archive.books.map((book) => {
    const notes = archive.annotations.filter((note) => note.bookId === book.id);
    return [`# ${book.title}`, ``, `- 作者：${book.author}`, `- 状态：${book.status}`, `- 标签：${book.tags.join("、") || "无"}`, ``, book.summary, ``, `## 划线与点评`, ``, ...notes.flatMap((note) => [`### ${note.chapter}`, ``, `> ${note.originalText}`, note.comment ? `\n我的点评：${note.comment}` : "", ``])].join("\n");
  }).join("\n---\n\n");
}
