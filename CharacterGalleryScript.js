<script>
(async () => {
  // ----------------------------
  // Config
  // ----------------------------
  const GALLERY_PATH = "Longmorn_Setting/Characters";
  const TEMPLATE_PATH = "Longmorn_Setting/Characters/PC_Template";
  const DEFAULT_LOCALE = "en";
  const LIST_LIMIT = 2000;

  // Wiki.js editor key can vary by instance. Common: "ckeditor" for WYSIWYG.
  // If create fails with an editor error, change this to whatever your instance expects.
  const CREATE_EDITOR = "ckeditor";

  // ----------------------------
  // Small helpers (SPA-safe)
  // ----------------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function getLocaleFromUrl() {
    // Expected URL style: /en/Longmorn_Setting/Characters
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[0] || DEFAULT_LOCALE;
  }

  function pageViewUrl(locale, path) {
    return `/${locale}/${path}`;
  }

  function pageEditUrl(locale, path) {
    // Wiki.js reserved "e" for editor (docs)
    return `/e/${locale}/${path}`;
  }

  function slugify(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "new_character";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function ensureDialog(id) {
    let dlg = document.getElementById(id);
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = id;
      document.body.appendChild(dlg);
    }
    return dlg;
  }

  function showAlert(title, message) {
    const dlg = ensureDialog("wagCharGalleryAlert");
    dlg.innerHTML = `
      <form method="dialog" style="min-width:min(720px,92vw);">
        <h3 style="margin:0 0 .5rem 0;">${escapeHtml(title)}</h3>
        <div style="padding:.75rem;border:1px solid rgba(0,0,0,.15);border-radius:.5rem;background:rgba(255,255,255,.35);">
          <pre style="white-space:pre-wrap;margin:0;">${escapeHtml(message)}</pre>
        </div>
        <div style="margin-top:.75rem;display:flex;justify-content:flex-end;gap:.5rem;">
          <button value="close">Close</button>
        </div>
      </form>
    `;
    dlg.showModal();
  }

  // ----------------------------
  // GraphQL client (session cookie, same-origin)
  // ----------------------------
  async function wikijsGraphQL(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GraphQL HTTP ${res.status}: ${text || res.statusText}`);
    }

    const payload = await res.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors.map(e => e.message).join("\n"));
    }
    return payload.data;
  }

  // ----------------------------
  // Page listing + metadata extraction
  // ----------------------------
  function normalizePrefix(prefix) {
    const p = String(prefix || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
    return p ? `${p}/` : "";
  }

  async function listPagesUnderPath(pathPrefix) {
    const prefix = normalizePrefix(pathPrefix);

    const query = `
      query ($limit: Int!) {
        pages {
          list(limit: $limit, orderBy: TITLE) {
            id
            path
            title
            locale
          }
        }
      }
    `;

    const data = await wikijsGraphQL(query, { limit: LIST_LIMIT });
    const all = data?.pages?.list ?? [];

    return all
      .filter(p => (p.path || "").startsWith(prefix))
      .filter(p => p.path !== GALLERY_PATH)              // exclude the gallery page itself
      .filter(p => p.path !== TEMPLATE_PATH)             // exclude template
      .map(p => ({ id: p.id, path: p.path, title: p.title, locale: p.locale }));
  }

  async function fetchPageContent(id) {
    const query = `
      query ($id: Int!) {
        pages {
          single(id: $id) {
            id
            path
            title
            content
          }
        }
      }
    `;
    const data = await wikijsGraphQL(query, { id });
    return data?.pages?.single;
  }

function parseCharacterMetaFromContent(html, fallbackTitle) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

  // --- Helper: normalize label text from left column
  const norm = (s) =>
    String(s || "")
      .replace(/\u00a0/g, " ")
      .trim()
      .toLowerCase();

  // --- Find the WAG_CARD v1 table (first row: WAG_CARD / v1)
  const tables = Array.from(doc.querySelectorAll("figure.table > table, table"));
  let cardTable = null;

  for (const t of tables) {
    const firstRow = t.querySelector("tbody tr") || t.querySelector("tr");
    if (!firstRow) continue;

    const tds = firstRow.querySelectorAll("td, th");
    if (tds.length < 2) continue;

    const left = norm(tds[0].textContent);
    const right = norm(tds[1].textContent);

    if (left === "wag_card" && right === "v1") {
      cardTable = t;
      break;
    }
  }

  // Fallback: old data-cc behavior (in case you use it later)
  if (!cardTable) {
    const nameEl = doc.querySelector('[data-cc="name"]');
    const playerEl = doc.querySelector('[data-cc="player"]');
    const blurbEl = doc.querySelector('[data-cc="blurb"]');
    const portraitEl = doc.querySelector('img[data-cc="portrait"]') || doc.querySelector('[data-cc="portrait"] img');
    const levelEl = doc.querySelector('[data-cc="level"]');

    const name = (nameEl?.textContent || fallbackTitle || "").trim();
    const player = (playerEl?.textContent || "").trim();
    const blurb = (blurbEl?.textContent || "").trim();
    const portrait = (portraitEl?.getAttribute("src") || "").trim();
    const levelRaw = (levelEl?.textContent || "").trim();

    const level = Number.parseInt(levelRaw, 10);
    return {
      name: name || fallbackTitle || "(Untitled)",
      player: player || "—",
      blurb: blurb || "",
      portrait,
      level: Number.isFinite(level) ? level : null
    };
  }

  // --- Map rows: left column label -> right column cell element
  const rowMap = new Map();
  const rows = Array.from(cardTable.querySelectorAll("tbody tr, tr"));
  for (const r of rows) {
    const cells = r.querySelectorAll("td, th");
    if (cells.length < 2) continue;

    const label = norm(cells[0].textContent);
    const valueCell = cells[1];
    if (!label) continue;

    rowMap.set(label, valueCell);
  }

  // --- Extractors
  const getText = (label) => {
    const cell = rowMap.get(label);
    if (!cell) return "";
    return String(cell.textContent || "")
      .replace(/\u00a0/g, " ")
      .trim();
  };

  const getImgSrc = (label) => {
    const cell = rowMap.get(label);
    if (!cell) return "";
    const img = cell.querySelector("img");
    return (img?.getAttribute("src") || "").trim();
  };

  const name = getText("character name") || fallbackTitle || "(Untitled)";
  const player = getText("player name") || "—";
  const blurb = getText("blurb") || "";
  const portrait = getImgSrc("portrait");

  const levelRaw = getText("level");
  const levelNum = Number.parseInt(levelRaw, 10);
  const level = Number.isFinite(levelNum) ? levelNum : null;

  return { name, player, blurb, portrait, level };
}


  // Simple concurrency limiter so we don’t DDOS your own wiki like a barbarian with caffeine
  async function mapLimit(items, limit, mapper) {
    const results = [];
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await mapper(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return results;
  }

  // ----------------------------
  // Mutations: create (clone) + delete
  // ----------------------------
  async function createCharacterFromTemplate({ name }) {
    const locale = getLocaleFromUrl();
    const template = await findPageByPathExact(TEMPLATE_PATH);

    if (!template?.id) {
      throw new Error(`Template page not found at path: ${TEMPLATE_PATH}`);
    }

    const tpl = await fetchPageContent(template.id);
    if (!tpl?.content) {
      throw new Error(`Template content is empty or unreadable: ${TEMPLATE_PATH}`);
    }

    // Fill Character Name if the template includes a data-cc="name" node
    let content = String(tpl.content);
    content = content.replace(
      /(<[^>]+data-cc="name"[^>]*>)([\s\S]*?)(<\/[^>]+>)/i,
      `$1${escapeHtml(name)}$3`
    );
	// Also replace the table placeholder if present (template v1)
	content = content.replace(/CHARACTER NAME/g, escapeHtml(name));

    const newPath = `${GALLERY_PATH}/${slugify(name)}`;

    const mutation = `
      mutation (
        $content: String!
        $description: String!
        $editor: String!
        $isPublished: Boolean!
        $isPrivate: Boolean!
        $locale: String!
        $path: String!
        $tags: [String]!
        $title: String!
      ) {
        pages {
          create(
            content: $content
            description: $description
            editor: $editor
            isPublished: $isPublished
            isPrivate: $isPrivate
            locale: $locale
            path: $path
            tags: $tags
            title: $title
          ) {
            responseResult { succeeded errorCode slug message }
            page { id path title }
          }
        }
      }
    `;

    const variables = {
      content,
      description: `Player Character: ${name}`,
      editor: CREATE_EDITOR,
      isPublished: true,
      isPrivate: false,
      locale,
      path: newPath,
      tags: [],
      title: name
    };

    const data = await wikijsGraphQL(mutation, variables);
    const rr = data?.pages?.create?.responseResult;
    if (!rr?.succeeded) {
      throw new Error(rr?.message || `Create failed (${rr?.slug || "unknown"} / ${rr?.errorCode || "?"})`);
    }

    return data.pages.create.page;
  }

  async function deletePageById(id) {
    const mutation = `
      mutation ($id: Int!) {
        pages {
          delete(id: $id) {
            responseResult { succeeded errorCode slug message }
          }
        }
      }
    `;
    const data = await wikijsGraphQL(mutation, { id });
    const rr = data?.pages?.delete?.responseResult;
    if (!rr?.succeeded) {
      throw new Error(rr?.message || `Delete failed (${rr?.slug || "unknown"} / ${rr?.errorCode || "?"})`);
    }
    return true;
  }

  // Some Wiki.js versions have getSingleByPath; safest cross-version: list + match path.
  async function findPageByPath(path) {
    const all = await listPagesUnderPath("Longmorn_Setting"); // broad enough for your structure
    return all.find(p => p.path === path) || null;
  }

  async function findPageByPathExact(path) {
    const query = `
      query ($limit: Int!) {
        pages {
          list(limit: $limit, orderBy: PATH) {
            id
            path
            title
            locale
          }
        }
      }
    `;

    const data = await wikijsGraphQL(query, { limit: LIST_LIMIT });
    const all = data?.pages?.list ?? [];
    return all.find(p => p.path === path) || null;
  }

  // ----------------------------
  // UI render
  // ----------------------------
  function renderShell(host) {
    host.innerHTML = `
      <div class="wag-char-gallery-shell" style="margin-top:.25rem;">
        <div class="wag-char-gallery-bar" style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem;">
          <div style="flex:1 1 auto;">
            <div style="font-family: var(--font-display); letter-spacing:.06em; text-transform:uppercase; color: var(--dnd-red); font-size:1.2rem;">
              Character Gallery
            </div>
            <div style="color: var(--dnd-muted); font-family: var(--font-ui); font-size:.9rem;">
            </div>
          </div>
          <div style="display:flex;gap:.5rem;align-items:center;">
            <button id="wagCharNewBtn" class="v-btn v-btn--depressed v-btn--outlined theme--light v-size--small" style="padding:.4rem .75rem;border-radius:999px;">
              + New Character
            </button>
            <button id="wagCharRefreshBtn" class="v-btn v-btn--depressed v-btn--outlined theme--light v-size--small" style="padding:.4rem .75rem;border-radius:999px;">
              Refresh
            </button>
          </div>
        </div>

        <div id="wagCharStatus" style="margin:.25rem 0 1rem;color:var(--dnd-muted);font-family:var(--font-ui);"></div>

        <div id="wagCharGrid" style="
          display:grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 14px;
          align-items: stretch;
        "></div>
      </div>
    `;
  }

function renderCard(p, meta, locale) {
  const portrait = meta.portrait
    ? `<img src="${escapeHtml(meta.portrait)}" alt="${escapeHtml(meta.name)}" style="width:100%;height:220px;object-fit:cover;display:block;">`
    : `<div style="height:220px;display:flex;align-items:center;justify-content:center;color:var(--dnd-muted);font-family:var(--font-ui);background:rgba(0,0,0,0.04);">
         No portrait
       </div>`;

  const blurb = meta.blurb ? escapeHtml(meta.blurb) : `<span style="color:var(--dnd-muted);">No blurb yet.</span>`;

  const levelChip = (meta.level !== null && meta.level !== undefined && String(meta.level).trim() !== "")
    ? `Lvl ${meta.level}`
    : "Lvl —";

  return `
    <div class="wag-char-card" style="
      border:1px solid var(--dnd-border);
      border-radius: var(--radius-card);
      overflow:hidden;
      background: var(--dnd-parchment);
      box-shadow: var(--shadow-card-soft);
      display:flex;
      flex-direction:column;
    ">
      <a href="${pageViewUrl(locale, p.path)}" style="text-decoration:none;border-bottom:none;">
        ${portrait}
      </a>
      <div style="padding:12px 12px 10px;">
        <div style="font-family:var(--font-display);letter-spacing:.05em;color:var(--dnd-ink);font-size:1.05rem;">
          ${escapeHtml(meta.name)}
        </div>

        <!-- Player + Level line -->
        <div style="margin-top:2px;font-family:var(--font-ui);font-size:.85rem;color:var(--dnd-muted);display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap;">
          <span>
            Player: <span style="color:var(--dnd-brown);font-weight:600;">${escapeHtml(meta.player)}</span>
          </span>
          <span style="opacity:.75;">•</span>
          <span style="color:var(--dnd-brown);font-weight:600;">${escapeHtml(levelChip)}</span>
        </div>

        <div style="margin-top:8px;font-family:var(--font-body);font-size:.92rem;line-height:1.4;color:var(--dnd-ink);">
          ${blurb}
        </div>
      </div>
      <div style="margin-top:auto;padding:10px 12px 12px;display:flex;gap:8px;">
        <a class="wagCharView" href="${pageViewUrl(locale, p.path)}"
           style="flex:1 1 auto;text-align:center;padding:.35rem .5rem;border-radius:999px;border:1px solid rgba(101,69,25,0.45);background:rgba(245,241,230,0.55);color:var(--dnd-brown);font-family:var(--font-ui);text-transform:uppercase;letter-spacing:.05em;font-size:.75rem;">
          View
        </a>
        <a class="wagCharEdit" href="${pageEditUrl(locale, p.path)}"
           style="flex:1 1 auto;text-align:center;padding:.35rem .5rem;border-radius:999px;border:1px solid rgba(177,23,22,0.45);background:rgba(177,23,22,0.08);color:var(--dnd-red);font-family:var(--font-ui);text-transform:uppercase;letter-spacing:.05em;font-size:.75rem;">
          Edit
        </a>
        <button class="wagCharDelete" data-page-id="${p.id}" data-page-title="${escapeHtml(meta.name)}"
           style="flex:0 0 auto;padding:.35rem .65rem;border-radius:999px;border:1px solid rgba(123,17,17,0.45);background:rgba(123,17,17,0.08);color:var(--dnd-blood);font-family:var(--font-ui);text-transform:uppercase;letter-spacing:.05em;font-size:.75rem;">
          ✕
        </button>
      </div>
    </div>
  `;
}


function showCreateDialog() {
  const dlg = ensureDialog("wagCharCreateDlg");
  dlg.classList.add("wag-dialog");

  // One-time wiring for “normal dialog behavior”
  if (dlg.dataset.wagWired !== "1") {
    // ESC key triggers a "cancel" event on <dialog>
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      dlg.close("cancel");
    });

    // Click on backdrop area (dialog element itself) -> cancel
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close("cancel");
    });

    dlg.dataset.wagWired = "1";
  }

  dlg.innerHTML = `
    <div class="wag-dialog__hdr">
      <h3 class="wag-dialog__title">New Character</h3>
      <button type="button" class="wag-btn wag-btn--icon" id="wagDlgX" aria-label="Close">✕</button>
    </div>

    <div class="wag-dialog__body">
      <div style="color:var(--dnd-muted); font-size:.9rem; margin-bottom:.75rem;">
        This clones from <code style="font-family:var(--font-mono);">PC_Template</code> and then opens the new page in edit mode.
      </div>

      <div class="wag-dialog__grid">
        <label>
          <div class="wag-dialog__label">Character name</div>
          <input id="wagNewCharName" class="wag-dialog__input" required placeholder="e.g. San Talamander" />
        </label>
      </div>
    </div>

    <div class="wag-dialog__actions">
      <button type="button" class="wag-btn" id="wagNewCharCancel">Cancel</button>
      <button type="button" class="wag-btn wag-btn--primary" id="wagNewCharCreate">Create</button>
    </div>
  `;

  // Wire buttons for this render
  dlg.querySelector("#wagDlgX")?.addEventListener("click", () => dlg.close("cancel"));
  dlg.querySelector("#wagNewCharCancel")?.addEventListener("click", () => dlg.close("cancel"));

  dlg.querySelector("#wagNewCharCreate")?.addEventListener("click", () => {
    const name = dlg.querySelector("#wagNewCharName")?.value?.trim();
    if (!name) {
      dlg.querySelector("#wagNewCharName")?.focus();
      return;
    }
    dlg.close("ok"); // sets dlg.returnValue = "ok"
  });

  dlg.showModal();

  // Focus the input after showModal so Firefox behaves
  setTimeout(() => dlg.querySelector("#wagNewCharName")?.focus(), 0);

  return dlg;
}

  // ----------------------------
  // Mount / refresh
  // ----------------------------
  async function mount() {
    const locale = getLocaleFromUrl();

    const here = location.pathname.replace(/\/+$/, "");
    const expected = `/${locale}/${GALLERY_PATH}`.replace(/\/+$/, "");
    if (here !== expected) return false;

    const host = document.getElementById("wagCharGallery");
    if (!host) return false;

    // ✅ Prevent re-render / re-wire / re-refresh
    if (host.dataset.wagCharGalleryMounted === "1") return true;
    host.dataset.wagCharGalleryMounted = "1";

    renderShell(host);

    const status = host.querySelector("#wagCharStatus");
    const grid = host.querySelector("#wagCharGrid");
    const btnNew = host.querySelector("#wagCharNewBtn");
    const btnRefresh = host.querySelector("#wagCharRefreshBtn");

    async function refresh() {
      status.textContent = "Loading characters…";
      grid.innerHTML = "";

      const pages = await listPagesUnderPath(GALLERY_PATH);

      // Sort by title as a fallback, but we’ll primarily sort by extracted name if present.
      pages.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: "base" }));

      const enriched = await mapLimit(pages, 8, async (p) => {
        const full = await fetchPageContent(p.id);
        const meta = parseCharacterMetaFromContent(full?.content, p.title);
        return { page: p, meta };
      });

      enriched.sort((a, b) => String(a.meta.name).localeCompare(String(b.meta.name), undefined, { sensitivity: "base" }));

      grid.innerHTML = enriched.map(({ page, meta }) => renderCard(page, meta, locale)).join("");
      status.textContent = `${enriched.length} character(s) found.`;

      // Wire delete buttons
      grid.querySelectorAll(".wagCharDelete").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.getAttribute("data-page-id"));
          const title = btn.getAttribute("data-page-title") || "this character";

          const ok = confirm(`Delete "${title}"?\n\nThis will remove the page permanently.`);
          if (!ok) return;

          try {
            btn.disabled = true;
            await deletePageById(id);
            await refresh();
          } catch (e) {
            showAlert("Delete failed", e?.message || String(e));
          } finally {
            btn.disabled = false;
          }
        });
      });
    }

    btnRefresh.addEventListener("click", refresh);

    btnNew.addEventListener("click", async () => {
      const dlg = showCreateDialog();
      await sleep(0);

      dlg.addEventListener("close", async () => {
        if (dlg.returnValue !== "ok") return;

        const name = dlg.querySelector("#wagNewCharName")?.value?.trim();
        if (!name) return;

        try {
          btnNew.disabled = true;
          btnNew.textContent = "Creating…";
          const created = await createCharacterFromTemplate({ name });

          // Jump straight into edit mode so they can start filling it out
          location.href = pageEditUrl(locale, created.path);
        } catch (e) {
          showAlert("Create failed", e?.message || String(e));
        } finally {
          btnNew.disabled = false;
          btnNew.textContent = "+ New Character";
        }
      }, { once: true });
    });

    await refresh();
  }

  // Try a few times until the gallery host exists, then stop.
  for (let i = 0; i < 40; i++) {
    const done = await mount();
    if (done) break;
    await sleep(200);
  }
})();
</script>
