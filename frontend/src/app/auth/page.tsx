"use client";

import { FormEvent, useState } from "react";
import {
  Activity,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  UserRound,
} from "lucide-react";
import { loginUser, registerUser } from "@/lib/api";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const result =
        mode === "login"
          ? await loginUser(email, password)
          : await registerUser(email, password, name);

      localStorage.setItem("medfield_token", result.accessToken);

      window.location.href = "/";
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07111f] text-white">
      <div className="absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 py-12">
        <section className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/40 backdrop-blur-xl md:grid-cols-2">
          <div className="relative hidden min-h-[650px] overflow-hidden p-10 md:flex md:flex-col md:justify-between">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-blue-600/10" />

            <div className="relative">
              <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                <Activity className="h-6 w-6 text-cyan-300" />
              </div>

              <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
                MedField
              </p>

              <h1 className="max-w-md text-5xl font-semibold leading-tight tracking-tight">
                Smarter medication care.
              </h1>

              <p className="mt-6 max-w-md text-base leading-7 text-slate-300">
                Keep medication schedules organized, monitor doses, and
                coordinate care from one secure medical workspace.
              </p>
            </div>

            <div className="relative grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
                <p className="text-2xl font-semibold">24/7</p>
                <p className="mt-1 text-sm text-slate-400">
                  Medication awareness
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
                <p className="text-2xl font-semibold">Secure</p>
                <p className="mt-1 text-sm text-slate-400">
                  Patient-focused access
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-[650px] flex-col justify-center p-7 sm:p-10">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-8 md:hidden">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/10">
                  <Activity className="h-6 w-6 text-cyan-300" />
                </div>

                <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-300">
                  MedField
                </p>
              </div>

              <div className="mb-8">
                <h2 className="text-3xl font-semibold tracking-tight">
                  {mode === "login" ? "Welcome back" : "Create your account"}
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {mode === "login"
                    ? "Sign in to continue to your medical workspace."
                    : "Create a secure account to start managing medication care."}
                </p>
              </div>

              <div className="mb-7 grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                  className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                    mode === "login"
                      ? "bg-white text-slate-900"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Sign in
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                  className={`rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                    mode === "register"
                      ? "bg-white text-slate-900"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Register
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {mode === "register" && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-200">
                      Full name
                    </label>

                    <div className="relative">
                      <UserRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                        autoComplete="name"
                        placeholder="Your name"
                        className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-12 pr-4 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 focus:bg-white/[0.06]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Email
                  </label>

                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-12 pr-4 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 focus:bg-white/[0.06]"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">
                    Password
                  </label>

                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />

                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      placeholder="••••••••"
                      className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-12 pr-12 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 focus:bg-white/[0.06]"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 transition hover:text-white"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? "Please wait..."
                    : mode === "login"
                      ? "Sign in"
                      : "Create account"}

                  {!loading && (
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  )}
                </button>
              </form>

              <p className="mt-7 text-center text-xs leading-5 text-slate-500">
                MedField is designed for medication management and care
                coordination. It does not replace professional medical advice.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
