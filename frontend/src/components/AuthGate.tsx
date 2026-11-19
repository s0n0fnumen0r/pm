"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";

type View = "checking" | "check-error" | "signed-out" | "signed-in";

export const AuthGate = () => {
  const [view, setView] = useState<View>("checking");
  const [attempt, setAttempt] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const checkSession = async () => {
      try {
        const response = await fetch("/api/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          const body: { detail?: string } = await response.json();
          if (controller.signal.aborted) return;
          if (body.detail === "Session expired") {
            setError("Your session has expired. Please sign in again.");
          }
          setView("signed-out");
        } else if (response.ok) {
          setView("signed-in");
        } else {
          throw new Error(`Session check failed: ${response.status}`);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("Unable to check your session. Please try again.");
          setView("check-error");
        }
      }
    };
    void checkSession();
    return () => controller.abort();
  }, [attempt]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.status === 401) {
        setError("Invalid username or password.");
      } else if (response.ok) {
        setPassword("");
        setView("signed-in");
      } else {
        throw new Error(`Sign-in failed: ${response.status}`);
      }
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (response.status === 401) {
        setError("Your session has expired. Please sign in again.");
        setView("signed-out");
      } else if (response.ok) {
        setUsername("");
        setPassword("");
        setView("signed-out");
      } else {
        throw new Error(`Sign-out failed: ${response.status}`);
      }
    } catch {
      setError("Unable to sign out. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (view === "signed-in") {
    return <KanbanBoard onLogout={handleLogout} loggingOut={busy} logoutError={error} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-6 py-12">
      <section className="w-full max-w-md rounded-[32px] border border-[var(--stroke)] bg-white p-8 shadow-[var(--shadow)]">
        <div className="h-2 w-12 rounded-full bg-[var(--accent-yellow)]" />
        <h1 className="mt-6 font-display text-3xl font-semibold text-[var(--navy-dark)]">
          Kanban Studio
        </h1>
        {view === "checking" ? (
          <p className="mt-4 text-sm text-[var(--gray-text)]">Checking your session...</p>
        ) : view === "check-error" ? (
          <div className="mt-6 space-y-4">
            <p role="alert" className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setView("checking");
                setAttempt((value) => value + 1);
              }}
              className="rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="mt-6 space-y-5">
            <p className="text-sm text-[var(--gray-text)]">Sign in to access your board.</p>
            <label className="block text-sm font-semibold text-[var(--navy-dark)]">
              Username
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal outline-none focus:border-[var(--primary-blue)]"
              />
            </label>
            <label className="block text-sm font-semibold text-[var(--navy-dark)]">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--stroke)] px-4 py-3 font-normal outline-none focus:border-[var(--primary-blue)]"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
};
