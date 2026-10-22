(function () {
  "use strict";

  const body = document.body;
  const dataNode = document.getElementById("constitutionData");
  const searchDialog = document.getElementById("searchDialog");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const searchCount = document.getElementById("searchCount");
  const searchClose = document.getElementById("searchClose");
  const inlineSearch = document.getElementById("inlineSearch");
  const clearInlineSearch = document.getElementById("clearInlineSearch");
  const clearInlineSearchEmpty = document.getElementById("clearInlineSearchEmpty");
  const filterCount = document.getElementById("filterCount");
  const documentEmpty = document.getElementById("documentEmpty");
  const preamble = document.getElementById("preambleText");
  const toc = document.getElementById("documentToc");
  const toast = document.getElementById("toast");
  const menuButton = document.getElementById("menuButton");
  const mobileNav = document.getElementById("mobileNav");
  const printButton = document.getElementById("printButton");

  const totalProvisions = document.querySelectorAll(".law-article").length;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stopWords = new Set(["the", "a", "an", "of", "and", "or", "in", "to", "for", "on", "with", "is", "are", "by", "as", "at", "from", "that", "this", "it", "its", "be", "been", "was", "were"]);

  let records = [];
  let selectedIndex = 0;
  let currentResults = [];
  let inlineTimer = 0;
  let searchTimer = 0;
  let toastTimer = 0;
  let lastFocusedElement = null;

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getTokens(value) {
    return normalize(value)
      .split(" ")
      .filter((token) => token.length > 1 && !stopWords.has(token));
  }

  function tokenVariants(token) {
    const variants = new Set([token]);
    if (token.length > 4 && token.endsWith("ies")) {
      variants.add(token.slice(0, -3) + "y");
    }
    if (token.length > 4 && token.endsWith("es")) {
      variants.add(token.slice(0, -2));
    }
    if (token.length > 3 && token.endsWith("s")) {
      variants.add(token.slice(0, -1));
    }
    if (token.length > 3 && !token.endsWith("s")) {
      variants.add(token + "s");
      if (token.endsWith("y")) {
        variants.add(token.slice(0, -1) + "ies");
      }
    }
    if (token.length > 5 && token.endsWith("ing")) {
      variants.add(token.slice(0, -3));
      variants.add(token.slice(0, -3) + "e");
    }
    if (token.length > 4 && token.endsWith("ed")) {
      variants.add(token.slice(0, -2));
    }
    return Array.from(variants);
  }

  function countMatches(haystack, variants) {
    let count = 0;
    variants.forEach((variant) => {
      if (!variant) return;
      let index = haystack.indexOf(variant);
      while (index !== -1 && count < 12) {
        count += 1;
        index = haystack.indexOf(variant, index + variant.length);
      }
    });
    return count;
  }

  function articleNumberQuery(phrase) {
    const full = normalize(phrase);
    const match = full.match(/^(?:article|art)\s*(\d+)\s*([a-z])?$/);
    if (match) return match[1] + (match[2] || "");
    if (/^\d+[a-z]?$/.test(full)) return full;
    return "";
  }

  function prepareRecords() {
    if (dataNode) {
      try {
        const raw = JSON.parse(dataNode.textContent);
        records = raw.map((record) => {
          const title = normalize(record.t);
          const keywords = normalize(record.k || "");
          return {
            id: record.id,
            n: record.n,
            t: record.t,
            c: record.c,
            x: record.x,
            k: record.k || "",
            title: title,
            context: normalize(record.c),
            text: normalize(record.x),
            keywords: keywords,
            titleWords: new Set(title.split(" ").filter(Boolean)),
            keywordWords: new Set(keywords.split(" ").filter(Boolean))
          };
        });
        const mapped = new Map(records.map((record) => [record.id, record]));
        records.forEach((record) => {
          const element = document.getElementById(record.id);
          if (element) element.__record = record;
        });
        if (mapped.size) return;
      } catch (error) {
        records = [];
      }
    }

    records = Array.from(document.querySelectorAll(".law-article")).map((element) => {
      const displayTitle = element.dataset.title || "Provision";
      const text = element.querySelector(".article-body")?.textContent || "";
      const title = normalize(displayTitle);
      const keywords = normalize(element.dataset.keywords || "");
      const record = {
        id: element.id,
        n: element.dataset.number || "",
        t: displayTitle,
        c: element.dataset.context || "",
        x: text,
        k: element.dataset.keywords || "",
        title: title,
        context: normalize(element.dataset.context || ""),
        text: normalize(text),
        keywords: keywords,
        titleWords: new Set(title.split(" ").filter(Boolean)),
        keywordWords: new Set(keywords.split(" ").filter(Boolean))
      };
      element.__record = record;
      return record;
    });
  }

  function scoreRecord(record, tokens, phrase, numberQuery) {
    let score = 0;
    let matched = numberQuery && record.n === numberQuery ? 1 : 0;

    if (numberQuery && record.n === numberQuery) {
      score += 500;
    }

    if (phrase && record.title === phrase) {
      score += 290;
    } else if (phrase && record.title.includes(phrase)) {
      score += 170;
    }
    if (phrase && record.keywords.includes(phrase)) {
      score += 80;
    }
    if (phrase && record.text.includes(phrase)) {
      score += 24;
    }

    tokens.forEach((token) => {
      const variants = tokenVariants(token);
      let tokenScore = 0;
      if (variants.some((variant) => record.titleWords.has(variant))) {
        tokenScore += 50;
      } else if (variants.some((variant) => record.title.includes(variant))) {
        tokenScore += 26;
      }
      if (variants.some((variant) => record.keywordWords.has(variant))) {
        tokenScore += 22;
      } else if (variants.some((variant) => record.keywords.includes(variant))) {
        tokenScore += 12;
      }
      const occurrences = countMatches(record.text, variants);
      if (occurrences) {
        tokenScore += 6 + Math.min(occurrences, 4) * 2;
      }
      if (variants.some((variant) => record.context.includes(variant))) {
        tokenScore += 2;
      }
      if (tokenScore > 0) {
        matched += 1;
        score += tokenScore;
      }
    });

    if (!matched) return null;
    if (tokens.length > 1) {
      score += matched === tokens.length ? 28 : -18;
    }
    return score;
  }

  function findMatches(query, limit) {
    const phrase = normalize(query);
    const tokens = getTokens(query);
    const numberQuery = articleNumberQuery(query);
    if (!phrase) return { items: [], total: 0 };

    const scored = [];
    records.forEach((record) => {
      const score = scoreRecord(record, tokens, phrase, numberQuery);
      if (score !== null && score > 0) {
        scored.push({ record, score });
      }
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return parseInt(a.record.n, 10) - parseInt(b.record.n, 10);
    });

    return {
      items: scored.slice(0, limit).map((item) => item.record),
      total: scored.length
    };
  }

  function snippetFor(record, query) {
    const rawTokens = String(query || "")
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/[^\w\u00C0-\u024F-]/g, ""))
      .filter((token) => token.length > 1 && !stopWords.has(normalize(token)));
    const highlightTokens = Array.from(new Set(rawTokens.filter((token) => token.length > 2))).slice(0, 4);
    const source = record.x || "";
    let index = -1;

    rawTokens.some((token) => {
      index = source.toLowerCase().indexOf(token.toLowerCase());
      return index !== -1;
    });

    if (index === -1) {
      index = source.toLowerCase().indexOf(normalize(query).split(" ")[0] || "");
    }

    let start = index > 80 ? index - 60 : 0;
    let end = Math.min(source.length, start + 210);
    if (start > 0) {
      const space = source.indexOf(" ", start);
      if (space !== -1 && space < index) start = space + 1;
    }
    if (end < source.length) {
      const space = source.lastIndexOf(" ", end);
      if (space > start) end = space;
    }

    let excerpt = source.slice(start, end).trim();
    if (!excerpt) excerpt = source.slice(0, 180).trim();
    if (start > 0) excerpt = "... " + excerpt;
    if (end < source.length) excerpt += " ...";

    let safe = escapeHtml(excerpt);
    highlightTokens.forEach((token) => {
      const pattern = new RegExp("\\b(" + escapeRegExp(token) + ")", "gi");
      safe = safe.replace(pattern, "<mark>$1</mark>");
    });
    return safe;
  }

  function defaultRecords() {
    const ids = ["art_3", "art_136", "art_140", "art_142", "art_149", "art_150", "art_174", "art_175", "art_176", "art_177", "art_185", "art_188"];
    return ids.map((id) => records.find((record) => record.id === id)).filter(Boolean);
  }

  function renderResults(items, query, total) {
    currentResults = items;
    selectedIndex = 0;

    if (!items.length) {
      searchCount.textContent = "No matches";
      searchResults.innerHTML = '<div class="search-empty"><h3>No provision matched that search.</h3><p>Try an article number such as 176, a single word such as cantons, or a shorter phrase.</p></div>';
      return;
    }

    const resultTotal = total || items.length;
    searchCount.textContent = resultTotal > items.length
      ? items.length + " of " + resultTotal + " results"
      : resultTotal + (resultTotal === 1 ? " result" : " results");
    searchResults.innerHTML = items.map((record, index) => {
      const selected = index === 0 ? " is-selected" : "";
      return '<button type="button" role="option" class="search-result' + selected + '" data-result-id="' + escapeHtml(record.id) + '" aria-selected="' + (index === 0 ? "true" : "false") + '">' +
        '<span class="search-result-number">' + escapeHtml(record.n) + '</span>' +
        '<span class="search-result-body"><span class="search-result-context">' + escapeHtml(record.c) + '</span>' +
        '<span class="search-result-title">' + escapeHtml(record.t) + '</span>' +
        '<span class="search-result-snippet">' + (query ? snippetFor(record, query) : escapeHtml(record.x.slice(0, 170) + (record.x.length > 170 ? " ..." : ""))) + '</span></span>' +
        '<span class="search-result-arrow" aria-hidden="true">→</span>' +
        '</button>';
    }).join("");
    updateSelectedResult(false);
  }

  function updateSelectedResult(scroll) {
    const buttons = Array.from(searchResults.querySelectorAll(".search-result"));
    buttons.forEach((button, index) => {
      const isSelected = index === selectedIndex;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-selected", isSelected ? "true" : "false");
      if (isSelected && scroll) {
        button.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function runSearch() {
    const query = searchInput.value;
    if (!query.trim()) {
      renderResults(defaultRecords(), "");
      return;
    }
    const matches = findMatches(query, 24);
    renderResults(matches.items, query, matches.total);
  }

  function openSearch(query) {
    if (!searchDialog) {
      window.location.href = "index.html?search=1";
      return;
    }
    if (menuButton && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false);
    }
    if (!searchDialog.open) {
      lastFocusedElement = document.activeElement;
      if (typeof searchDialog.showModal === "function") {
        searchDialog.showModal();
      } else {
        searchDialog.setAttribute("open", "");
      }
      body.classList.add("search-open");
    }
    searchInput.value = query || "";
    runSearch();
    window.setTimeout(() => {
      searchInput.focus();
      if (searchInput.value) searchInput.select();
    }, 30);
  }

  function closeSearch() {
    if (searchDialog.open) searchDialog.close();
    else searchDialog.removeAttribute("open");
    body.classList.remove("search-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2200);
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (err) {
        copied = false;
      }
      area.remove();
      return copied;
    }
  }

  function citationFor(record) {
    return "Federal Constitution of the Swiss Confederation, Art. " + record.n + ", SR 101 (status as of 3 March 2024). https://www.fedlex.admin.ch/eli/cc/1999/404/en";
  }

  function jumpToTarget(target) {
    const distance = Math.abs(target.getBoundingClientRect().top);
    target.scrollIntoView({
      behavior: reducedMotion || distance > 3200 ? "auto" : "smooth",
      block: "start"
    });
  }

  function scrollToArticle(id) {
    const target = document.getElementById(id);
    if (!target) return;

    if (inlineSearch && inlineSearch.value) clearInlineFilter(false);

    if (window.location.hash !== "#" + id) {
      history.pushState(null, "", "#" + id);
    }

    target.classList.remove("is-target");
    void target.offsetWidth;
    target.classList.add("is-target");
    jumpToTarget(target);
    window.setTimeout(() => target.classList.remove("is-target"), 2600);
  }

  function openResult(id) {
    closeSearch();
    window.setTimeout(() => scrollToArticle(id), 20);
  }

  function filterArticle(record, tokens, phrase) {
    if (!tokens.length) return true;
    const haystack = [record.title, record.text, record.keywords, record.context, record.n].join(" ");
    if (phrase && haystack.includes(phrase)) return true;
    return tokens.every((token) => {
      const variants = tokenVariants(token);
      return variants.some((variant) => haystack.includes(variant));
    });
  }

  function applyInlineFilter(query) {
    const phrase = normalize(query);
    const tokens = getTokens(query);
    let visible = 0;

    records.forEach((record) => {
      const element = document.getElementById(record.id);
      if (!element) return;
      const visibleArticle = !phrase || filterArticle(record, tokens, phrase);
      element.hidden = !visibleArticle;
      if (visibleArticle) visible += 1;
    });

    const containers = document.querySelectorAll(".law-part, .law-chapter, .law-section");
    containers.forEach((container) => {
      container.hidden = !container.querySelector(".law-article:not([hidden])");
    });

    if (preamble) preamble.hidden = Boolean(phrase);
    documentEmpty.hidden = !phrase || visible > 0;
    filterCount.textContent = phrase ? visible + " of " + totalProvisions + " provisions" : totalProvisions + " provisions";
    clearInlineSearch.hidden = !phrase;
  }

  function clearInlineFilter(shouldFocus) {
    inlineSearch.value = "";
    window.clearTimeout(inlineTimer);
    applyInlineFilter("");
    if (shouldFocus !== false) inlineSearch.focus();
  }

  function buildToc() {
    if (!toc) return;
    const chunks = [];
    let partCounter = 0;

    document.querySelectorAll(".law-part").forEach((part) => {
      const partHeading = part.querySelector(".law-part-head h2");
      const partLabel = part.querySelector(".law-part-label");
      if (!partHeading) return;
      partCounter += 1;
      const partNumber = (part.dataset.part || String(partCounter)).padStart(2, "0");
      chunks.push('<a class="toc-link" href="#' + escapeHtml(partHeading.id) + '"><span>' + escapeHtml(partNumber) + '</span><span>' + escapeHtml(partHeading.textContent.trim()) + '</span></a>');

      part.querySelectorAll(".law-chapter").forEach((chapter, chapterIndex) => {
        const chapterHeading = chapter.querySelector(".law-chapter-head h3");
        if (!chapterHeading) return;
        chunks.push('<a class="toc-link toc-chapter" href="#' + escapeHtml(chapterHeading.id) + '"><span>' + escapeHtml(partNumber + "." + (chapterIndex + 1)) + '</span><span>' + escapeHtml(chapterHeading.textContent.trim()) + '</span></a>');
      });
    });

    toc.innerHTML = chunks.join("");
  }

  function activateToc() {
    if (!toc) return;
    const links = Array.from(toc.querySelectorAll(".toc-link"));
    if (!links.length) return;
    const items = links
      .map((link) => ({ link, target: document.getElementById(link.getAttribute("href").slice(1)) }))
      .filter((item) => item.target);
    let ticking = false;

    function updateActive() {
      let active = null;
      items.forEach((item) => {
        if (item.target.getBoundingClientRect().top <= 210) active = item;
      });
      links.forEach((link) => {
        link.classList.toggle("is-active", Boolean(active) && link === active.link);
      });
      ticking = false;
    }

    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateActive);
    }, { passive: true });

    window.addEventListener("resize", updateActive);
    updateActive();
  }

  function setMenu(open) {
    menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    mobileNav.hidden = !open;
    mobileNav.classList.toggle("is-open", open);
  }

  prepareRecords();
  buildToc();
  activateToc();

  if (searchResults) {
    searchResults.setAttribute("role", "listbox");
    searchResults.setAttribute("aria-label", "Search results");
  }

  if (filterCount) filterCount.textContent = totalProvisions + " provisions";

  document.querySelectorAll("[data-search-open]").forEach((button) => {
    button.addEventListener("click", () => openSearch(""));
  });

  document.querySelectorAll("[data-search-query]").forEach((button) => {
    button.addEventListener("click", () => {
      openSearch(button.dataset.searchQuery || "");
    });
  });

  document.querySelectorAll("[data-canton]").forEach((button) => {
    button.addEventListener("click", () => openSearch(button.dataset.canton || ""));
  });

  document.querySelectorAll("[data-copy-citation]").forEach((button) => {
    button.addEventListener("click", async () => {
      const number = button.dataset.copyCitation;
      const record = records.find((item) => item.n === number);
      if (!record) return;
      const copied = await copyText(citationFor(record));
      showToast(copied ? "Citation copied" : "Copy failed");
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(runSearch, 45);
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!currentResults.length) return;
        selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
        updateSelectedResult(true);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!currentResults.length) return;
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelectedResult(true);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const record = currentResults[selectedIndex];
        if (record) openResult(record.id);
      }
    });
  }

  if (searchResults) {
    searchResults.addEventListener("click", (event) => {
      const button = event.target.closest("[data-result-id]");
      if (button) openResult(button.dataset.resultId);
    });
  }

  if (searchClose) {
    searchClose.addEventListener("click", closeSearch);
  }

  if (searchDialog) {
    searchDialog.addEventListener("cancel", () => {
      body.classList.remove("search-open");
    });
    searchDialog.addEventListener("close", () => {
      body.classList.remove("search-open");
      if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus();
      }
    });
    searchDialog.addEventListener("click", (event) => {
      if (event.target === searchDialog) closeSearch();
    });
  }

  if (inlineSearch) {
    inlineSearch.addEventListener("input", () => {
      window.clearTimeout(inlineTimer);
      inlineTimer = window.setTimeout(() => applyInlineFilter(inlineSearch.value), 70);
    });
    inlineSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && inlineSearch.value) {
        event.preventDefault();
        clearInlineFilter();
      }
    });
  }

  if (clearInlineSearch) {
    clearInlineSearch.addEventListener("click", (event) => {
      event.preventDefault();
      clearInlineFilter();
    });
  }

  if (clearInlineSearchEmpty) {
    clearInlineSearchEmpty.addEventListener("click", () => clearInlineFilter());
  }

  if (printButton) {
    printButton.addEventListener("click", () => window.print());
  }

  if (menuButton) {
    menuButton.addEventListener("click", () => {
      setMenu(menuButton.getAttribute("aria-expanded") !== "true");
    });
  }

  document.querySelectorAll("#mobileNav a").forEach((link) => {
    link.addEventListener("click", () => setMenu(false));
  });

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;
    const id = decodeURIComponent(hash.slice(1));
    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();
    if (inlineSearch && inlineSearch.value) clearInlineFilter(false);
    if (id === "top") {
      history.pushState(null, "", "#top");
      window.scrollTo({ top: 0, behavior: reducedMotion || window.scrollY > 3200 ? "auto" : "smooth" });
      return;
    }
    if (id.indexOf("art_") === 0) {
      scrollToArticle(id);
      return;
    }
    if (window.location.hash !== hash) {
      history.pushState(null, "", hash);
    }
    jumpToTarget(target);
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch("");
      return;
    }

    if (event.key === "/" && !isTyping && !searchDialog.open) {
      event.preventDefault();
      openSearch("");
    }
  });

  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && document.getElementById(id)) scrollToArticle(id);
  });

  window.addEventListener("popstate", () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const target = document.getElementById(id);
    if (!target) return;
    if (id.indexOf("art_") === 0) {
      scrollToArticle(id);
    } else {
      jumpToTarget(target);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1040) setMenu(false);
  });

  const initialHash = decodeURIComponent(window.location.hash.slice(1));
  if (initialHash && document.getElementById(initialHash)) {
    window.setTimeout(() => {
      if (initialHash.indexOf("art_") === 0) {
        scrollToArticle(initialHash);
      } else {
        jumpToTarget(document.getElementById(initialHash));
      }
    }, 180);
  }

  const params = new URLSearchParams(window.location.search);
  if (searchDialog && params.get("search") === "1") {
    history.replaceState(null, "", window.location.pathname + window.location.hash);
    window.setTimeout(() => openSearch(""), 220);
  }
})();
