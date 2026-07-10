import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { applyEventFilters, type EventFilters } from "./view-model.js";
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
  sessionId?: string;
  evidence?: string;
  costBefore?: number;
  costAfter?: number;
};
type Overview = {
  summary: {
    before: number;
    after: number;
    measuredSaved: number;
    estimatedSaved: number;
    measuredPercent: number | null;
    eventCount: number;
    tools: Record<string, { measuredSaved: number; estimatedSaved: number; events: number }>;
  };
  daily: Array<{ day: string; measuredSaved: number; estimatedSaved: number; events: number }>;
  weekly: Array<{ week: string; measuredSaved: number; estimatedSaved: number; events: number }>;
  costs: { costBefore: number; costAfter: number; saved: number };
  overlaps: Array<{ overlapKey: string; tools: string[]; depths: number[] }>;
  privacy: { storesPrompts: boolean; storesOutputs: boolean; note: string };
  activeTools: Array<{ agent: string; tool: string; mode: string }>;
  projects: Array<{ alias?: string | null; path?: string }>;
  sessions: Array<{ id: string; agent: string | null; projectPath: string | null }>;
};
type ToolsPayload = {
  tools: Record<string, { repository: string; install: string; requires: string[] }>;
  agents: Array<{ id: string; label: string }>;
  capabilities: Array<{ tool: string; agent: string; installMethod: string; supportsMetrics: string }>;
};
type ConfigPayload = {
  profile: string;
  updateChannel: string;
  integrations: Record<string, Record<string, { enabled: boolean; mode: string }>>;
  projects: Array<{ alias: string; path?: string }>;
};
type HealthPayload = {
  tools: Array<{
    tool: string;
    status?: string;
    reason?: string;
    detection: { detected: boolean; version?: string; path?: string };
    checks: Array<{ id: string; status: string; message: string }>;
  }>;
};

