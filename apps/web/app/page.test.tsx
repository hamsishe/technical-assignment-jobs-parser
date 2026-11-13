import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import Home from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the database as up when the API reports it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ api: "ok", database: "ok", jobs: 3 })),
    ),
  );

  render(<Home />);

  expect(await screen.findByText("3 jobs seeded")).toBeInTheDocument();
});

test("shows the API as down when the request fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 502 })));

  render(<Home />);

  expect(await screen.findByText("API returned 502")).toBeInTheDocument();
});
