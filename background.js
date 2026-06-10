const STORAGE_KEY = "studyHighlighter.highlights";

function getHighlights() {
  return chrome.storage.local.get({ [STORAGE_KEY]: [] }).then((result) => result[STORAGE_KEY]);
}

function setHighlights(highlights) {
  return chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

function sortHighlights(highlights) {
  return highlights.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "SAVE_HIGHLIGHT") {
    getHighlights()
      .then((highlights) => {
        const nextHighlights = sortHighlights([message.highlight, ...highlights]);
        return setHighlights(nextHighlights).then(() => message.highlight);
      })
      .then((highlight) => sendResponse({ ok: true, highlight }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_HIGHLIGHTS") {
    getHighlights()
      .then((highlights) => sendResponse({ ok: true, highlights: sortHighlights(highlights) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_HIGHLIGHTS_BY_URL") {
    getHighlights()
      .then((highlights) => {
        const urlHighlights = highlights.filter((highlight) => highlight.url === message.url);
        sendResponse({ ok: true, highlights: sortHighlights(urlHighlights) });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "DELETE_HIGHLIGHT") {
    getHighlights()
      .then((highlights) => {
        const nextHighlights = highlights.filter((highlight) => highlight.id !== message.id);
        return setHighlights(nextHighlights).then(() => nextHighlights);
      })
      .then((highlights) => sendResponse({ ok: true, highlights: sortHighlights(highlights) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "UPDATE_NOTE") {
    getHighlights()
      .then((highlights) => {
        const nextHighlights = highlights.map((highlight) => {
          if (highlight.id !== message.id) {
            return highlight;
          }
          return { ...highlight, note: message.note || "" };
        });
        return setHighlights(nextHighlights).then(() => nextHighlights);
      })
      .then((highlights) => sendResponse({ ok: true, highlights: sortHighlights(highlights) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
