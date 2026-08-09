import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import type { Capabilities } from "../api/contracts";
import { LoginPage } from "./LoginPage";

const capabilities: Capabilities = {
  supported_platforms: ["youtube"],
  web_login_channels: ["email"],
  save_enabled: true,
  max_save_batch_size: 10,
  transcript_pagination: true,
  archive: true,
  summary_generation: false,
  chat: false,
};

const session = {
  authenticated: true,
  login_channel: "email" as const,
  expires_at: "2026-09-07T12:00:00Z",
  tenant: { id: 1 },
};

function renderLogin(
  props: Partial<Parameters<typeof LoginPage>[0]> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LoginPage loadCapabilities={vi.fn().mockResolvedValue(capabilities)} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user };
}

async function submitEmail(
  user: ReturnType<typeof userEvent.setup>,
  address: string,
) {
  const input = await screen.findByRole("textbox", { name: "邮箱" });
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, address);
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
}

describe("login page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shows the email login form without chat channel options", async () => {
    renderLogin();

    const emailInput = await screen.findByRole("textbox", { name: "邮箱" });
    await waitFor(() => expect(emailInput).toBeEnabled());
    expect(screen.getByRole("button", { name: "发送验证码" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "登录你的视频资料库" })).toBeInTheDocument();
    expect(screen.queryByText("使用微信登录")).not.toBeInTheDocument();
    expect(screen.queryByText("使用 Telegram 登录")).not.toBeInTheDocument();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("requests a code and moves to the verification step", async () => {
    const requestChallenge = vi.fn().mockResolvedValue({ status: "accepted" });
    const { user } = renderLogin({ requestChallenge });

    await submitEmail(user, "you@example.com");

    await waitFor(() => expect(requestChallenge).toHaveBeenCalledWith("you@example.com"));
    expect(await screen.findByText(/验证码已发送到/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "6 位验证码" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "邮箱" })).not.toBeInTheDocument();
  });

  it("verifies the code and hands off the session", async () => {
    const onAuthenticated = vi.fn();
    const requestChallenge = vi.fn().mockResolvedValue({ status: "accepted" });
    const verifyEmail = vi.fn().mockResolvedValue(session);
    const { user } = renderLogin({ requestChallenge, verifyEmail, onAuthenticated });

    await submitEmail(user, "you@example.com");
    await user.type(await screen.findByRole("textbox", { name: "6 位验证码" }), "123456");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith("you@example.com", "123456"));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("lets the user switch back to the email step", async () => {
    const requestChallenge = vi.fn().mockResolvedValue({ status: "accepted" });
    const { user } = renderLogin({ requestChallenge });

    await submitEmail(user, "you@example.com");
    await user.click(await screen.findByRole("button", { name: /更换邮箱/ }));

    expect(await screen.findByRole("textbox", { name: "邮箱" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "6 位验证码" })).not.toBeInTheDocument();
  });

  it("maps a backend 422 to a format error", async () => {
    const requestChallenge = vi.fn().mockRejectedValue(new ApiError(422, "invalid_email", ""));
    const { user } = renderLogin({ requestChallenge });

    await submitEmail(user, "you@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱格式不正确");
  });

  it("maps a delivery failure to a retryable message", async () => {
    const requestChallenge = vi.fn().mockRejectedValue(
      new ApiError(503, "email_delivery_unavailable", ""),
    );
    const { user } = renderLogin({ requestChallenge });

    await submitEmail(user, "you@example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法发送邮件");
  });

  it("maps a wrong code to an expired-code message", async () => {
    const requestChallenge = vi.fn().mockResolvedValue({ status: "accepted" });
    const verifyEmail = vi.fn().mockRejectedValue(new ApiError(401, "verification_failed", ""));
    const { user } = renderLogin({ requestChallenge, verifyEmail });

    await submitEmail(user, "you@example.com");
    await user.type(await screen.findByRole("textbox", { name: "6 位验证码" }), "000000");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("验证码错误或已过期");
  });

  it("disables email login when the server does not advertise it", async () => {
    renderLogin({
      loadCapabilities: vi.fn().mockResolvedValue({ ...capabilities, web_login_channels: [] }),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱登录暂不可用");
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送验证码" })).toBeDisabled();
  });

  it("shows a retry panel when capabilities fail and recovers on retry", async () => {
    const loadCapabilities = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(capabilities);
    const { user } = renderLogin({ loadCapabilities });

    expect(await screen.findByRole("alert")).toHaveTextContent("登录方式暂时无法加载");
    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "邮箱" })).toBeEnabled());
  });

  it("shows a loading note while capabilities are pending", () => {
    renderLogin({ loadCapabilities: () => new Promise(() => undefined) });

    expect(screen.getByText("正在加载登录方式…")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeDisabled();
  });
});
