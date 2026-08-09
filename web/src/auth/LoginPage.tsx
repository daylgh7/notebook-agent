import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  getCapabilities,
  requestEmailChallenge,
  verifyEmailCode,
} from "../api/client";
import type { Capabilities, SessionInfo } from "../api/contracts";
import { BrandLogo } from "../app/BrandLogo";
import { useRouteNavigate } from "../app/RouteTransition";

interface LoginPageProps {
  loadCapabilities?: () => Promise<Capabilities>;
  requestChallenge?: (email: string) => Promise<{ status: "accepted" }>;
  verifyEmail?: (email: string, code: string) => Promise<SessionInfo>;
  onAuthenticated?: (session: SessionInfo) => void;
}

export function LoginPage({
  loadCapabilities = getCapabilities,
  requestChallenge = requestEmailChallenge,
  verifyEmail = verifyEmailCode,
  onAuthenticated,
}: LoginPageProps) {
  const navigate = useRouteNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: loadCapabilities,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const sendCode = useMutation({
    mutationFn: (address: string) => requestChallenge(address),
    onSuccess: () => setStep("code"),
  });
  const login = useMutation({
    mutationFn: () => verifyEmail(email, code),
    onSuccess: (session) => {
      if (onAuthenticated) onAuthenticated(session);
      else navigate("/library", { replace: true });
    },
  });

  const emailAvailable = capabilities.data?.web_login_channels.includes("email") ?? false;
  const starting = sendCode.isPending || login.isPending;

  function handleSendCode(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address || starting) return;
    setEmail(address);
    sendCode.mutate(address);
  }

  function handleLogin(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 6 || starting) return;
    login.mutate();
  }

  function backToEmail() {
    setStep("email");
    setCode("");
    sendCode.reset();
    login.reset();
  }

  return (
    <main
      className="login-page"
    >
      <div className="paper-glow" aria-hidden="true" />
      <section className="login-card" aria-labelledby="login-title">
        <a className="wordmark" href="/" aria-label="Notebook Agent 首页">
          <BrandLogo className="wordmark__sigil" />
          <span>Notebook Agent</span>
        </a>
        <p className="eyebrow">你的私人视频资料库</p>
        <h1 id="login-title">登录你的视频资料库</h1>

        {step === "email" ? (
          <div className="email-login">
            <p className="email-login__intro">
              输入邮箱地址，我们会发送一封包含验证码的邮件。
            </p>
            <form className="email-login__form" onSubmit={handleSendCode}>
              <label className="email-login__field">
                <span className="email-login__label">邮箱</span>
                <input
                  className="email-login__input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={!emailAvailable || starting}
                  placeholder="you@example.com"
                  required
                />
              </label>
              {!emailAvailable && !capabilities.isPending && !capabilities.isError ? (
                <p className="inline-error" role="alert">邮箱登录暂不可用。</p>
              ) : null}
              <button
                className="button button--primary button--wide"
                type="submit"
                disabled={!emailAvailable || starting}
              >
                {sendCode.isPending ? "正在发送…" : "发送验证码"}
              </button>
            </form>
            {sendCode.isError ? (
              <p className="inline-error" role="alert">{sendCodeErrorMessage(sendCode.error)}</p>
            ) : null}
            {capabilities.isError ? (
              <div className="login-capability-error">
                <p className="inline-error" role="alert">登录方式暂时无法加载，请检查网络后重试。</p>
                <button
                  className="login-retry-button"
                  type="button"
                  aria-label="重试"
                  onClick={() => void capabilities.refetch()}
                >
                  重新加载登录方式
                </button>
              </div>
            ) : null}
            {capabilities.isPending ? (
              <p className="login-capability-note" aria-live="polite">正在加载登录方式…</p>
            ) : null}
          </div>
        ) : (
          <div className="email-login">
            <p className="email-login__intro">
              验证码已发送到 <strong>{email}</strong>，请查收邮件并填写 6 位验证码。
            </p>
            <form className="email-login__form" onSubmit={handleLogin}>
              <label className="email-login__field">
                <span className="email-login__label">验证码</span>
                <input
                  className="email-login__input email-login__input--code"
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={starting}
                  aria-label="6 位验证码"
                  required
                />
              </label>
              {login.isError ? (
                <p className="inline-error" role="alert">{verifyErrorMessage(login.error)}</p>
              ) : null}
              <div className="email-login__actions">
                <button className="button button--primary button--wide" type="submit" disabled={starting}>
                  {login.isPending ? "正在登录…" : "登录"}
                </button>
              </div>
            </form>
            <button className="login-back-button" type="button" onClick={backToEmail}>
              ← 更换邮箱
            </button>
          </div>
        )}
        <p className="privacy-note">登录后只会显示你自己的资料库。</p>
      </section>
    </main>
  );
}

function errorCode(error: unknown): { status?: number; code?: string } {
  if (error instanceof ApiError) return { status: error.status, code: error.code };
  return {};
}

function sendCodeErrorMessage(error: unknown): string {
  const { status } = errorCode(error);
  if (status === 422) return "邮箱格式不正确，请检查后重试。";
  if (status === 503) return "暂时无法发送邮件，请稍后重试。";
  return "暂时无法开始登录，请重试。";
}

function verifyErrorMessage(error: unknown): string {
  const { status } = errorCode(error);
  if (status === 401) return "验证码错误或已过期，请重新获取。";
  return "登录没有完成，请重试。";
}
