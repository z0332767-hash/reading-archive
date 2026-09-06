const GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.4";

export class WeReadError extends Error {
  constructor(message, code = "WEREAD_ERROR") {
    super(message);
    this.name = "WeReadError";
    this.code = code;
  }
}

export function createWeReadClient(apiKey, fetchImpl = fetch) {
  if (!/^wrk-[A-Za-z0-9_-]+$/.test(apiKey || "")) throw new WeReadError("微信读书 API Key 格式不正确", "INVALID_KEY");
  return async function call(apiName, parameters = {}) {
    const response = await fetchImpl(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ api_name: apiName, ...parameters, skill_version: SKILL_VERSION })
    });
    if (!response.ok) throw new WeReadError(`微信读书接口返回 ${response.status}`, "HTTP_ERROR");
    const envelope = await response.json();
    const payload = envelope?.data && typeof envelope.data === "object" ? envelope.data : envelope;
    if (payload?.errcode && payload.errcode !== 0) throw new WeReadError(payload.errmsg || `微信读书错误 ${payload.errcode}`, String(payload.errcode));
    return payload;
  };
}

export async function fetchAllNotebooks(call, pageSize = 100) {
  const books = [];
  let lastSort;
  let page = 0;
  let totals = {};
  do {
    const result = await call("/user/notebooks", { count: pageSize, ...(lastSort ? { lastSort } : {}) });
    const batch = Array.isArray(result.books) ? result.books : [];
    totals = { totalBookCount: result.totalBookCount, totalNoteCount: result.totalNoteCount };
    books.push(...batch);
    page += 1;
    if (!result.hasMore || !batch.length) break;
    const nextSort = batch.at(-1)?.sort;
    if (!nextSort || nextSort === lastSort) throw new WeReadError("笔记分页游标没有前进，已停止同步", "PAGINATION_STALLED");
    lastSort = nextSort;
  } while (page < 100);
  if (page >= 100) throw new WeReadError("笔记本分页超过安全上限", "PAGINATION_LIMIT");
  return { books, ...totals };
}

export async function fetchAllReviews(call, bookId, pageSize = 100) {
  const reviews = [];
  let synckey = 0;
  let page = 0;
  do {
    const result = await call("/review/list/mine", { bookid: bookId, synckey, count: pageSize });
    const batch = Array.isArray(result.reviews) ? result.reviews : [];
    reviews.push(...batch);
    page += 1;
    if (!result.hasMore || !batch.length) break;
    const nextKey = result.synckey;
    if (!nextKey || nextKey === synckey) throw new WeReadError(`《${bookId}》的想法分页游标没有前进`, "PAGINATION_STALLED");
    synckey = nextKey;
  } while (page < 100);
  return reviews;
}

function isoTime(value) {
  if (!value) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Date(number < 1e12 ? number * 1000 : number).toISOString();
}

function bookIdOf(entry) {
  return String(entry?.bookId || entry?.book?.bookId || "");
}

function bookInfoOf(entry) {
  const book = entry?.book && typeof entry.book === "object" ? entry.book : entry;
  return { ...book, bookId: bookIdOf(entry) };
}

export function mapWeReadBook(entry, index = 0) {
  const book = bookInfoOf(entry);
  const progress = Number(entry.readingProgress ?? book.readingProgress ?? 0);
  const finished = Number(entry.markedStatus ?? book.finishReading) === 1 || progress === 100;
  const updated = entry.readUpdateTime || book.readUpdateTime || entry.sort || book.updateTime;
  return {
    id: `weread_${book.bookId}`,
    title: book.title || "未命名书籍",
    subtitle: book.subtitle || "",
    author: book.author || "佚名",
    publisher: book.publisher || "",
    cover: book.cover || "",
    category: book.category || "",
    status: finished ? "finished" : updated ? "reading" : "wishlist",
    progress: Math.min(100, Math.max(0, progress)),
    rating: 0,
    startedAt: "",
    finishedAt: finished ? isoTime(book.finishTime).slice(0, 10) : "",
    lastReadAt: isoTime(updated).slice(0, 10),
    tags: book.category ? [book.category] : [],
    summary: "",
    source: "weread",
    sourceBookId: book.bookId,
    coverTone: index % 6
  };
}