/** Lazy + code-split Recharts so the initial SPA payload stays chart-free until Overview needs it. */
const SavingsChart = lazy(async () => {
  const recharts = await import("recharts");
  const { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } = recharts;
  return {
    default: function Chart({ data }: { data: Array<{ tool: string; measured: number; estimated: number }> }) {
      return <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#253830" />
          <XAxis dataKey="tool" stroke="#9cb5a7" />
          <YAxis stroke="#9cb5a7" />
          <Tooltip />
          <Bar dataKey="measured" fill="#b7e657" name="Measured" />
          <Bar dataKey="estimated" fill="#6db6a5" name="Estimated" />
        </BarChart>
      </ResponsiveContainer>;
    },
  };
});

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
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
  const [tools, setTools] = useState<ToolsPayload>();
  const [config, setConfig] = useState<ConfigPayload>();
  const [health, setHealth] = useState<HealthPayload>();
  const [filters, setFilters] = useState<EventFilters>({ confidence: "all", tool: "all", project: "", session: "all" });
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.all([api<Overview>("/api/overview"), api<{ events: Event[] }>("/api/events?limit=500")])
      .then(([nextOverview, nextEvents]) => { setOverview(nextOverview); setEvents(nextEvents.events); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load dashboard data"));
  }, []);

  useEffect(() => {
    if (tab === "Tools") void api<ToolsPayload>("/api/tools").then(setTools).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load tools"));
    if (tab === "Configuration") void api<ConfigPayload>("/api/config").then(setConfig).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load config"));
    if (tab === "Diagnostics") void api<HealthPayload>("/api/health").then(setHealth).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load diagnostics"));
  }, [tab]);

  const chart = useMemo(() => Object.entries(overview?.summary.tools ?? {}).map(([tool, values]) => ({ tool, measured: values.measuredSaved, estimated: values.estimatedSaved })), [overview]);
  const filteredEvents = useMemo(() => applyEventFilters(events, filters), [events, filters]);
  const toolOptions = useMemo(() => [...new Set(events.map((event) => event.tool))].sort(), [events]);
  const sessionOptions = useMemo(() => [...new Set(events.map((event) => event.sessionId).filter((id): id is string => Boolean(id)))].sort(), [events]);
  const projectRows = useMemo(() => {
    const grouped = new Map<string, { events: number; measured: number; estimated: number; cost: number }>();
    for (const event of events) {
      const key = event.projectPath ?? "Unattributed local activity";
      const value = grouped.get(key) ?? { events: 0, measured: 0, estimated: 0, cost: 0 };
      value.events += 1;
      if (event.confidence === "measured") value.measured += event.tokensSaved ?? 0;
      if (event.confidence === "estimated") value.estimated += event.tokensSaved ?? 0;
      if (typeof event.costBefore === "number" && typeof event.costAfter === "number") value.cost += event.costBefore - event.costAfter;
      grouped.set(key, value);
    }
    return [...grouped.entries()];
  }, [events]);

  if (error) {
    return <main className="shell">
      <h1>Don’t Waste</h1>
      <p className="error">{error}</p>
      <p>Run <code>dont-waste collect</code> and reload.</p>
    </main>;
  }
  if (!overview) return <main className="shell"><h1>Don’t Waste</h1><p>Reading local metrics…</p></main>;

  return <main className="shell">
    <header>
      <div><p className="eyebrow">LOCAL-ONLY TOKEN ORCHESTRATOR</p><h1>Don’t Waste</h1></div>
      <p className="privacy">{overview.privacy.note}</p>
    </header>
    <nav aria-label="Dashboard pages">{tabs.map((item) => <button className={item === tab ? "selected" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>

    {tab === "Overview" && <>
      <section className="cards">
        <Card label="Measured tokens saved" value={format.format(overview.summary.measuredSaved)} note="Only non-overlapping observations" />
        <Card label="Observed reduction" value={overview.summary.measuredPercent === null ? "—" : `${overview.summary.measuredPercent.toFixed(1)}%`} note={`${format.format(overview.summary.before)} before → ${format.format(overview.summary.after)} after`} />
        <Card label="Estimated output savings" value={format.format(overview.summary.estimatedSaved)} note="Visible separately; excluded from total" subdued />
        <Card label="Cost delta (when reported)" value={money.format(overview.costs.saved)} note={`${money.format(overview.costs.costBefore)} → ${money.format(overview.costs.costAfter)}`} subdued />
      </section>
      <section className="panel">
        <h2>Measured and estimated savings by tool</h2>
        <p>Estimates never inflate the measured total. Chart loads via code-split Recharts.</p>
        <div className="chart">
          {chart.length ? <Suspense fallback={<p>Loading chart…</p>}><SavingsChart data={chart} /></Suspense> : <Empty text="No tool metrics yet. Run dont-waste collect." />}
        </div>
      </section>
      <section className="panel">
        <h2>Daily totals</h2>
        {overview.daily.length ? <table><thead><tr><th>Day</th><th>Measured</th><th>Estimated</th><th>Events</th></tr></thead><tbody>{overview.daily.map((row) => <tr key={row.day}><td>{row.day}</td><td>{format.format(row.measuredSaved)}</td><td>{format.format(row.estimatedSaved)}</td><td>{row.events}</td></tr>)}</tbody></table> : <Empty text="No daily metrics yet." />}
      </section>
      <section className="panel">
        <h2>Weekly totals</h2>
        {overview.weekly.length ? <table><thead><tr><th>Week</th><th>Measured</th><th>Estimated</th><th>Events</th></tr></thead><tbody>{overview.weekly.map((row) => <tr key={row.week}><td>{row.week}</td><td>{format.format(row.measuredSaved)}</td><td>{format.format(row.estimatedSaved)}</td><td>{row.events}</td></tr>)}</tbody></table> : <Empty text="No weekly metrics yet." />}
      </section>
      {overview.overlaps.length > 0 && <section className="panel">
        <h2>Overlap groups</h2>
        <p>Multiple measured sources share a flow; only the shallowest depth counts toward measured totals.</p>
        <table><thead><tr><th>Key</th><th>Tools</th><th>Depths</th></tr></thead><tbody>{overview.overlaps.map((row) => <tr key={row.overlapKey}><td>{row.overlapKey}</td><td>{row.tools.join(", ")}</td><td>{row.depths.join(", ")}</td></tr>)}</tbody></table>
      </section>}
      <section className="panel"><h2>Active integrations</h2>{overview.activeTools.length ? <div className="chips">{overview.activeTools.map((item) => <span key={`${item.agent}-${item.tool}`}>{item.agent} · {item.tool} · {item.mode}</span>)}</div> : <Empty text="No validated integrations are active yet. Run dont-waste init." />}</section>
      <section className="panel">
        <h2>Privacy</h2>
        <p>Prompts stored: <strong>{overview.privacy.storesPrompts ? "yes" : "no"}</strong> · Outputs stored: <strong>{overview.privacy.storesOutputs ? "yes" : "no"}</strong></p>
      </section>
    </>}

    {(tab === "Timeline" || tab === "Context") && <>
      <FilterBar
        filters={filters}
        tools={toolOptions}
        sessions={sessionOptions}
        onChange={setFilters}
      />
      <EventTable events={filteredEvents} compact={tab === "Timeline"} />
    </>}

    {tab === "Projects" && <>
      <section className="panel">
        <h2>Local projects</h2>
        {projectRows.length ? <table><thead><tr><th>Project</th><th>Events</th><th>Measured</th><th>Estimated</th><th>Cost saved</th></tr></thead><tbody>{projectRows.map(([name, value]) => <tr key={name}><td>{name}</td><td>{value.events}</td><td>{format.format(value.measured)}</td><td>{format.format(value.estimated)}</td><td>{money.format(value.cost)}</td></tr>)}</tbody></table> : <Empty text="No project attribution was provided by imported metrics." />}
      </section>
      <section className="panel">
        <h2>Registered projects</h2>
        {overview.projects.length ? <ul>{overview.projects.map((project, index) => <li key={`${project.alias ?? "p"}-${index}`}>{project.alias ?? "Local project"}{project.path ? ` · ${project.path}` : ""}</li>)}</ul> : <Empty text="No projects registered in config or telemetry." />}
      </section>
      <section className="panel">
        <h2>Recent sessions</h2>
        {overview.sessions.length ? <table><thead><tr><th>Session</th><th>Agent</th><th>Project</th></tr></thead><tbody>{overview.sessions.map((session) => <tr key={session.id}><td>{session.id}</td><td>{session.agent ?? "—"}</td><td>{session.projectPath ?? "—"}</td></tr>)}</tbody></table> : <Empty text="No sessions recorded yet." />}
      </section>
    </>}

    {tab === "Tools" && <ToolsPanel data={tools} />}
    {tab === "Configuration" && <ConfigPanel data={config} />}
    {tab === "Diagnostics" && <DiagnosticsPanel data={health} />}
  </main>;
}

function FilterBar({ filters, tools, sessions, onChange }: {
  filters: EventFilters;
  tools: string[];
  sessions: string[];
  onChange: (next: EventFilters) => void;
}) {
  return <section className="panel filters">
    <h2>Filters</h2>
    <p>measured / estimated / unavailable · tool · project · session</p>
    <div className="chips">
      {(["all", "measured", "estimated", "unavailable"] as const).map((value) => (
        <button key={value} className={filters.confidence === value ? "selected" : ""} onClick={() => onChange({ ...filters, confidence: value })}>{value}</button>
      ))}
    </div>
    <div className="filter-row">
      <label>Tool
        <select value={filters.tool} onChange={(event) => onChange({ ...filters, tool: event.target.value })}>
          <option value="all">all</option>
          {tools.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
        </select>
      </label>
      <label>Project contains
        <input value={filters.project} placeholder="path fragment" onChange={(event) => onChange({ ...filters, project: event.target.value })} />
      </label>
      <label>Session
        <select value={filters.session} onChange={(event) => onChange({ ...filters, session: event.target.value })}>
          <option value="all">all</option>
          {sessions.map((session) => <option key={session} value={session}>{session}</option>)}
        </select>
      </label>
    </div>
  </section>;
}

function Card({ label, value, note, subdued = false }: { label: string; value: string; note: string; subdued?: boolean }) {
  return <article className={`card ${subdued ? "subdued" : ""}`}><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}
function Empty({ text }: { text: string }) { return <p className="empty">{text}</p>; }
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }

function ToolsPanel({ data }: { data: ToolsPayload | undefined }) {
  if (!data) return <Panel title="Tools"><p>Loading…</p></Panel>;
  return <Panel title="Tool capabilities and measurement limits">
    <table>
      <thead><tr><th>Tool</th><th>Install</th><th>Requires</th><th>Metric support</th></tr></thead>
      <tbody>
        {Object.entries(data.tools).map(([id, meta]) => {
          const supports = [...new Set(data.capabilities.filter((item) => item.tool === id).map((item) => item.supportsMetrics))].join(", ");
          return <tr key={id}><td>{id}</td><td>{meta.install}</td><td>{meta.requires.join(", ") || "—"}</td><td>{supports || "—"}</td></tr>;
        })}
      </tbody>
    </table>
  </Panel>;
}

function ConfigPanel({ data }: { data: ConfigPayload | undefined }) {
  if (!data) return <Panel title="Configuration"><p>Loading…</p></Panel>;
  const rows = Object.entries(data.integrations).flatMap(([agent, tools]) => Object.entries(tools).filter(([, setting]) => setting.enabled).map(([tool, setting]) => ({ agent, tool, mode: setting.mode })));
  return <>
    <Panel title="Managed configuration">
      <p>Profile: <strong>{data.profile}</strong> · Update channel: <strong>{data.updateChannel}</strong></p>
      {rows.length ? <table><thead><tr><th>Agent</th><th>Tool</th><th>Mode</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.agent}-${row.tool}`}><td>{row.agent}</td><td>{row.tool}</td><td>{row.mode}</td></tr>)}</tbody></table> : <Empty text="No integrations enabled." />}
    </Panel>
    <Panel title="Projects">
      {data.projects.length ? <ul>{data.projects.map((project) => <li key={project.alias}>{project.alias}{project.path ? ` · ${project.path}` : ""}</li>)}</ul> : <Empty text="No projects registered." />}
    </Panel>
  </>;
}

function DiagnosticsPanel({ data }: { data: HealthPayload | undefined }) {
  if (!data) return <Panel title="Diagnostics"><p>Loading…</p></Panel>;
  if (!data.tools.length) return <Panel title="Diagnostics"><Empty text="No health checks available." /></Panel>;
  return <Panel title="Current local health checks">
    {data.tools.map((tool) => <article key={tool.tool} className="diag">
      <h3>{tool.tool} <small>{tool.status ?? (tool.detection.detected ? (tool.detection.version ?? "detected") : "missing")}{tool.reason ? ` · ${tool.reason}` : ""}</small></h3>
      {tool.checks.length
        ? <ul>{tool.checks.map((check) => <li key={check.id}><span className={`confidence ${check.status === "pass" ? "measured" : check.status === "warn" ? "estimated" : "unavailable"}`}>{check.status}</span> {check.message}</li>)}</ul>
        : <p className="empty">No checks for this tool in the current config.</p>}
    </article>)}
  </Panel>;
}

function EventTable({ events, compact = false }: { events: Event[]; compact?: boolean }) {
  return <section className="panel">
    <h2>{compact ? "Recent observed activity" : "Context transformations"}</h2>
    <p>{compact ? "Most recent imported metrics." : "Metrics only: no tool output or prompt contents are stored."}</p>
    {events.length
      ? <table>
        <thead><tr><th>When</th><th>Tool</th><th>Type</th><th>Before</th><th>After</th><th>Saved</th><th>Confidence</th>{!compact && <th>Evidence</th>}</tr></thead>
        <tbody>{events.slice(0, compact ? 30 : 100).map((event) => <tr key={event.id}>
          <td>{new Date(event.occurredAt).toLocaleString()}</td>
          <td>{event.tool}</td>
          <td>{event.metricType}</td>
          <td>{event.tokensBefore === null ? "—" : format.format(event.tokensBefore)}</td>
          <td>{event.tokensAfter === null ? "—" : format.format(event.tokensAfter)}</td>
          <td>{event.tokensSaved === null ? "—" : format.format(event.tokensSaved)}</td>
          <td><span className={`confidence ${event.confidence}`}>{event.confidence}</span></td>
          {!compact && <td>{event.evidence ?? "—"}</td>}
        </tr>)}</tbody>
      </table>
      : <Empty text="No metrics match the current filters (or none imported yet)." />}
  </section>;
}

createRoot(document.getElementById("root")!).render(<App />);
