'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setMessage('The two passwords do not match.');
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = Array.isArray(data.message)
          ? data.message.map((m: { message: string }) => m.message).join(' ')
          : data.message;
        throw new Error(msg || 'Request failed');
      }
      setMessage(data.message);
      setStatus('done');
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
      setStatus('error');
    }
  }

  if (!token) {
    return (
      <p className="text-lg text-red-700">
        This link is missing its reset token. Please request a new link.
      </p>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label htmlFor="password" className="text-lg font-medium">
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border-2 border-gray-400 p-3 text-lg"
        />
        <label htmlFor="confirm" className="text-lg font-medium">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded-lg border-2 border-gray-400 p-3 text-lg"
        />
        <p className="text-base text-gray-700">
          Use 8 to 72 characters, with at least one letter and one number.
        </p>
        <button
          type="submit"
          disabled={status === 'loading' || status === 'done'}
          className="rounded-lg bg-blue-700 p-3 text-lg font-semibold text-white disabled:opacity-60"
        >
          {status === 'loading' ? 'Saving...' : 'Reset password'}
        </button>
      </form>

      {message && (
        <p
          role="status"
          className={`text-lg ${status === 'error' ? 'text-red-700' : 'text-green-800'}`}
        >
          {message}
        </p>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-3xl font-bold">Choose a new password</h1>
      <Suspense fallback={<p className="text-lg">Loading...</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