export function mapWeReadAnnotations(bookId, bookmarkPayload = {}, reviewEntries = []) {
  const chapters = new Map((bookmarkPayload.chapters || []).map((chapter) => [String(chapter.chapterUid), chapter.title || "未分章"]));
  const reviews = reviewEntries.map((entry) => entry?.review || entry).filter(Boolean);
  const reviewedRanges = new Set(reviews.filter((review) => review.abstract && review.range).map((review) => String(review.range)));

  const reviewNotes = reviews.filter((review) => review.content || review.abstract).map((review) => {
    const hasSource = Boolean(review.abstract);
    return {
      id: `weread_review_${review.reviewId}`,
      bookId: `weread_${bookId}`,
      chapter: review.chapterName || chapters.get(String(review.chapterUid)) || (hasSource ? "未分章" : "全书想法"),
      originalText: hasSource ? review.abstract : review.content,
      comment: hasSource ? (review.content || "") : "",
      type: hasSource ? "comment" : "note",
      sourceCreatedAt: isoTime(review.createTime),
      source: "weread",
      sourceAnnotationId: String(review.reviewId || `review_${bookId}_${review.createTime}`),
      tags: [],
      organized: false
    };
  });

  const highlights = (bookmarkPayload.updated || []).filter((mark) => mark.markText && !reviewedRanges.has(String(mark.range || ""))).map((mark) => ({
    id: `weread_mark_${mark.bookmarkId}`,
    bookId: `weread_${bookId}`,
    chapter: chapters.get(String(mark.chapterUid)) || "未分章",
    originalText: mark.markText,
    comment: "",
    type: "highlight",
    sourceCreatedAt: isoTime(mark.createTime),
    source: "weread",
    sourceAnnotationId: String(mark.bookmarkId || `mark_${bookId}_${mark.range}`),
    tags: [],
    organized: false
  }));

  return [...reviewNotes, ...highlights];
}

export async function syncWeRead({ apiKey, includeShelf = false, notebookLimit = 20, fetchImpl = fetch, onProgress = () => {} }) {
  const call = createWeReadClient(apiKey, fetchImpl);
  const notebooks = await fetchAllNotebooks(call);
  const selected = notebookLimit === 0 ? notebooks.books : notebooks.books.slice(0, notebookLimit);
  const booksBySourceId = new Map();

  if (includeShelf) {
    const shelf = await call("/shelf/sync");
    (shelf.books || []).forEach((book, index) => booksBySourceId.set(String(book.bookId), mapWeReadBook(book, index)));
  }
  notebooks.books.forEach((entry, index) => booksBySourceId.set(bookIdOf(entry), mapWeReadBook(entry, index)));

  const annotations = [];
  for (let index = 0; index < selected.length; index += 1) {
    const entry = selected[index];
    const bookId = bookIdOf(entry);
    if (!bookId) continue;
    onProgress({ current: index + 1, total: selected.length, title: bookInfoOf(entry).title || "未命名书籍" });
    const [marks, reviews] = await Promise.all([
      call("/book/bookmarklist", { bookId }),
      fetchAllReviews(call, bookId)
    ]);
    annotations.push(...mapWeReadAnnotations(bookId, marks, reviews));
  }

  return {
    source: "weread",
    syncedAt: new Date().toISOString(),
    books: [...booksBySourceId.values()],
    annotations,
    reflections: [],
    syncSummary: {
      notebookBookCount: notebooks.totalBookCount ?? notebooks.books.length,
      officialNoteCount: notebooks.totalNoteCount ?? null,
      fetchedNotebookCount: selected.length,
      fetchedAnnotationCount: annotations.length,
      shelfIncluded: includeShelf
    }
  };
}

export { GATEWAY_URL, SKILL_VERSION };
