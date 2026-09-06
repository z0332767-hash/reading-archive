const MAX_TOPIC_LENGTH = 16;

function clean(value) {
  return String(value || "").trim().replace(/^[#＃]+/, "").replace(/\s+/g, " ").slice(0, MAX_TOPIC_LENGTH);
}

function dateValue(...values) {
  return values.find((value) => value && !Number.isNaN(new Date(value).valueOf())) || "";
}

function includesTopic(topic, ...values) {
  return values.some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(topic.toLocaleLowerCase("zh-CN")));
}

export function buildTopicMap(archive, { limit = 18 } = {}) {
  const books = new Map((archive.books || []).map((book) => [book.id, book]));
  const topics = new Map();
  const bookTopics = new Map();
  const touch = (rawTopic, { bookId = "", kind = "record", date = "" } = {}) => {
    const name = clean(rawTopic);
    if (!name || name.length > MAX_TOPIC_LENGTH) return;
    if (!topics.has(name)) topics.set(name, { name, records: 0, books: new Set(), kinds: new Set(), firstSeen: "", lastSeen: "" });
    const topic = topics.get(name);
    topic.records += 1;
    topic.kinds.add(kind);
    if (bookId) {
      topic.books.add(bookId);
      if (!bookTopics.has(bookId)) bookTopics.set(bookId, new Set());
      bookTopics.get(bookId).add(name);
    }
    if (date && (!topic.firstSeen || date < topic.firstSeen)) topic.firstSeen = date;
    if (date && (!topic.lastSeen || date > topic.lastSeen)) topic.lastSeen = date;
  };

  for (const book of archive.books || []) {
    for (const tag of book.tags || []) touch(tag, { bookId: book.id, kind: "book", date: dateValue(book.startedAt, book.finishedAt, book.lastReadAt) });
  }
  for (const note of archive.annotations || []) {
    for (const tag of note.tags || []) touch(tag, { bookId: note.bookId, kind: note.comment || note.type === "note" ? "mine" : "original", date: dateValue(note.sourceCreatedAt, note.importedAt) });
  }

  const explicitNames = [...topics.keys()];
  for (const idea of archive.ideas || []) {
    for (const name of explicitNames.filter((topic) => includesTopic(topic, idea.title, idea.content, idea.sourceExcerpt))) touch(name, { bookId: idea.bookId, kind: "idea", date: dateValue(idea.createdAt, idea.updatedAt) });
  }
  for (const [bookId, closure] of Object.entries(archive.bookClosures || {})) {
    const book = books.get(bookId);
    const text = Object.values(closure).join(" ");
    const candidates = new Set([...(bookTopics.get(bookId) || []), ...explicitNames.filter((topic) => includesTopic(topic, text))]);
    for (const name of candidates) touch(name, { bookId, kind: "closure", date: dateValue(closure.completedAt, closure.updatedAt) });
  }
  for (const review of archive.reviewRecords || []) {
    const note = (archive.annotations || []).find((item) => item.id === review.annotationId);
    for (const name of note?.tags || []) touch(name, { bookId: note.bookId, kind: "review", date: review.reviewedAt });
  }

  const selected = [...topics.values()]
    .sort((a, b) => b.books.size - a.books.size || b.records - a.records || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, Math.max(1, limit));
  const allowed = new Set(selected.map((topic) => topic.name));
  const edges = new Map();
  for (const names of bookTopics.values()) {
    const values = [...names].filter((name) => allowed.has(name));
    for (let left = 0; left < values.length; left += 1) {
      for (let right = left + 1; right < values.length; right += 1) {
        const pair = [values[left], values[right]].sort((a, b) => a.localeCompare(b, "zh-CN"));
        const key = pair.join("\u0000");
        edges.set(key, { source: pair[0], target: pair[1], weight: (edges.get(key)?.weight || 0) + 1 });
      }
    }
  }
  return {
    topics: selected.map((topic) => ({ ...topic, books: [...topic.books], kinds: [...topic.kinds] })),
    edges: [...edges.values()].sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source, "zh-CN"))
  };
}

export function relatedTopics(map, topicName, limit = 6) {
  return map.edges.filter((edge) => edge.source === topicName || edge.target === topicName)
    .map((edge) => ({ name: edge.source === topicName ? edge.target : edge.source, weight: edge.weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, limit);
}

export function buildTopicTimeline(archive, topicName) {
  const topic = clean(topicName);
  if (!topic) return [];
  const books = new Map((archive.books || []).map((book) => [book.id, book]));
  const notes = new Map((archive.annotations || []).map((note) => [note.id, note]));
  const matchesNote = (note) => (note.tags || []).some((tag) => clean(tag) === topic) || includesTopic(topic, note.originalText, note.comment);
  const events = [];
  const add = (event) => { if (event.date) events.push(event); };

  for (const book of archive.books || []) {
    if ((book.tags || []).some((tag) => clean(tag) === topic) || includesTopic(topic, book.summary)) {
      add({ id: `book:${book.id}`, type: "book", stage: "encounter", date: dateValue(book.startedAt, book.finishedAt, book.lastReadAt), title: `开始在《${book.title}》中接触这个主题`, text: book.summary, bookId: book.id, bookTitle: book.title });
    }
  }
  for (const note of archive.annotations || []) {
    if (!matchesNote(note)) continue;
    const book = books.get(note.bookId);
    add({ id: `note:${note.id}`, type: note.type === "note" ? "reflection" : note.comment ? "comment" : "original", stage: note.type === "note" || note.comment ? "response" : "source", date: dateValue(note.sourceCreatedAt, note.importedAt), title: note.type === "note" ? "写下个人想法" : note.comment ? "对原文作出回应" : "保存作者原文", text: note.type === "note" ? note.originalText : note.comment || note.originalText, quote: note.comment ? note.originalText : "", bookId: note.bookId, bookTitle: book?.title || "" });
  }
  for (const idea of archive.ideas || []) {
    const sourceNote = notes.get(idea.annotationId);
    if (!includesTopic(topic, idea.title, idea.content, idea.sourceExcerpt) && !(sourceNote && matchesNote(sourceNote))) continue;
    add({ id: `idea:${idea.id}`, type: "idea", stage: idea.type === "question" ? "question" : "position", date: dateValue(idea.createdAt, idea.updatedAt), title: idea.title, text: idea.content, bookId: idea.bookId, bookTitle: books.get(idea.bookId)?.title || idea.sourceTitle || "" });
  }
  for (const [bookId, closure] of Object.entries(archive.bookClosures || {})) {
    const book = books.get(bookId);
    const bookMatches = (book?.tags || []).some((tag) => clean(tag) === topic);
    if (!bookMatches && !includesTopic(topic, ...Object.values(closure))) continue;
    add({ id: `closure:${bookId}`, type: "closure", stage: "synthesis", date: dateValue(closure.completedAt, closure.updatedAt), title: `读完《${book?.title || "未知书籍"}》后的结论`, text: closure.changed || closure.oneSentence || closure.remember, bookId, bookTitle: book?.title || "" });
  }
  for (const review of archive.reviewRecords || []) {
    const note = notes.get(review.annotationId);
    if (!note || !matchesNote(note)) continue;
    const book = books.get(note.bookId);
    const changed = ["changed", "doubt"].includes(review.response);
    add({ id: `review:${review.id}`, type: "review", stage: changed ? "revision" : "revisit", date: review.reviewedAt, title: changed ? "重新修正当时的判断" : "再次回看这个想法", text: review.thought || "完成一次回顾", bookId: note.bookId, bookTitle: book?.title || "" });
  }
  return events.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
}
