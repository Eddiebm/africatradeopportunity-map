import { redirect } from "next/navigation";
import { getHeaderUser, getSessionUser, isAdminEmail } from "../lib/session";
import type { TradeUser } from "../lib/user";

export type ChatGPTUser = TradeUser;

const SIGN_IN_PATH = "/signin";
const SIGN_OUT_PATH = "/signout";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return (await getSessionUser()) ?? (await getHeaderUser());
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export async function requireAdmin(returnTo = "/admin"): Promise<ChatGPTUser> {
  const user = await requireChatGPTUser(returnTo);
  const role = "role" in user ? user.role : undefined;
  if (role === "admin" || isAdminEmail(user.email)) return user;
  redirect("/");
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    if (url.origin !== "https://app.local") return "/";
    if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_OUT_PATH || url.pathname === "/signin-with-chatgpt") {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
