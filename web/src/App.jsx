import { useEffect, useMemo, useState } from "react";
import { loadCsv } from "./lib/loadCsv";
import { format, parseISO, isValid } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import "./App.css";

function toBool(v) {
  return String(v).toLowerCase() === "true";
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeParseDate(value) {
  const d = parseISO(String(value));
  return isValid(d) ? d : null;
}

function monthKey(isoDateStr) {
  const d = safeParseDate(isoDateStr);
  if (!d) return "";
  return format(d, "yyyy-MM");
}

function currency(n) {
  return `$${n.toFixed(2)}`;
}

const CATEGORY_LABELS = {
  cat_income: "Income",
  cat_housing: "Housing",
  cat_rent: "Rent",
  cat_utilities: "Utilities",
  cat_internet: "Internet",
  cat_food: "Food",
  cat_groceries: "Groceries",
  cat_dining: "Dining",
  cat_transport: "Transport",
  cat_gas: "Gas",
  cat_transit: "Public Transit",
  cat_auto: "Auto Maintenance",
  cat_health: "Health",
  cat_pharmacy: "Pharmacy",
  cat_insurance: "Insurance",
  cat_entertainment: "Entertainment",
  cat_streaming: "Streaming",
  cat_events: "Events",
  cat_shopping: "Shopping",
  cat_clothes: "Clothes",
  cat_homegoods: "Home Goods",
  cat_travel: "Travel",
  cat_fees: "Fees",
  cat_interest: "Interest",
  cat_transfers: "Transfers",
  cat_uncategorized: "Uncategorized",
};

function labelForCategory(id) {
  if (!id) return "Uncategorized";
  return CATEGORY_LABELS[id] || id.replace(/^cat_/, "").replaceAll("_", " ");
}

function CozyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#fff8f0",
        border: "1px solid #d8bca8",
        borderRadius: 12,
        padding: 10,
        color: "#4d3529",
        boxShadow: "0 8px 24px rgba(77,53,41,0.08)",
      }}
    >
      {label ? <div style={{ marginBottom: 6, fontWeight: 600 }}>{label}</div> : null}
      {payload.map((item) => (
        <div key={item.dataKey} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <span>{item.name || item.dataKey}</span>
          <span>{currency(Number(item.value || 0))}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [tx, setTx] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState("2026-12-31");
  const [showTransfers, setShowTransfers] = useState(false);
  const [theme, setTheme] = useState("day");

  useEffect(() => {
    async function run() {
      try {
        setLoading(true);
        setError("");

        const rows = await loadCsv("/data/transactions.csv");
        const normalized = rows.map((r) => ({
          ...r,
          amount: toNum(r.amount),
          is_transfer: toBool(r.is_transfer),
        }));

        setTx(normalized);

        const dates = normalized
          .map((r) => safeParseDate(r.date))
          .filter(Boolean)
          .sort((a, b) => a - b);

        if (dates.length > 0) {
          setStart(format(dates[0], "yyyy-MM-dd"));
          setEnd(format(dates[dates.length - 1], "yyyy-MM-dd"));
        }
      } catch (e) {
        console.error(e);
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    run();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "night" ? "night" : "day");
  }, [theme]);

  const filtered = useMemo(() => {
    const s = safeParseDate(start);
    const e = safeParseDate(end);
    if (!s || !e) return tx;

    return tx.filter((r) => {
      const d = safeParseDate(r.date);
      return d && d >= s && d <= e;
    });
  }, [tx, start, end]);

  const nonTransfer = useMemo(
    () => filtered.filter((r) => !r.is_transfer),
    [filtered]
  );

  const rowsForAnalytics = showTransfers ? filtered : nonTransfer;

  const monthlySeries = useMemo(() => {
    const map = new Map();

    for (const r of rowsForAnalytics) {
      if (r.is_transfer) continue;
      const m = monthKey(r.date);
      if (!m) continue;

      if (!map.has(m)) {
        map.set(m, { month: m, income: 0, expenses: 0, cashflow: 0 });
      }

      const obj = map.get(m);
      if (r.amount > 0) obj.income += r.amount;
      if (r.amount < 0) obj.expenses += Math.abs(r.amount);
      obj.cashflow = obj.income - obj.expenses;
    }

    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [rowsForAnalytics]);

  const spendByCategory = useMemo(() => {
    const map = new Map();

    for (const r of rowsForAnalytics) {
      if (r.is_transfer || r.amount >= 0) continue;

      const catId =
        r.subcategory_id && String(r.subcategory_id).trim()
          ? r.subcategory_id
          : r.category_id || "cat_uncategorized";

      map.set(catId, (map.get(catId) || 0) + Math.abs(r.amount));
    }

    return Array.from(map.entries())
      .map(([categoryId, spend]) => ({
        categoryId,
        category: labelForCategory(categoryId),
        spend,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
  }, [rowsForAnalytics]);

  const topMerchants = useMemo(() => {
    const map = new Map();

    for (const r of rowsForAnalytics) {
      if (r.is_transfer || r.amount >= 0) continue;
      const merchant = r.merchant || "(unknown)";
      map.set(merchant, (map.get(merchant) || 0) + Math.abs(r.amount));
    }

    return Array.from(map.entries())
      .map(([merchant, spend]) => ({ merchant, spend }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
  }, [rowsForAnalytics]);

  const summary = useMemo(() => {
    let income = 0;
    let expenses = 0;

    for (const r of rowsForAnalytics) {
      if (r.is_transfer) continue;
      if (r.amount > 0) income += r.amount;
      if (r.amount < 0) expenses += Math.abs(r.amount);
    }

    return {
      income,
      expenses,
      cashflow: income - expenses,
    };
  }, [rowsForAnalytics]);

  const recentTransactions = useMemo(() => {
    const rows = showTransfers ? filtered : nonTransfer;
    return [...rows]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 12);
  }, [filtered, nonTransfer, showTransfers]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="app-shell">
      <div className="topbar-actions">
        <button
          type="button"
          onClick={() => setTheme((t) => (t === "day" ? "night" : "day"))}
          aria-label="Toggle theme"
        >
          {theme === "day" ? "🌤️ Day" : "🌙 Night"}
        </button>
      </div>

      <h1 className="page-title">Finances Tracker</h1>
      <p className="page-subtitle">Spending insights</p>

      {error && (
        <div
          className="card"
          style={{
            background: "#fff0ec",
            borderColor: "#e1a590",
            color: "#7a3a2d",
            padding: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div className="card card-soft filters-row">
        <div>
          <label className="subtle">Start Date</label>
          <br />
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>

        <div>
          <label className="subtle">End Date</label>
          <br />
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>

        <label className="pill" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showTransfers}
            onChange={(e) => setShowTransfers(e.target.checked)}
          />
          Show transfers in table
        </label>

        <div className="subtle mono-ish right-align" style={{ marginLeft: "auto" }}>
          Filtered rows: {filtered.length}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="card" style={{ padding: 14 }}>
          <div className="kpi-label">Income</div>
          <div className="kpi-value mono-ish">{currency(summary.income)}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="kpi-label">Expenses</div>
          <div className="kpi-value mono-ish">{currency(summary.expenses)}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="kpi-label">Cashflow</div>
          <div className="kpi-value mono-ish">{currency(summary.cashflow)}</div>
        </div>
      </div>

      <div className="layout-grid-2">
        <div className="card" style={{ padding: 14 }}>
          <div className="section-title-row">
            <span className="section-icon">🍯</span>
            <h3 className="section-title">Monthly Income vs Expenses</h3>
          </div>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6cfbf" />
                <XAxis dataKey="month" stroke="#7b5e4f" />
                <YAxis stroke="#7b5e4f" />
                <Tooltip content={<CozyTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="income" name="Income" stroke="#778873" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#757d83" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="cashflow" name="Cashflow" stroke="#a1bc98" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="section-title-row">
            <span className="section-icon">🌼</span>
            <h3 className="section-title">Top Spending Categories</h3>
          </div>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={spendByCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6cfbf" />
                <XAxis dataKey="category" hide />
                <YAxis stroke="#7b5e4f" />
                <Tooltip content={<CozyTooltip />} />
                <Bar dataKey="spend" name="Spend" fill="#778873" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="layout-grid-equal">
        <div className="card" style={{ padding: 14 }}>
          <div className="section-title-row">
            <span className="section-icon">☕</span>
            <h3 className="section-title">Top Merchants</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th align="left">Merchant</th>
                  <th align="right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {topMerchants.map((r) => (
                  <tr key={r.merchant}>
                    <td>{r.merchant}</td>
                    <td align="right" className="mono-ish">
                      {currency(r.spend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="section-title-row">
            <span className="section-icon">🌿</span>
            <h3 className="section-title">Spending by Category</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th align="left">Category</th>
                  <th align="right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {spendByCategory.map((r) => (
                  <tr key={r.categoryId}>
                    <td>{r.category}</td>
                    <td align="right" className="mono-ish">
                      {currency(r.spend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="section-title-row">
          <span className="section-icon">📖</span>
          <h3 className="section-title">Recent Transactions</h3>
        </div>
        <div className="table-wrap">
          <table style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th align="left">Date</th>
                <th align="left">Account</th>
                <th align="left">Merchant</th>
                <th align="left">Description</th>
                <th align="left">Category</th>
                <th align="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((r) => {
                const catId =
                  r.subcategory_id && String(r.subcategory_id).trim()
                    ? r.subcategory_id
                    : r.category_id;

                return (
                  <tr key={r.transaction_id}>
                    <td>{r.date}</td>
                    <td>{r.account_id}</td>
                    <td>{r.merchant}</td>
                    <td>{r.description}</td>
                    <td>{labelForCategory(catId)}</td>
                    <td align="right" className="mono-ish">
                      {currency(Math.abs(r.amount))}{" "}
                      <span className="subtle">{r.amount < 0 ? "out" : "in"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}