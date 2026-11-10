"use client";

import { useEffect, useState } from "react";

type Check = { label: string; ok: boolean; detail: string };
type Health = { api: string; database: string; jobs: number };

export default function Home() {
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    // One call, through the /api rewrite in next.config.ts. If it comes back,
    // then the web app, the API and the database are all up.
    fetch("/api/health")
      .then(async (res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const health = (await res.json()) as Health;
        const dbOk = health.database === "ok";
        setChecks([
          { label: "Web app", ok: true, detail: "localhost:3000" },
          { label: "API", ok: true, detail: "localhost:8000" },
          {
            label: "Database",
            ok: dbOk,
            detail: dbOk ? `${health.jobs} jobs seeded` : "unreachable",
          },
        ]);
      })
      .catch((err: Error) => {
        setChecks([
          { label: "Web app", ok: true, detail: "localhost:3000" },
          { label: "API", ok: false, detail: err.message },
          { label: "Database", ok: false, detail: "not reached" },
        ]);
      });
  }, []);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "72px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
        Technical Check-in
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 8 }}>
        Nothing is built yet. That part is yours. This page only confirms the
        three pieces are running.
      </p>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 32 }}>
        {checks === null ? (
          <li style={{ color: "var(--muted)" }}>Checking…</li>
        ) : (
          checks.map((c) => (
            <li
              key={c.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                padding: "12px 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span>
                <span
                  style={{
                    color: c.ok ? "var(--ok)" : "var(--bad)",
                    marginRight: 10,
                  }}
                >
                  {c.ok ? "●" : "○"}
                </span>
                {c.label}
              </span>
              <span style={{ color: "var(--muted)" }}>{c.detail}</span>
            </li>
          ))
        )}
      </ul>

      <p style={{ color: "var(--muted)", marginTop: 32, fontSize: 14 }}>
        Read <code>README.md</code> for the task.
      </p>
    </main>
  );
}
