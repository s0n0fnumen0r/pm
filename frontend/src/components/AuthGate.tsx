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
      if (response.ok) {
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
    return <KanbanBoard
      onLogout={handleLogout}
      onSessionExpired={() => {
        setError("Your session has expired. Please sign in again.");
        setView("signed-out");
      }}
      loggingOut={busy}
      logoutError={error}
    />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="hud-panel w-full max-w-md p-8">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.35em] text-[var(--magenta)]">
          Access terminal <span className="text-[var(--muted)]">{"// auth required"}</span>
        </p>
        <h1 className="mt-3 font-display text-3xl font-black uppercase">
          <span className="glitch">
            Kanban Studio
            <span className="glitch-layer glitch-layer-a" aria-hidden="true">Kanban Studio</span>
            <span className="glitch-layer glitch-layer-b" aria-hidden="true">Kanban Studio</span>
          </span>
        </h1>
        <div className="mt-4 h-[2px] w-full bg-gradient-to-r from-[var(--cyan)] via-[var(--magenta)] to-transparent shadow-[var(--glow-magenta)]" />
        {view === "checking" ? (
          <p className="cursor-blink mt-6 font-mono text-sm text-[var(--cyan)]">Checking your session...</p>
        ) : view === "check-error" ? (
          <div className="mt-6 space-y-4">
            <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setView("checking");
                setAttempt((value) => value + 1);
              }}
              className="cyber-btn cyber-btn-primary"
            >
              Try again
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="mt-6 space-y-5">
            <p className="text-sm text-[var(--muted)]">Sign in to access your board.</p>
            <label className="block font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cyan)]">
              Username
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="cyber-input mt-2 px-4 py-3 font-sans normal-case tracking-normal"
              />
            </label>
            <label className="block font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--cyan)]">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="cyber-input mt-2 px-4 py-3 font-sans normal-case tracking-normal"
              />
            </label>
            {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="cyber-btn cyber-btn-primary w-full py-3"
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
};
