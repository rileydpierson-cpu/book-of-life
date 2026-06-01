'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { createClient, isBrowserSupabaseConfigured } from '../../utils/supabase/client.js';

export default function LoginPage() {
  const supabase = useMemo(() => (isBrowserSupabaseConfigured() ? createClient() : null), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [status, setStatus] = useState(
    supabase ? 'Sign in to sync your cloud-hosted journal.' : 'Supabase environment variables are not configured yet.'
  );

  async function submit(event) {
    event.preventDefault();
    if (!supabase) {
      setStatus('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then redeploy.');
      return;
    }
    setStatus(mode === 'signin' ? 'Signing in...' : 'Creating account...');
    const { error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await createAccountAndSignIn(supabase, email, password);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus('Signed in. Opening your library...');
    window.location.href = '/app';
  }

  return (
    <main className="auth-page">
      <Link className="brand" href="/">Book of Life</Link>
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Cloud library</p>
        <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} required />
        </label>
        <button className="button" type="submit">{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        <button className="link-button" type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create a new account' : 'Use an existing account'}
        </button>
        <p className="status">{status}</p>
      </form>
    </main>
  );
}

async function createAccountAndSignIn(supabase, email, password) {
  const signUp = await supabase.auth.signUp({ email, password });
  if (signUp.error) return signUp;
  if (signUp.data.session) return signUp;
  return supabase.auth.signInWithPassword({ email, password });
}
