"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Phase 5 — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md §8.
// A plain nav search box, not a live-results dropdown — keeps this phase's UI to the
// minimum the approved scope called for (one input, one results view).
export function SearchBar() {
  const [q, setQ] = useState("");
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} className="max-w-xs">
      <input
        className="input"
        placeholder="Search tasks, projects, messages…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}
