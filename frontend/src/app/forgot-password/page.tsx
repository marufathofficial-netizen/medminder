'use client';

import { useState, type FormEvent } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Status = 'idle' | 'loading' | 'done' | 'error';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = Array.isArray(data.message)
          ? data.message.map((m: { message: string }) => m.message).join(' ')
          : data.message;
        throw new Error(msg || 'Request failed. Please try again.');
      }
      setMessage(
        data.message ??
          'If an account with that email exists, a password reset link has been sent.',
      );
      setStatus('done');
    } catch (err) {
      setMessage(
        err instanceof TypeError
          ? 'Cannot reach the server. Please check your connection and try again.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
      );
      setStatus('error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Forgot your password?</h1>
      <p className="text-lg">
        Enter your email address and we will send you a link to choose a new
        password.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label htmlFor="email" className="text-lg font-medium">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border-2 border-gray-500 bg-white p-3 text-lg text-gray-900 focus:outline-none focus:ring-4 focus:ring-blue-400 dark:border-gray-400 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-lg bg-blue-700 p-3 text-lg font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-400 disabled:opacity-60"
        >
          {status === 'loading' ? 'Sending...' : 'Send reset link'}
        </button>
      </form>

      {message && (
        <p
          role="status"
          className={`text-lg ${
            status === 'error'
              ? 'text-red-700 dark:text-red-300'
              : 'text-green-800 dark:text-green-300'
          }`}
        >
          {message}
        </p>
      )}
    </main>
  );
}