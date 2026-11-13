"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

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
    <main className="mx-auto max-w-[560px] px-6 py-18">
      <h1 className="text-xl font-semibold">Technical Check-in</h1>
      <p className="mt-2 text-muted-foreground">
        Nothing is built yet. That part is yours. This page only confirms the
        three pieces are running.
      </p>

      <ul className="mt-8">
        {checks === null ? (
          <li className="text-muted-foreground">Checking…</li>
        ) : (
          checks.map((c) => (
            <li
              key={c.label}
              className="flex justify-between gap-4 border-b border-border py-3"
            >
              <span>
                <span
                  className={cn(
                    "mr-2.5",
                    c.ok
                      ? "text-green-700 dark:text-green-500"
                      : "text-destructive",
                  )}
                >
                  {c.ok ? "●" : "○"}
                </span>
                {c.label}
              </span>
              <span className="text-muted-foreground">{c.detail}</span>
            </li>
          ))
        )}
      </ul>

      <p className="mt-8 text-sm text-muted-foreground">
        Read <code>README.md</code> for the task.
      </p>
    </main>
  );
}
