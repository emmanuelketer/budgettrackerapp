(() => {
  "use strict";

  const STORAGE_KEY = "budgetTracker.v1";

  const CATEGORIES = {
    expense: ["Food", "Transport", "Friends", "Family", "Entertainment", "Savings", "Forex", "Business", "Credit", "Other"],
    income: ["Salary", "Business", "Freelance", "Forex", "Gifts", "Friends", "Family", "Other"],
  };

  const CATEGORY_STYLE = {
    Food: { icon: "fast-food-outline", color: "#f97316" },
    Transport: { icon: "bus-outline", color: "#3b82f6" },
    Friends: { icon: "people-outline", color: "#ec4899" },
    Family: { icon: "home-outline", color: "#a855f7" },
    Entertainment: { icon: "film-outline", color: "#eab308" },
    Savings: { icon: "wallet-outline", color: "#10b981" },
    Forex: { icon: "swap-horizontal-outline", color: "#06b6d4" },
    Credit: { icon: "card-outline", color: "#6366f1" },
    Salary: { icon: "briefcase-outline", color: "#10b981" },
    Business: { icon: "storefront-outline", color: "#84cc16" },
    Freelance: { icon: "laptop-outline", color: "#8b5cf6" },
    Gifts: { icon: "gift-outline", color: "#f43f5e" },
    Other: { icon: "ellipsis-horizontal-circle-outline", color: "#94a3b8" },
  };
  // Categories that were renamed; saved data using the old name is moved to the new one.
  const RENAMED = { Investment: "Forex" };
  const renameCategory = (cat) => RENAMED[cat] || cat;

  const FALLBACK_STYLE = { icon: "pricetag-outline", color: "#94a3b8" };
  const styleFor = (cat) => CATEGORY_STYLE[cat] || FALLBACK_STYLE;

  const PERIODS = ["daily", "weekly", "monthly", "yearly"];
  const PERIOD_NOUN = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

  // GSAP is optional: the app works without it (CDN blocked) and skips motion for reduced-motion users.
  const gsap = window.gsap;
  const motion = !!gsap && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (motion) document.documentElement.classList.add("has-motion");

  // ---------- State & persistence ----------

  const emptyBudgets = () => ({ daily: {}, weekly: {}, monthly: {}, yearly: {} });

  const defaultState = () => ({
    transactions: [], // { id, type, amount, category, description, date: "YYYY-MM-DD" }
    budgets: emptyBudgets(), // { [period]: { [expenseCategory]: limit } }
    settings: { currency: "KES", theme: null, budgetPeriod: "monthly" },
  });

  let state = loadState();
  let viewMonth = monthKey(todayISO()); // "YYYY-MM"
  let editingId = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      console.warn("Could not load saved data:", err);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Could not save data:", err);
      toast("Couldn't save — browser storage is unavailable or full.", "alert-circle");
    }
  }

  function cleanLimits(obj) {
    const out = {};
    if (obj && typeof obj === "object") {
      for (const [cat, val] of Object.entries(obj)) {
        const n = Number(val);
        if (n > 0) out[renameCategory(cat)] = round2(n);
      }
    }
    return out;
  }

  // Validates and fills in any missing fields so older or imported data is safe to use.
  function normalizeState(data) {
    const base = defaultState();
    if (!data || typeof data !== "object") return base;

    const transactions = Array.isArray(data.transactions)
      ? data.transactions
          .filter((t) => t && (t.type === "income" || t.type === "expense") && Number(t.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
          .map((t) => ({
            id: String(t.id || uid()),
            type: t.type,
            amount: round2(Number(t.amount)),
            category: renameCategory(String(t.category || "Other")),
            description: String(t.description || "").slice(0, 80),
            date: t.date,
          }))
      : [];

    const budgets = emptyBudgets();
    const b = data.budgets;
    if (b && typeof b === "object") {
      const perPeriod = PERIODS.some((p) => b[p] && typeof b[p] === "object");
      if (perPeriod) PERIODS.forEach((p) => (budgets[p] = cleanLimits(b[p])));
      else budgets.monthly = cleanLimits(b); // older saves had a single set of monthly limits
    }

    const settings = { ...base.settings, ...(data.settings || {}) };
    if (!PERIODS.includes(settings.budgetPeriod)) settings.budgetPeriod = "monthly";
    return { transactions, budgets, settings };
  }

  // ---------- Date helpers ----------

  function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseISO(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function todayISO() {
    return toISO(new Date());
  }

  function monthKey(isoDate) {
    return isoDate.slice(0, 7);
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function lastDayOfMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return toISO(new Date(y, m, 0));
  }

  function formatMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function formatDate(iso, opts = { day: "numeric", month: "short" }) {
    return parseISO(iso).toLocaleDateString(undefined, opts);
  }

  // The day budgets are measured against: today when viewing the current month, otherwise the last day of the viewed month.
  function referenceDate() {
    const today = todayISO();
    return monthKey(today) === viewMonth ? today : lastDayOfMonth(viewMonth);
  }

  function periodRange(period) {
    const ref = referenceDate();
    const isToday = ref === todayISO();
    switch (period) {
      case "daily":
        return { start: ref, end: ref, label: (isToday ? "Today · " : "") + formatDate(ref, { weekday: "long", day: "numeric", month: "short" }) };
      case "weekly": {
        const d = parseISO(ref);
        const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
        const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
        const start = toISO(monday);
        const end = toISO(sunday);
        return { start, end, label: `${isToday ? "This week · " : ""}${formatDate(start)} – ${formatDate(end)}` };
      }
      case "yearly": {
        const y = viewMonth.slice(0, 4);
        return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Year ${y}` };
      }
      default:
        return { start: `${viewMonth}-01`, end: lastDayOfMonth(viewMonth), label: formatMonth(viewMonth) };
    }
  }

  // ---------- General helpers ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function money(n) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: state.settings.currency }).format(n);
    } catch {
      return `${state.settings.currency} ${n.toFixed(2)}`;
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) node.append(c);
    return node;
  }

  // Ionicon element (https://ionic.io/ionicons); decorative, so hidden from screen readers.
  function icon(name, className = "") {
    const i = document.createElement("ion-icon");
    i.setAttribute("name", name);
    i.setAttribute("aria-hidden", "true");
    if (className) i.className = className;
    return i;
  }

  let toastTimer;
  function toast(msg, iconName = "checkmark-circle") {
    const t = $("toast");
    t.replaceChildren(icon(iconName), el("span", { textContent: msg }));
    clearTimeout(toastTimer);
    if (motion) {
      gsap.killTweensOf(t);
      gsap.fromTo(t, { y: 30, autoAlpha: 0, scale: 0.9 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(1.8)" });
      toastTimer = setTimeout(() => gsap.to(t, { y: 20, autoAlpha: 0, duration: 0.3, ease: "power2.in" }), 2500);
    } else {
      t.classList.add("show");
      toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
    }
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Animation helpers ----------

  // Counts a money value up/down from whatever the element last showed.
  const counters = new WeakMap(); // el -> { proxy, tween }
  function setMoney(node, value, format = money) {
    const prev = counters.get(node);
    prev?.tween?.kill();
    const proxy = { v: prev ? prev.proxy.v : 0 };
    if (!motion) {
      proxy.v = value;
      node.textContent = format(value);
      counters.set(node, { proxy });
      return;
    }
    const tween = gsap.to(proxy, {
      v: value,
      duration: 1,
      ease: "power3.out",
      onUpdate: () => (node.textContent = format(proxy.v)),
    });
    counters.set(node, { proxy, tween });
  }

  function staggerIn(nodes, vars = {}) {
    nodes = Array.from(nodes);
    if (!motion || !nodes.length) return;
    gsap.from(nodes, { y: 14, autoAlpha: 0, duration: 0.45, stagger: 0.04, ease: "power2.out", clearProps: "transform,opacity,visibility", ...vars });
  }

  function pop(node) {
    if (motion) gsap.fromTo(node, { scale: 0.94 }, { scale: 1, duration: 0.5, ease: "back.out(3)" });
  }

  // ---------- Theme ----------

  function effectiveTheme() {
    return state.settings.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  function applyTheme() {
    const theme = state.settings.theme;
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    $("theme-icon").setAttribute("name", effectiveTheme() === "dark" ? "sunny-outline" : "moon-outline");
  }

  function toggleTheme() {
    state.settings.theme = effectiveTheme() === "dark" ? "light" : "dark";
    saveState();
    applyTheme();
    if (motion) gsap.fromTo("#theme-icon", { rotate: -180, scale: 0.4 }, { rotate: 0, scale: 1, duration: 0.6, ease: "back.out(2)" });
  }

  // ---------- Rendering ----------

  function monthTransactions() {
    return state.transactions.filter((t) => monthKey(t.date) === viewMonth);
  }

  function render(opts = {}) {
    $("month-label").textContent = formatMonth(viewMonth);
    $("currency").value = state.settings.currency;
    renderSummary();
    renderDonut();
    renderBudgets(opts.budgets);
    renderTransactions(opts.list, opts.highlight);
  }

  function renderSummary() {
    let income = 0;
    let expense = 0;
    for (const t of monthTransactions()) {
      if (t.type === "income") income += t.amount;
      else expense += t.amount;
    }
    const balance = income - expense;
    setMoney($("income-total"), income);
    setMoney($("expense-total"), expense);
    setMoney($("balance"), balance);

    let note, noteIcon;
    if (!income && !expense) [note, noteIcon] = ["Add your first transaction to get started", "sparkles-outline"];
    else if (!income) [note, noteIcon] = ["No income recorded this month yet.", "information-circle-outline"];
    else if (balance >= 0) [note, noteIcon] = [`You've kept ${Math.round((balance / income) * 100)}% of your income`, "trophy-outline"];
    else [note, noteIcon] = [`Overspending by ${money(-balance)}`, "warning-outline"];
    $("savings-note").replaceChildren(icon(noteIcon), el("span", { textContent: note }));
  }

  // ----- Donut chart -----
  const SVG_NS = "http://www.w3.org/2000/svg";
  const R = 52;
  const C = 2 * Math.PI * R;
  let donutTween;

  function renderDonut() {
    const group = $("donut-segments");
    const legend = $("donut-legend");
    group.replaceChildren();
    legend.replaceChildren();

    const totals = {};
    for (const t of monthTransactions()) {
      if (t.type === "expense") totals[t.category] = (totals[t.category] || 0) + t.amount;
    }
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    setMoney($("donut-total"), total);

    if (!entries.length) {
      legend.append(el("li", { className: "legend-empty" }, icon("pie-chart-outline"), el("span", { textContent: " No spending recorded this month." })));
      return;
    }

    const gap = entries.length > 1 ? 1.5 : 0;
    let start = 0;
    const segs = entries.map(([cat, amt]) => {
      const len = (amt / total) * C;
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", "60");
      circle.setAttribute("cy", "60");
      circle.setAttribute("r", String(R));
      circle.setAttribute("stroke", styleFor(cat).color);
      circle.setAttribute("stroke-dashoffset", String(-start));
      circle.setAttribute("stroke-dasharray", `0 ${C}`);
      group.append(circle);
      const seg = { el: circle, start, len: Math.max(len - gap, 0.001) };
      start += len;

      const li = el("li", {},
        el("span", { className: "dot" }),
        el("span", { className: "name" }, icon(styleFor(cat).icon), cat),
        el("span", { className: "pct", textContent: `${Math.round((amt / total) * 100)}%` })
      );
      li.querySelector(".dot").style.background = styleFor(cat).color;
      li.title = money(amt);
      li.addEventListener("mouseenter", () => focusSegment(segs, seg));
      li.addEventListener("mouseleave", () => focusSegment(segs, null));
      legend.append(li);
      return seg;
    });

    const draw = (p) => {
      const reach = p * C;
      for (const s of segs) {
        const visible = Math.min(Math.max(reach - s.start, 0), s.len);
        s.el.setAttribute("stroke-dasharray", `${visible} ${C}`);
      }
    };

    donutTween?.kill();
    if (motion) {
      const proxy = { p: 0 };
      donutTween = gsap.to(proxy, { p: 1, duration: 1.2, ease: "power3.inOut", onUpdate: () => draw(proxy.p) });
      staggerIn(legend.children, { x: 10, y: 0 });
    } else {
      draw(1);
    }
  }

  function focusSegment(segs, active) {
    for (const s of segs) {
      const opacity = !active || s === active ? 1 : 0.25;
      if (motion) gsap.to(s.el, { opacity, duration: 0.25 });
      else s.el.style.opacity = opacity;
    }
  }

  // ----- Budgets -----
  const lastPct = new Map(); // "period:category" -> last rendered fill %

  function periodSpending(period) {
    const { start, end } = periodRange(period);
    const spent = {};
    for (const t of state.transactions) {
      if (t.type === "expense" && t.date >= start && t.date <= end) {
        spent[t.category] = (spent[t.category] || 0) + t.amount;
      }
    }
    return spent;
  }

  function updatePeriodTabs(animate) {
    const period = state.settings.budgetPeriod;
    const index = PERIODS.indexOf(period);
    $("period-tabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.period === period)));
    const indicator = $("period-tabs").querySelector(".period-indicator");
    if (motion) gsap.to(indicator, { xPercent: index * 100, duration: animate ? 0.5 : 0, ease: "back.out(1.4)" });
    else indicator.style.transform = `translateX(${index * 100}%)`;
  }

  function budgetRow(key, name, iconName, used, limit, extraClass = "") {
    const pct = limit > 0 ? (used / limit) * 100 : 0;
    const target = Math.min(pct, 100);
    const fill = el("div", { className: "bar-fill" + (pct > 100 ? " over" : pct >= 80 ? " warn" : "") });

    const bar = el("div", { className: "bar" }, fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(target)));
    bar.setAttribute("aria-label", `${name} budget used`);

    const rowIcon = icon(iconName, "row-icon");
    if (CATEGORY_STYLE[name]) rowIcon.style.color = CATEGORY_STYLE[name].color;
    const nameEl = el("span", { className: "budget-name" }, rowIcon, el("span", { textContent: name }));
    if (pct > 100) nameEl.append(el("span", { className: "tag", textContent: "Over" }));
    else if (pct >= 80) nameEl.append(el("span", { className: "tag warn", textContent: "Close" }));

    const remaining = limit - used;
    const amounts = el("span", {
      className: "amounts",
      textContent: `${money(used)} / ${money(limit)}` + (remaining < 0 ? ` · ${money(-remaining)} over` : ` · ${money(remaining)} left`),
    });

    if (motion) {
      gsap.fromTo(fill, { width: (lastPct.get(key) ?? 0) + "%" }, { width: target + "%", duration: 1, ease: "power3.out", delay: 0.1 });
    } else {
      fill.style.width = target + "%";
    }
    lastPct.set(key, target);

    return el("li", { className: extraClass }, el("div", { className: "budget-row-head" }, nameEl, amounts), bar);
  }

  function renderBudgets(animateList) {
    const period = state.settings.budgetPeriod;
    const list = $("budget-list");
    list.replaceChildren();
    $("period-range").textContent = periodRange(period).label;
    $("save-budgets-label").textContent = `Save ${PERIOD_NOUN[period].toLowerCase()} limits`;

    const limits = state.budgets[period];
    const cats = Object.keys(limits);
    if (cats.length === 0) {
      list.append(el("li", { className: "budget-empty" }, icon("speedometer-outline", "empty-icon"), el("span", { textContent: `No ${PERIOD_NOUN[period].toLowerCase()} limits yet. Tap “Edit limits” to set some.` })));
      if (animateList) staggerIn(list.children);
      return;
    }

    const spent = periodSpending(period);
    const totalLimit = cats.reduce((s, c) => s + limits[c], 0);
    const totalUsed = cats.reduce((s, c) => s + (spent[c] || 0), 0);

    if (cats.length > 1) list.append(budgetRow(`${period}:__total`, "Total budgeted", "flag-outline", totalUsed, totalLimit, "budget-total"));
    for (const cat of cats) {
      list.append(budgetRow(`${period}:${cat}`, cat, styleFor(cat).icon, spent[cat] || 0, limits[cat]));
    }
    if (animateList) staggerIn(list.children);
  }

  function setBudgetPeriod(period) {
    if (period === state.settings.budgetPeriod) return;
    state.settings.budgetPeriod = period;
    saveState();
    closeBudgetEditor();
    updatePeriodTabs(true);
    renderBudgets(true);
    if (motion) gsap.fromTo("#period-range", { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.35 });
  }

  // ----- Transactions -----
  function renderTransactions(animate, highlightId) {
    const list = $("tx-list");
    list.replaceChildren();

    const query = $("search").value.trim().toLowerCase();
    const typeFilter = $("filter-type").value;

    const items = monthTransactions()
      .filter((t) => typeFilter === "all" || t.type === typeFilter)
      .filter((t) => !query || t.description.toLowerCase().includes(query) || t.category.toLowerCase().includes(query))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

    $("empty-state").hidden = items.length > 0;
    $("empty-text").textContent =
      monthTransactions().length === 0 ? "No transactions for this month yet." : "No transactions match your filters.";

    for (const t of items) {
      const sign = t.type === "income" ? "+" : "−";
      const { icon: iconName, color } = styleFor(t.category);

      const editBtn = el("button", { type: "button", title: "Edit", ariaLabel: "Edit transaction" }, icon("create-outline"));
      editBtn.addEventListener("click", () => startEdit(t.id));
      const delBtn = el("button", { type: "button", className: "del", title: "Delete", ariaLabel: "Delete transaction" }, icon("trash-outline"));
      delBtn.addEventListener("click", () => deleteTransaction(t.id));

      const avatar = el("span", { className: "avatar", ariaHidden: "true" }, icon(iconName));
      avatar.style.setProperty("--c", color);

      const li = el("li", { className: "tx-item" },
        avatar,
        el("div", { className: "tx-main" },
          el("div", { className: "tx-desc", textContent: t.description || t.category }),
          el("div", { className: "tx-meta", textContent: `${t.category} · ${formatDate(t.date)}` })
        ),
        el("span", { className: `tx-amount ${t.type}`, textContent: `${sign}${money(t.amount)}` }),
        el("div", { className: "tx-actions" }, editBtn, delBtn)
      );
      li.dataset.id = t.id;
      list.append(li);
    }

    if (!motion) return;
    if (animate) staggerIn(Array.from(list.children).slice(0, 20));
    if (highlightId) {
      const li = list.querySelector(`[data-id="${CSS.escape(highlightId)}"]`);
      if (li) {
        gsap.from(li, { x: -30, autoAlpha: 0, duration: 0.5, ease: "back.out(1.6)", clearProps: "transform,opacity,visibility" });
        gsap.fromTo(li, { backgroundColor: "rgba(168, 85, 247, 0.22)" }, { backgroundColor: "rgba(168, 85, 247, 0)", duration: 1.8, ease: "power1.in", clearProps: "backgroundColor" });
      }
    }
  }

  function populateCategories(type, selected) {
    const select = $("category");
    select.replaceChildren(...CATEGORIES[type].map((c) => el("option", { value: c, textContent: c })));
    if (selected && CATEGORIES[type].includes(selected)) select.value = selected;
  }

  // ---------- Transactions ----------

  function selectedType() {
    return document.querySelector('input[name="type"]:checked').value;
  }

  function syncTypeToggle() {
    $("type-toggle").dataset.type = selectedType();
  }

  function resetForm() {
    editingId = null;
    $("tx-form").reset();
    syncTypeToggle();
    populateCategories("expense");
    // Default the date to today if viewing the current month, otherwise the 1st of the viewed month.
    const today = todayISO();
    $("date").value = monthKey(today) === viewMonth ? today : `${viewMonth}-01`;
    $("form-title").textContent = "Add transaction";
    $("submit-label").textContent = "Add transaction";
    $("cancel-edit").hidden = true;
    $("form-card").classList.remove("editing");
  }

  function handleSubmit(e) {
    e.preventDefault();
    const amount = round2(parseFloat($("amount").value));
    const date = $("date").value;
    if (!(amount > 0) || !date) {
      toast("Please enter a valid amount and date.", "alert-circle");
      if (motion) gsap.fromTo("#amount", { x: -8 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.3)" });
      return;
    }

    const tx = {
      id: editingId || uid(),
      type: selectedType(),
      amount,
      category: $("category").value,
      description: $("description").value.trim(),
      date,
    };

    if (editingId) {
      state.transactions = state.transactions.map((t) => (t.id === editingId ? tx : t));
      toast("Transaction updated");
    } else {
      state.transactions.push(tx);
      toast(tx.type === "income" ? "Income added" : "Expense added", tx.type === "income" ? "trending-up" : "checkmark-circle");
    }

    saveState();
    const monthChanged = monthKey(date) !== viewMonth;
    viewMonth = monthKey(date); // jump to the month the transaction belongs to
    resetForm();
    render({ list: monthChanged, highlight: tx.id });
  }

  function startEdit(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    document.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
    syncTypeToggle();
    populateCategories(t.type, t.category);
    $("amount").value = t.amount;
    $("description").value = t.description;
    $("date").value = t.date;
    $("form-title").textContent = "Edit transaction";
    $("submit-label").textContent = "Save changes";
    $("cancel-edit").hidden = false;
    $("form-card").classList.add("editing");
    $("form-card").scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" });
    $("amount").focus({ preventScroll: true });
    pop($("form-card"));
  }

  function deleteTransaction(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    if (!confirm(`Delete "${t.description || t.category}" (${money(t.amount)})?`)) return;

    const remove = () => {
      state.transactions = state.transactions.filter((x) => x.id !== id);
      if (editingId === id) resetForm();
      saveState();
      render();
      toast("Transaction deleted", "trash");
    };

    const li = $("tx-list").querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (motion && li) {
      li.style.overflow = "hidden";
      gsap.timeline({ onComplete: remove })
        .to(li, { x: 80, autoAlpha: 0, duration: 0.28, ease: "power2.in" })
        .to(li, { height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.22, ease: "power2.inOut" });
    } else {
      remove();
    }
  }

  // ---------- Budgets editor ----------

  function openBudgetEditor() {
    const period = state.settings.budgetPeriod;
    const limits = state.budgets[period];
    const container = $("budget-inputs");
    container.replaceChildren(
      el("p", { className: "muted small-text", textContent: `${PERIOD_NOUN[period]} limit per category — leave blank for no limit.` }),
      ...CATEGORIES.expense.map((cat) => {
        const id = `budget-${cat}`;
        const input = el("input", {
          id,
          type: "number",
          min: "0",
          step: "0.01",
          inputMode: "decimal",
          placeholder: "No limit",
          value: limits[cat] ?? "",
        });
        input.dataset.category = cat;
        return el("div", { className: "budget-inputs-row" },
          el("label", { htmlFor: id }, icon(styleFor(cat).icon, "row-icon"), cat),
          input
        );
      })
    );
    $("budget-list").hidden = true;
    $("budget-form").hidden = false;
    $("edit-budgets").hidden = true;
    staggerIn(container.querySelectorAll(".budget-inputs-row"), { x: -12, y: 0, stagger: 0.03 });
  }

  function closeBudgetEditor() {
    $("budget-list").hidden = false;
    $("budget-form").hidden = true;
    $("edit-budgets").hidden = false;
  }

  function saveBudgets(e) {
    e.preventDefault();
    const period = state.settings.budgetPeriod;
    const limits = {};
    for (const input of $("budget-inputs").querySelectorAll("input")) {
      const n = parseFloat(input.value);
      if (n > 0) limits[input.dataset.category] = round2(n);
    }
    state.budgets[period] = limits;
    saveState();
    closeBudgetEditor();
    renderBudgets(true);
    toast(`${PERIOD_NOUN[period]} limits saved`);
  }

  // ---------- Import / export ----------

  function exportJSON() {
    download(`budget-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
  }

  function exportCSV() {
    const esc = (v) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [["date", "type", "category", "description", "amount"]];
    for (const t of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([t.date, t.type, t.category, t.description, t.amount]);
    }
    download(`budget-transactions-${todayISO()}.csv`, rows.map((r) => r.map(esc).join(",")).join("\n"), "text/csv");
  }

  function importJSON(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = normalizeState(JSON.parse(reader.result));
        if (!confirm(`Import ${data.transactions.length} transactions? This replaces your current data.`)) return;
        state = data;
        saveState();
        applyTheme();
        resetForm();
        updatePeriodTabs(false);
        render({ list: true, budgets: true });
        toast("Data imported", "cloud-done");
      } catch {
        toast("That file isn't a valid backup.", "alert-circle");
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm("Delete ALL transactions and budgets? This cannot be undone.")) return;
    const settings = state.settings;
    state = defaultState();
    state.settings = settings;
    saveState();
    resetForm();
    render();
    toast("All data cleared", "trash");
  }

  // ---------- Month navigation ----------

  function changeMonth(delta) {
    viewMonth = shiftMonth(viewMonth, delta);
    if (!editingId) resetForm();
    render({ list: true, budgets: true });
    if (motion) {
      gsap.fromTo("#month-label", { x: 30 * delta, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out" });
      pop($("balance-card"));
    }
  }

  // ---------- Motion extras ----------

  function intro() {
    if (!motion) return;

    gsap.timeline({ defaults: { ease: "power3.out" } })
      .from(".app-header", { y: -40, autoAlpha: 0, duration: 0.7, clearProps: "transform,opacity,visibility" })
      .from(".brand-mark", { rotate: -120, scale: 0, duration: 0.8, ease: "back.out(2)" }, "-=0.45")
      .from(".reveal", { y: 40, autoAlpha: 0, duration: 0.8, stagger: 0.1, clearProps: "transform,opacity,visibility" }, "-=0.5");

    // Slowly drifting background blobs.
    gsap.utils.toArray(".blob").forEach((blob, i) => {
      gsap.to(blob, {
        x: "random(-140, 140)",
        y: "random(-110, 110)",
        scale: "random(0.8, 1.25)",
        duration: "random(9, 15)",
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        repeatRefresh: true,
        delay: i * 0.6,
      });
    });

    // 3D tilt on the balance card for mouse users.
    const card = $("balance-card");
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      gsap.set(card, { transformPerspective: 900 });
      const rx = gsap.quickTo(card, "rotationX", { duration: 0.6, ease: "power3" });
      const ry = gsap.quickTo(card, "rotationY", { duration: 0.6, ease: "power3" });
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 12);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 12);
      });
      card.addEventListener("pointerleave", () => {
        rx(0);
        ry(0);
      });
    }

    // Springy press feedback on every button.
    document.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".btn, .icon-btn");
      if (btn) gsap.fromTo(btn, { scale: 0.92 }, { scale: 1, duration: 0.5, ease: "back.out(4)", clearProps: "transform" });
    });
  }

  // ---------- Wire up ----------

  function init() {
    applyTheme();
    resetForm();
    updatePeriodTabs(false);
    render({ list: true, budgets: true });
    intro();

    $("tx-form").addEventListener("submit", handleSubmit);
    $("cancel-edit").addEventListener("click", resetForm);
    document.querySelectorAll('input[name="type"]').forEach((r) =>
      r.addEventListener("change", () => {
        syncTypeToggle();
        populateCategories(selectedType());
      })
    );

    $("prev-month").addEventListener("click", () => changeMonth(-1));
    $("next-month").addEventListener("click", () => changeMonth(1));

    $("search").addEventListener("input", () => renderTransactions(false));
    $("filter-type").addEventListener("change", () => renderTransactions(true));

    $("currency").addEventListener("change", (e) => {
      state.settings.currency = e.target.value;
      saveState();
      render();
    });
    $("theme-toggle").addEventListener("click", toggleTheme);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

    $("period-tabs").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-period]");
      if (btn) setBudgetPeriod(btn.dataset.period);
    });
    $("edit-budgets").addEventListener("click", openBudgetEditor);
    $("cancel-budgets").addEventListener("click", closeBudgetEditor);
    $("budget-form").addEventListener("submit", saveBudgets);

    $("export-btn").addEventListener("click", exportJSON);
    $("export-csv-btn").addEventListener("click", exportCSV);
    $("import-file").addEventListener("change", importJSON);
    document.querySelector('label[for="import-file"]').addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        $("import-file").click();
      }
    });
    $("clear-btn").addEventListener("click", clearAll);

    // Keep multiple open tabs in sync.
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEY) return;
      state = loadState();
      applyTheme();
      updatePeriodTabs(false);
      render();
    });
  }

  init();
})();
