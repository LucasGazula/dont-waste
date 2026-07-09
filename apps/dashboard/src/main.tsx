import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./style.css";

type Confidence = "measured" | "estimated" | "unavailable";
type Event = {
  id: string;
  occurredAt: string;
  tool: string;
  metricType: string;
  tokensBefore: number | null;
  tokensAfter: number | null;
  tokensSaved: number | null;
  confidence: Confidence;
  projectPath?: string;
  evidence?: string;
};
type Overview = {
  summary: { before: number; after: number; measuredSaved: number; estimatedSaved: number; measuredPercent: number | null; eventCount: number; tools: Record<string, { measuredSaved: number; estimatedSaved: number; events: number }> };
  activeTools: Array<{ agent: string; tool: string; mode: string }>;
};

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const tabs = ["Overview", "Timeline", "Projects", "Tools", "Context", "Configuration", "Diagnostics"] as const;
type Tab = (typeof tabs)[number];

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function App() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [overview, setOverview] = useState<Overview>();
  const [events, setEvents] = useState<Event[]>([]);
  const [extra, setExtra] = useState<unknown>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.all([api<Overview>("/api/overview"), api<{ events: Event[] }>("/api/events?limit=500")])
      .then(([nextOverview, nextEvents]) => { setOverview(nextOverview); setEvents(nextEvents.events); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load dashboard data"));
  }, []);

  useEffect(() => {
    const endpoints: Partial<Record<Tab, string>> = {
      Configuration: "/api/config",
      Diagnostics: "/api/health",
      Tools: "/api/tools",
    };
    const endpoint = endpoints[tab];
    if (endpoint) void api(endpoint).then(setExtra).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load page"));
  }, [tab]);

  const chart = useMemo(() => Object.entries(overview?.summary.tools ?? {}).map(([tool, values]) => ({ tool, measured: values.measuredSaved, estimated: values.estimatedSaved })), [overview]);
  const projects = useMemo(() => {
    const grouped = new Map<string, { events: number; measured: number; estimated: number }>();
    for (const event of events) {
      const key = event.projectPath ?? "Unattributed local activity";
      const value = grouped.get(key) ?? { events: 0, measured: 0, estimated: 0 };
      value.events += 1;
      if (event.confidence === "measured") value.measured += event.tokensSaved ?? 0;
      if (event.confidence === "estimated") value.estimated += event.tokensSaved ?? 0;
      grouped.set(key, value);
    }
    return [...grouped.entries()];
  }, [events]);

  if (error) return <main className="shell"><h1>Don’t Waste</h1><p className="error">{error}</p><p>Run <code>dont-waste collect</code> and reload.</p></main>;
  if (!overview) return <main className="shell"><h1>Don’t Waste</h1><p>Reading local metrics…</p></main>;

  return <main className="shell">
    <header><div><p className="eyebrow">LOCAL-ONLY TOKEN ORCHESTRATOR</p><h1>Don’t Waste</h1></div><p className="privacy">No account · no conversation content</p></header>
    <nav aria-label="Dashboard pages">{tabs.map((item) => <button className={item === tab ? "selected" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "Overview" && <>
      <section className="cards">
        <Card label="Measured tokens saved" value={format.format(overview.summary.measuredSaved)} note="Only non-overlapping observations" />
        <Card label="Observed reduction" value={overview.summary.measuredPercent === null ? "—" : `${overview.summary.measuredPercent.toFixed(1)}%`} note={`${format.format(overview.summary.before)} before → ${format.format(overview.summary.after)} after`} />
        <Card label="Estimated output savings" value={format.format(overview.summary.estimatedSaved)} note="Visible separately; excluded from total" subdued />
        <Card label="Observed flows" value={format.format(overview.summary.eventCount)} note="Measured transformations after de-duplication" />
      </section>
      <section className="panel"><h2>Measured and estimated savings by tool</h2><p>Estimates never inflate the measured total.</p><div className="chart"><ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#253830" /><XAxis dataKey="tool" stroke="#9cb5a7" /><YAxis stroke="#9cb5a7" /><Tooltip /><Bar dataKey="measured" fill="#b7e657" name="Measured" /><Bar dataKey="estimated" fill="#6db6a5" name="Estimated" /></BarChart></ResponsiveContainer></div></section>
      <section className="panel"><h2>Active integrations</h2>{overview.activeTools.length ? <div className="chips">{overview.activeTools.map((item) => <span key={`${item.agent}-${item.tool}`}>{item.agent} · {item.tool} · {item.mode}</span>)}</div> : <Empty text="No validated integrations are active yet. Run dont-waste init." />}</section>
    </>}
    {tab === "Timeline" && <EventTable events={events} compact />}
    {tab === "Projects" && <section className="panel"><h2>Local projects</h2>{projects.length ? <table><thead><tr><th>Project</th><th>Events</th><th>Measured</th><th>Estimated</th></tr></thead><tbody>{projects.map(([name, value]) => <tr key={name}><td>{name}</td><td>{value.events}</td><td>{format.format(value.measured)}</td><td>{format.format(value.estimated)}</td></tr>)}</tbody></table> : <Empty text="No project attribution was provided by imported metrics." />}</section>}
    {tab === "Tools" && <JsonPanel title="Tool capabilities and measurement limits" value={extra} />}
    {tab === "Context" && <EventTable events={events} />}
    {tab === "Configuration" && <JsonPanel title="Managed configuration" value={extra} />}
    {tab === "Diagnostics" && <JsonPanel title="Current local health checks" value={extra} />}
  </main>;
}

function Card({ label, value, note, subdued = false }: { label: string; value: string; note: string; subdued?: boolean }) { return <article className={`card ${subdued ? "subdued" : ""}`}><p>{label}</p><strong>{value}</strong><small>{note}</small></article>; }
function Empty({ text }: { text: string }) { return <p className="empty">{text}</p>; }
function JsonPanel({ title, value }: { title: string; value: unknown }) { return <section className="panel"><h2>{title}</h2>{value ? <pre>{JSON.stringify(value, null, 2)}</pre> : <p>Loading…</p>}</section>; }
function EventTable({ events, compact = false }: { events: Event[]; compact?: boolean }) { return <section className="panel"><h2>{compact ? "Recent observed activity" : "Context transformations"}</h2><p>{compact ? "Most recent imported metrics." : "Metrics only: no tool output or prompt contents are stored."}</p>{events.length ? <table><thead><tr><th>When</th><th>Tool</th><th>Type</th><th>Before</th><th>After</th><th>Saved</th><th>Confidence</th>{!compact && <th>Evidence</th>}</tr></thead><tbody>{events.slice(0, compact ? 30 : 100).map((event) => <tr key={event.id}><td>{new Date(event.occurredAt).toLocaleString()}</td><td>{event.tool}</td><td>{event.metricType}</td><td>{event.tokensBefore === null ? "—" : format.format(event.tokensBefore)}</td><td>{event.tokensAfter === null ? "—" : format.format(event.tokensAfter)}</td><td>{event.tokensSaved === null ? "—" : format.format(event.tokensSaved)}</td><td><span className={`confidence ${event.confidence}`}>{event.confidence}</span></td>{!compact && <td>{event.evidence ?? "—"}</td>}</tr>)}</tbody></table> : <Empty text="No metrics have been imported yet." />}</section>; }

createRoot(document.getElementById("root")!).render(<App />);
