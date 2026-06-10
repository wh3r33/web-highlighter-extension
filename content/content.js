(function () {
  const CATEGORY_META = {
    important: { label: "Important" },
    definition: { label: "Definition" },
    question: { label: "Question" }
  };

  const INTERNAL_SELECTOR = ".study-highlighter-toolbar, .study-highlighter-action-popup";
  const MARK_SELECTOR = "mark.study-highlighter-mark";

  let selectedCategory = "important";
  let savedRange = null;
  let toolbar = null;
  let actionPopup = null;

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

  function createId() {
    if (crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function isInsideInternalUi(node) {
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return Boolean(element && element.closest(INTERNAL_SELECTOR));
  }

  function ensureToolbar() {
    if (toolbar) {
      return toolbar;
    }

    toolbar = document.createElement("div");
    toolbar.className = "study-highlighter-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.innerHTML = `
      <button type="button" data-category="important" title="Important">I</button>
      <button type="button" data-category="definition" title="Definition">D</button>
      <button type="button" data-category="question" title="Question">Q</button>
      <button type="button" data-action="save">Save</button>
    `;
    document.documentElement.appendChild(toolbar);

    toolbar.addEventListener("mousedown", (event) => event.preventDefault());
    toolbar.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) {
        return;
      }

      const category = button.dataset.category;
      if (category) {
        selectedCategory = category;
        updateToolbarState();
        return;
      }

      if (button.dataset.action === "save") {
        saveSelection();
      }
    });

    updateToolbarState();
    return toolbar;
  }

  function updateToolbarState() {
    if (!toolbar) {
      return;
    }
    toolbar.querySelectorAll("[data-category]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.category === selectedCategory);
    });
  }

  function showToolbar(range) {
    const currentToolbar = ensureToolbar();
    const rect = range.getBoundingClientRect();
    const toolbarWidth = currentToolbar.offsetWidth || 188;
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - toolbarWidth / 2),
      window.innerWidth - toolbarWidth - 12
    );
    const top = Math.max(12, rect.top - 48);

    currentToolbar.style.left = `${left}px`;
    currentToolbar.style.top = `${top}px`;
    currentToolbar.classList.add("is-visible");
  }

  function hideToolbar() {
    if (toolbar) {
      toolbar.classList.remove("is-visible");
    }
  }

  function ensureActionPopup() {
    if (actionPopup) {
      return actionPopup;
    }

    actionPopup = document.createElement("div");
    actionPopup.className = "study-highlighter-action-popup";
    actionPopup.innerHTML = `<button type="button">Remove Highlight</button>`;
    document.documentElement.appendChild(actionPopup);

    actionPopup.addEventListener("mousedown", (event) => event.preventDefault());
    actionPopup.addEventListener("click", async () => {
      const id = actionPopup.dataset.highlightId;
      const mark = document.querySelector(`${MARK_SELECTOR}[data-highlight-id="${CSS.escape(id)}"]`);
      if (!id || !mark) {
        hideActionPopup();
        return;
      }

      unwrapMark(mark);
      await sendMessage({ type: "DELETE_HIGHLIGHT", id });
      hideActionPopup();
    });

    return actionPopup;
  }

  function showActionPopup(mark) {
    const popup = ensureActionPopup();
    const rect = mark.getBoundingClientRect();
    popup.dataset.highlightId = mark.dataset.highlightId;
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 170)}px`;
    popup.style.top = `${Math.max(12, rect.bottom + 8)}px`;
    popup.classList.add("is-visible");
  }

  function hideActionPopup() {
    if (actionPopup) {
      actionPopup.classList.remove("is-visible");
      delete actionPopup.dataset.highlightId;
    }
  }

  function handleSelectionChange() {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        hideToolbar();
        return;
      }

      if (isInsideInternalUi(selection.anchorNode) || isInsideInternalUi(selection.focusNode)) {
        return;
      }

      const text = normalizeText(selection.toString());
      if (!text) {
        hideToolbar();
        return;
      }

      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;

      if (!container || container.closest(MARK_SELECTOR)) {
        hideToolbar();
        return;
      }

      console.log(`Selected:\n"${text}"`);
      savedRange = range.cloneRange();
      showToolbar(range);
    }, 0);
  }

  function createMark(highlight) {
    const mark = document.createElement("mark");
    mark.className = `study-highlighter-mark ${highlight.category}`;
    mark.dataset.highlightId = highlight.id;
    mark.dataset.category = highlight.category;
    mark.title = `${CATEGORY_META[highlight.category].label}${highlight.note ? `: ${highlight.note}` : ""}`;
    return mark;
  }

  function wrapRange(range, highlight) {
    const mark = createMark(highlight);
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
    return mark;
  }

  async function saveSelection() {
    if (!savedRange) {
      hideToolbar();
      return;
    }

    const text = normalizeText(savedRange.toString());
    if (!text) {
      hideToolbar();
      return;
    }

    const note = window.prompt("Add an optional note for this highlight:", "") || "";
    const highlight = {
      id: createId(),
      text,
      url: location.href,
      title: document.title || location.hostname || location.href,
      category: selectedCategory,
      note: note.trim(),
      createdAt: new Date().toISOString()
    };

    try {
      wrapRange(savedRange, highlight);
      window.getSelection().removeAllRanges();
      hideToolbar();
      savedRange = null;
      await sendMessage({ type: "SAVE_HIGHLIGHT", highlight });
    } catch (error) {
      console.error("Study Highlighter could not save this selection.", error);
      hideToolbar();
    }
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }

  function isSearchableTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) {
      return false;
    }
    const parent = node.parentElement;
    if (!parent) {
      return false;
    }
    return !parent.closest([
      "script",
      "style",
      "textarea",
      "input",
      "select",
      "option",
      "noscript",
      MARK_SELECTOR,
      INTERNAL_SELECTOR
    ].join(","));
  }

  function collectTextNodes() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isSearchableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function buildNormalizedIndex(nodes) {
    let normalized = "";
    const map = [];
    let previousWasWhitespace = false;

    nodes.forEach((node) => {
      Array.from(node.nodeValue).forEach((character, offset) => {
        if (/\s/.test(character)) {
          if (!previousWasWhitespace && normalized.length > 0) {
            normalized += " ";
            map.push({ node, offset });
          }
          previousWasWhitespace = true;
          return;
        }

        normalized += character;
        map.push({ node, offset });
        previousWasWhitespace = false;
      });
    });

    return { normalized: normalized.trim(), map };
  }

  function findTextRange(text) {
    const nodes = collectTextNodes();
    const { normalized, map } = buildNormalizedIndex(nodes);
    const target = normalizeText(text);
    const index = normalized.indexOf(target);

    if (index < 0 || !map[index] || !map[index + target.length - 1]) {
      return null;
    }

    const startPosition = map[index];
    const endPosition = map[index + target.length - 1];

    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset + 1);
    return range;
  }

  async function restoreHighlights() {
    if (!document.body) {
      return;
    }

    const response = await sendMessage({ type: "GET_HIGHLIGHTS_BY_URL", url: location.href });
    if (!response.ok || !Array.isArray(response.highlights)) {
      return;
    }

    response.highlights
      .slice()
      .reverse()
      .forEach((highlight) => {
        const range = findTextRange(highlight.text);
        if (!range) {
          return;
        }
        try {
          wrapRange(range, highlight);
        } catch (error) {
          console.warn("Study Highlighter could not restore a highlight.", error);
        }
      });
  }

  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("mouseup", handleSelectionChange);
  document.addEventListener("click", (event) => {
    const mark = event.target.closest && event.target.closest(MARK_SELECTOR);
    if (mark) {
      event.stopPropagation();
      hideToolbar();
      showActionPopup(mark);
      return;
    }

    if (!isInsideInternalUi(event.target)) {
      hideActionPopup();
    }
  });

  restoreHighlights();
})();
