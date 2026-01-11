<script>
(function () {
  // Don’t run in editor routes (/e/...) so players still see/edit the table.
  function isEditMode() {
    return location.pathname.startsWith("/e/") || location.pathname.includes("/e/");
  }

  function textOf(td) {
    return (td?.textContent || "").replace(/\s+/g, " ").trim();
  }

  // ----------------------------
  // NEW: Hide edit-only tips in VIEW mode
  // ----------------------------
  function hideEditOnlyTips(root) {
  if (isEditMode()) return;

  const scope = root.querySelector(".v-main .contents") || root;

  const TIP_PREFIXES = [
    "Portrait tip:",
    "Editing tip:",
    "---------- Do Not Edit Anything Above This Line ----------"
  ];

  // Only consider elements that have a DIRECT <strong> child (your tip pattern)
  const candidates = Array.from(scope.querySelectorAll("div, p, blockquote, li"));

  for (const el of candidates) {
    if (el.dataset.wagHiddenEditOnly === "1") continue;

    const strong = el.querySelector(":scope > strong");
    if (!strong) continue;

    const label = (strong.textContent || "").replace(/\s+/g, " ").trim();
    if (!label) continue;

    if (TIP_PREFIXES.some(prefix => label.startsWith(prefix))) {
      el.style.display = "none";
      el.dataset.wagHiddenEditOnly = "1";
    }
  }
}


  function findWagCardTables(root) {
    const tables = Array.from(root.querySelectorAll('figure.table > table'));
    return tables.filter(tbl => {
      const firstRow = tbl.querySelector("tbody tr");
      if (!firstRow) return false;
      const tds = firstRow.querySelectorAll("td");
      if (tds.length < 2) return false;
      return textOf(tds[0]) === "WAG_CARD" && textOf(tds[1]).toLowerCase() === "v1";
    });
  }

  function extractMapFromTable(tbl) {
    const rows = Array.from(tbl.querySelectorAll("tbody tr"));
    const map = {};
    for (const row of rows) {
      const tds = row.querySelectorAll("td");
      if (tds.length < 2) continue;
      const key = textOf(tds[0]);
      const valTd = tds[1];

      if (key === "WAG_CARD") continue;

      // Portrait special-case
      if (/^portrait$/i.test(key)) {
        const img = valTd.querySelector("img");
        map.portrait = img?.getAttribute("src") || "";
        continue;
      }

      map[key.toLowerCase()] = textOf(valTd);
    }
    return map;
  }

  function renderCardFromMap(map) {
    const name = map["character name"] || "Character";
    const player = map["player name"] || "—";
    const blurb = map["blurb"] || "";
    const level = map["level"] || "—";
    const species = map["species"] || "";
    const klass = map["class / role"] || "";
    const home = map["home / faction"] || "";
    const status = map["status"] || "";
    const portrait = map.portrait || "";

    const badge = (label) => label ? `<span class="wag-charcard-render__badge">${escapeHtml(label)}</span>` : "";

    return `
      <section class="wag-charcard-render" aria-label="Character Card">
        <div class="wag-charcard-render__top">
          ${portrait
            ? `<img class="wag-charcard-render__portrait" src="${escapeHtml(portrait)}" alt="${escapeHtml(name)} portrait">`
            : `<div class="wag-charcard-render__portrait" style="display:flex;align-items:center;justify-content:center;color:var(--dnd-muted);background:rgba(0,0,0,0.04);">No portrait</div>`
          }
          <div>
            <h3 class="wag-charcard-render__title">${escapeHtml(name)}</h3>
            <div class="wag-charcard-render__sub">Player: <strong style="color:var(--dnd-brown);">${escapeHtml(player)}</strong> • Level <strong style="color:var(--dnd-brown);">${escapeHtml(level)}</strong></div>
            ${blurb ? `<div class="wag-charcard-render__blurb">${escapeHtml(blurb)}</div>` : ""}
            <div class="wag-charcard-render__badges">
              ${badge(species)}
              ${badge(klass)}
              ${badge(status)}
            </div>
          </div>
        </div>

        <div class="wag-charcard-render__grid">
          ${home ? `<div class="wag-charcard-render__k">Home / Faction</div><div class="wag-charcard-render__v">${escapeHtml(home)}</div>` : ""}
        </div>
      </section>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }


function isFigureTable(el) {
  const fig = el?.closest?.("figure.table");
  return fig && fig.querySelector("table") ? fig : null;
}

function tableText(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function firstRowStrongLabels(tbl) {
  const row = tbl.querySelector("tbody tr");
  if (!row) return [];
  return Array.from(row.querySelectorAll("td strong")).map(s => tableText(s));
}

function isQuickStatsTable(tbl) {
  const labels = firstRowStrongLabels(tbl);
  return labels.includes("Armor Class") && labels.includes("Initiative") && labels.includes("Speed");
}

function isAbilityScoresTable(tbl) {
  const ths = Array.from(tbl.querySelectorAll("thead th")).map(t => tableText(t));
  const want = ["STR","DEX","CON","INT","WIS","CHA"];
  return want.every(x => ths.includes(x));
}

function isKeyValue2ColTable(tbl) {
  // Typical: 2 columns with bold key in col1
  const row = tbl.querySelector("tbody tr");
  if (!row) return false;
  const tds = row.querySelectorAll("td");
  return tds.length === 2 && !!tds[0].querySelector("strong");
}

function parseQuickStats(tbl) {
  // Each row is: [k,v,k,v,k,v]
  const out = [];
  const rows = Array.from(tbl.querySelectorAll("tbody tr"));
  for (const row of rows) {
    const tds = Array.from(row.querySelectorAll("td"));
    for (let i = 0; i + 1 < tds.length; i += 2) {
      const k = tableText(tds[i].querySelector("strong") || tds[i]);
      const v = tableText(tds[i + 1]);
      if (k) out.push({ k, v });
    }
  }
  return out;
}

function parseAbilities(tbl) {
  const ths = Array.from(tbl.querySelectorAll("thead th")).map(t => tableText(t));
  const vals = Array.from(tbl.querySelectorAll("tbody tr td")).map(td => tableText(td));
  const out = [];
  for (let i = 0; i < Math.min(ths.length, vals.length); i++) {
    // Expected cell: "16 (+3)" etc.
    const cell = vals[i];
    const m = cell.match(/^(\d+)\s*\(([-+]\d+)\)\s*$/);
    out.push({
      abbr: ths[i],
      score: m ? m[1] : cell,
      mod: m ? m[2] : ""
    });
  }
  return out;
}

function parseKeyValue2Col(tbl) {
  const rows = Array.from(tbl.querySelectorAll("tbody tr"));
  const out = [];
  for (const row of rows) {
    const tds = row.querySelectorAll("td");
    if (tds.length !== 2) continue;
    const k = tableText(tds[0].querySelector("strong") || tds[0]);
    const v = tableText(tds[1]);
    if (k) out.push({ k, v });
  }
  return out;
}

function renderSheetSection(title, innerHtml) {
  return `
    <section class="wag-sheet" aria-label="${escapeHtml(title)}">
      <div class="wag-sheet__hdr">
        <h4 class="wag-sheet__title">${escapeHtml(title)}</h4>
      </div>
      <div class="wag-sheet__body">
        ${innerHtml}
      </div>
    </section>
  `;
}

function renderQuickStats(stats) {
  const items = stats.map(({k,v}) => `
    <div class="wag-sheet-stat">
      <div class="wag-sheet-stat__k">${escapeHtml(k)}</div>
      <div class="wag-sheet-stat__v">${escapeHtml(v)}</div>
    </div>
  `).join("");

  return renderSheetSection("Quick Stats", `<div class="wag-sheet-grid">${items}</div>`);
}

function renderAbilities(abilities) {
  const items = abilities.map(a => `
    <div class="wag-ability">
      <div class="wag-ability__abbr">${escapeHtml(a.abbr)}</div>
      <div class="wag-ability__score">${escapeHtml(a.score)}</div>
      <div class="wag-ability__mod">${escapeHtml(a.mod)}</div>
    </div>
  `).join("");

  return renderSheetSection("Ability Scores", `<div class="wag-abilities">${items}</div>`);
}

function renderKeyValueSection(title, pairs) {
  const dl = pairs.map(({k,v}) => `
    <div class="wag-dl__k">${escapeHtml(k)}</div>
    <div class="wag-dl__v">${escapeHtml(v)}</div>
  `).join("");

  return renderSheetSection(title, `<div class="wag-dl">${dl}</div>`);
}

function beautifyStatBlockTables(root) {
  if (isEditMode()) return;

  // Only inside page contents
  const scope = root.querySelector(".v-main .contents") || root;

  const figures = Array.from(scope.querySelectorAll("figure.table"));
  for (const fig of figures) {
    if (fig.dataset.wagSheetRendered === "1") continue;

    const tbl = fig.querySelector("table");
    if (!tbl) continue;

    let html = "";

    if (isQuickStatsTable(tbl)) {
      html = renderQuickStats(parseQuickStats(tbl));
    } else if (isAbilityScoresTable(tbl)) {
      html = renderAbilities(parseAbilities(tbl));
    } else if (isKeyValue2ColTable(tbl)) {
      // Use the nearest preceding h3 as the section title, if present
      const h3 = fig.previousElementSibling && fig.previousElementSibling.tagName === "H3"
        ? fig.previousElementSibling
        : null;
      const title = h3 ? tableText(h3) : "Details";

      // Only “upgrade” the ones that look like stat block sections (avoid random tables)
      const pairs = parseKeyValue2Col(tbl);
      const keys = pairs.map(p => p.k.toLowerCase());
      const looksLikeStatBlock =
        keys.includes("saving throws") ||
        keys.includes("skills") ||
        keys.includes("senses") ||
        keys.includes("languages") ||
        keys.includes("damage resistances") ||
        keys.includes("damage immunities") ||
        keys.includes("damage vulnerabilities") ||
        keys.includes("condition immunities") ||
        keys.includes("melee") ||
        keys.includes("ranged") ||
        keys.includes("bonus action") ||
        keys.includes("reaction") ||
        keys.includes("once/rest");

      if (!looksLikeStatBlock) continue;

      html = renderKeyValueSection(title, pairs);

      // If we used the preceding H3 as title, hide it so you don't see it twice
      if (h3) h3.style.display = "none";
    } else {
      continue;
    }

    // Insert the pretty version above the table and hide the raw table
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    fig.parentNode.insertBefore(wrap.firstElementChild, fig);

    fig.style.display = "none";
    fig.dataset.wagSheetRendered = "1";
  }
}


  function apply(root) {
    if (isEditMode()) return;

    // NEW: hide edit-only helper text
    hideEditOnlyTips(root);

    beautifyStatBlockTables(root);

    const wagTables = findWagCardTables(root);
    for (const tbl of wagTables) {
      const fig = tbl.closest("figure.table");
      if (!fig) continue;

      // Prevent duplicate rendering in SPA navigations
      if (fig.dataset.wagCardRendered === "1") continue;
      fig.dataset.wagCardRendered = "1";

      const map = extractMapFromTable(tbl);

      // Insert rendered card above the table
      const wrap = document.createElement("div");
      wrap.innerHTML = renderCardFromMap(map);
      fig.parentNode.insertBefore(wrap.firstElementChild, fig);

      // Hide the ugly data table in view mode
      fig.style.display = "none";
    }
  }

  // Run now + keep it SPA-safe
  function boot() {
    apply(document);
    const obs = new MutationObserver(() => apply(document));
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
</script>
