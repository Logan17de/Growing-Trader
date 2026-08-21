"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BrandMark, Icon } from "@/components/terminal/Icon";
import { jsonRequest } from "@/lib/controlClient";

type Challenge = {
  challengeId: string;
  maskedEmail: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export function DashboardOtpGate({ children }: { children: ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | "">("");
  const [notice, setNotice] = useState("");
  const autoSent = useRef(false);

  const sendCode = useCallback(async () => {
    setBusy("send");
    setNotice("");
    try {
      const result = await jsonRequest<Challenge & { ok: true }>("/api/auth/code", { method: "POST" });
      setChallenge(result);
      setCode("");
      setNotice(`A 6-digit access code was sent to ${result.maskedEmail}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not send access code");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void jsonRequest<{ authenticated: boolean }>("/api/auth/status")
      .then((result) => {
        if (result.authenticated) {
          setAuthorized(true);
          autoSent.current = false;
          return;
        }
        setAuthorized(false);
        if (!autoSent.current) {
          autoSent.current = true;
          void sendCode();
        }
      })
      .catch(() => {
        setAuthorized(false);
        if (!autoSent.current) {
          autoSent.current = true;
          void sendCode();
        }
      });
  }, [sendCode]);

  useEffect(() => {
    const requireAuth = () => {
      setAuthorized(false);
      setChallenge(null);
      setCode("");
      setNotice("");
      if (!autoSent.current) {
        autoSent.current = true;
        void sendCode();
      }
    };
    window.addEventListener("growing-trader-auth-required", requireAuth);
    return () => window.removeEventListener("growing-trader-auth-required", requireAuth);
  }, [sendCode]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy("verify");
    setNotice("");
    try {
      await jsonRequest("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      setCode("");
      setChallenge(null);
      autoSent.current = false;
      setAuthorized(true);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Code verification failed");
    } finally {
      setBusy("");
    }
  }

  async function resend() {
    autoSent.current = true;
    await sendCode();
  }

  if (authorized === true) return <>{children}</>;

  if (authorized === null) {
    return <main className="center-shell"><div className="loading-panel" role="status" aria-live="polite"><BrandMark large /><div><p className="eyebrow">Growing Trader</p><h1>Opening your terminal</h1><p className="muted">Checking your secure dashboard session…</p></div><div className="loading-track" aria-hidden="true"><span /></div></div></main>;
  }

  return <main className="center-shell"><section className="login-shell"><div className="login-context"><div className="brand-lockup"><BrandMark /><span>Growing Trader</span></div><div className="login-copy"><p className="eyebrow">Private operations workspace</p><h1>Read the market.<br /><span>Control the risk.</span></h1><p>Your Groww credentials stay encrypted and the trading system can run autonomously without asking you to enter them again.</p></div><div className="login-network" aria-label="System architecture"><span><Icon name="layers" />Vercel</span><i /><span><Icon name="database" />Supabase</span><i /><span><Icon name="server" />Oracle</span></div><p className="paper-note"><span className="status-dot amber" /> PAPER is the autonomous default</p></div><form className="login-card" onSubmit={verify}><div className="login-card-icon"><Icon name="lock" /></div><p className="eyebrow">Email verification</p><h2>Enter your access code</h2><p className="muted">{challenge ? `We sent a one-time code to ${challenge.maskedEmail}.` : busy === "send" ? "Sending a one-time code to your configured email…" : "We could not send a code yet. Try again below."}</p>{challenge && <label className="field login-field"><span>6-digit access code</span><div className="input-wrap"><Icon name="key" /><input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" placeholder="000000" required autoFocus /></div></label>}{challenge ? <button className="primary button-wide" disabled={busy === "verify" || code.length !== 6}>{busy === "verify" ? <><Icon name="refresh" className="spin" />Verifying…</> : <>Open terminal<Icon name="arrow-right" /></>}</button> : <button className="primary button-wide" type="button" disabled={busy === "send"} onClick={() => void resend()}>{busy === "send" ? <><Icon name="refresh" className="spin" />Sending code…</> : <>Send access code<Icon name="arrow-right" /></>}</button>}{challenge && <button className="ghost button-wide" type="button" disabled={Boolean(busy)} onClick={() => void resend()}><Icon name="refresh" />Resend code</button>}{notice && <p className={notice.toLowerCase().includes("sent to") ? "notice" : "notice error"} role="status">{notice}</p>}<div className="security-note"><Icon name="shield" /><span>The code expires in 10 minutes, allows 5 attempts, and the browser receives only a secure HttpOnly session after verification.</span></div></form></section></main>;
}
