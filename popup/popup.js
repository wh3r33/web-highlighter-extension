const CATEGORY_LABELS = {
  important: "Важное",
  definition: "Определение",
  question: "Вопрос"
};

const CATEGORY_ARTIFACTS = {
  important: "artifact.imp",
  definition: "artifact.def",
  question: "artifact.q"
};

let allHighlights = [];
let collapsedGroups = new Set();
let editingNoteId = null;

const elements = {
  totalCount: document.getElementById("totalCount"),
  importantCount: document.getElementById("importantCount"),
  definitionCount: document.getElementById("definitionCount"),
  questionCount: document.getElementById("questionCount"),
  searchInput: document.getElementById("searchInput"),
  emptyState: document.getElementById("emptyState"),
  groups: document.getElementById("groups"),
  exportButton: document.getElementById("exportButton")
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response" });
    });
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    return url;
  }
}

function escapeMarkdown(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function filterHighlights() {
  const query = elements.searchInput.value.trim().toLowerCase();
  if (!query) {
    return allHighlights;
  }

  return allHighlights.filter((highlight) => {
    return [highlight.text, highlight.note, highlight.title, highlight.url]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function groupByUrl(highlights) {
  return highlights.reduce((groups, highlight) => {
    if (!groups.has(highlight.url)) {
      groups.set(highlight.url, []);
    }
    groups.get(highlight.url).push(highlight);
    return groups;
  }, new Map());
}

function updateStats() {
  elements.totalCount.textContent = allHighlights.length;
  elements.importantCount.textContent = allHighlights.filter((item) => item.category === "important").length;
  elements.definitionCount.textContent = allHighlights.filter((item) => item.category === "definition").length;
  elements.questionCount.textContent = allHighlights.filter((item) => item.category === "question").length;
}

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
}

function icon(name) {
  const paths = {
    open: '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
    note: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
    cancel: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
    delete: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function setButtonContent(button, iconName, label) {
  button.innerHTML = `${icon(iconName)}<span>${label}</span>`;
}

function createHighlightCard(highlight) {
  const card = createElement("article", `highlight-card is-${highlight.category}`);
  card.dataset.artifact = CATEGORY_ARTIFACTS[highlight.category] || "artifact";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Открыть ${highlight.title || getHostname(highlight.url)}`);
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, textarea, input, a")) {
      return;
    }
    chrome.tabs.create({ url: highlight.url });
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chrome.tabs.create({ url: highlight.url });
    }
  });

  const source = createElement("div", "card-source");
  source.appendChild(createElement("span", "card-site", getHostname(highlight.url)));
  source.appendChild(createElement("span", "card-title", highlight.title || "Страница без названия"));
  card.appendChild(source);

  const deleteButton = createElement("button", "delete-button");
  deleteButton.type = "button";
  deleteButton.title = "Удалить выделение";
  deleteButton.setAttribute("aria-label", "Удалить выделение");
  deleteButton.innerHTML = icon("delete");
  deleteButton.addEventListener("click", async () => {
    await deleteHighlight(highlight.id);
  });

  const top = createElement("div", "card-top");
  top.appendChild(createElement("span", `category-square ${highlight.category}`));
  top.appendChild(createElement("span", "category-label", CATEGORY_LABELS[highlight.category]));
  top.appendChild(deleteButton);

  const text = createElement("p", "card-text", highlight.text);
  card.appendChild(top);
  card.appendChild(text);

  if (editingNoteId === highlight.id) {
    const editor = createElement("textarea", "note-editor");
    editor.value = highlight.note || "";
    editor.placeholder = "Добавить заметку";
    card.appendChild(editor);

    const editActions = createElement("div", "card-actions");
    const cancelButton = createElement("button", "cancel-note-button");
    cancelButton.type = "button";
    setButtonContent(cancelButton, "cancel", "Отмена");
    cancelButton.addEventListener("click", () => {
      editingNoteId = null;
      render();
    });

    const saveButton = createElement("button", "save-note-button");
    saveButton.type = "button";
    setButtonContent(saveButton, "save", "Сохранить заметку");
    saveButton.addEventListener("click", async () => {
      await updateNote(highlight.id, editor.value.trim());
    });

    editActions.append(cancelButton, saveButton);
    card.appendChild(editActions);
  } else if (highlight.note) {
    card.appendChild(createElement("p", "card-note", highlight.note));
  }

  const meta = createElement("div", "card-meta");
  meta.appendChild(createElement("span", "card-url", getHostname(highlight.url)));
  meta.appendChild(createElement("span", "card-date", formatDate(highlight.createdAt)));
  card.appendChild(meta);

  const actions = createElement("div", "card-actions");
  const openButton = createElement("button", "open-button");
  openButton.type = "button";
  setButtonContent(openButton, "open", "Открыть");
  openButton.addEventListener("click", () => chrome.tabs.create({ url: highlight.url }));

  const noteButton = createElement("button", "note-button");
  noteButton.type = "button";
  setButtonContent(noteButton, "note", highlight.note ? "Изменить заметку" : "Добавить заметку");
  noteButton.addEventListener("click", () => {
    editingNoteId = highlight.id;
    render();
  });

  actions.append(openButton, noteButton);
  card.appendChild(actions);
  return card;
}

function render() {
  updateStats();

  const visibleHighlights = filterHighlights();
  const groups = groupByUrl(visibleHighlights);

  elements.emptyState.hidden = allHighlights.length !== 0 || elements.searchInput.value.trim() !== "";
  elements.groups.replaceChildren();

  if (visibleHighlights.length === 0) {
    if (allHighlights.length !== 0) {
      const emptySearch = createElement("section", "empty-state");
      emptySearch.innerHTML = `
        <div class="empty-graphic" aria-hidden="true">
          <span class="empty-word">404</span>
          <span class="empty-cross">+</span>
          <span class="empty-box"></span>
        </div>
        <h2>Подходящих фрагментов нет</h2>
        <p>Попробуйте другой термин, заметку, сайт или заголовок из архива.</p>
      `;
      elements.groups.appendChild(emptySearch);
    }
    return;
  }

  groups.forEach((items, url) => {
    const group = createElement("article", "group");
    if (collapsedGroups.has(url)) {
      group.classList.add("is-collapsed");
    }

    const header = createElement("button", "group-header");
    header.type = "button";
    header.appendChild(createElement("span", "group-chevron", "▼"));
    header.appendChild(createElement("span", "group-title", getHostname(url)));
    header.appendChild(createElement("span", "group-count", String(items.length)));
    header.addEventListener("click", () => {
      if (collapsedGroups.has(url)) {
        collapsedGroups.delete(url);
      } else {
        collapsedGroups.add(url);
      }
      render();
    });

    const groupItems = createElement("div", "group-items");
    items.forEach((highlight) => groupItems.appendChild(createHighlightCard(highlight)));

    group.append(header, groupItems);
    elements.groups.appendChild(group);
  });
}

async function loadHighlights() {
  const response = await sendMessage({ type: "GET_HIGHLIGHTS" });
  allHighlights = response.ok && Array.isArray(response.highlights) ? response.highlights : [];
  render();
}

async function deleteHighlight(id) {
  const response = await sendMessage({ type: "DELETE_HIGHLIGHT", id });
  if (response.ok && Array.isArray(response.highlights)) {
    allHighlights = response.highlights;
    render();
  }
}

async function updateNote(id, note) {
  const response = await sendMessage({ type: "UPDATE_NOTE", id, note });
  if (response.ok && Array.isArray(response.highlights)) {
    allHighlights = response.highlights;
    editingNoteId = null;
    render();
  }
}

function buildMarkdown(highlights) {
  const pages = groupByUrl(highlights);
  const lines = ["# Учебные выделения", ""];

  pages.forEach((items, url) => {
    const title = items[0].title || getHostname(url);
    lines.push(`## ${escapeMarkdown(title)}`, "");
    lines.push("Источник:");
    lines.push(url, "");

    items.forEach((highlight) => {
      lines.push("Категория:");
      lines.push(CATEGORY_LABELS[highlight.category], "");
      lines.push(`> ${escapeMarkdown(highlight.text).replace(/\n/g, "\n> ")}`, "");
      if (highlight.note) {
        lines.push("Заметка:");
        lines.push(escapeMarkdown(highlight.note), "");
      }
    });
  });

  return lines.join("\n");
}

function exportMarkdown() {
  const markdown = buildMarkdown(filterHighlights());
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `study-highlights-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

elements.searchInput.addEventListener("input", render);
elements.exportButton.addEventListener("click", exportMarkdown);

loadHighlights();
