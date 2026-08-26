"use client";
import type { CSSProperties } from "react";

// Replaces the old chatGPTSignOutPath("/") nav link — there is no more
// GET-navigable sign-out route, so this posts to the real logout endpoint
// and then bounces to "/". Styled inline to match the surrounding
// `.portal header nav a` links (see app/portal.css) since it renders as a
// <button>, not an <a>, and this file is out of scope for editing that CSS.
const navLinkStyle: CSSProperties = {
  font: "inherit",
  fontSize: 10,
  color: "#18372d",
  textTransform: "uppercase",
  letterSpacing: ".08em",
  background: "none",
  border: 0,
  padding: 0,
  cursor: "pointer",
};

export default function SignOutLink() {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }
  return (
    <button type="button" onClick={signOut} style={navLinkStyle}>
      Sign out
    </button>
  );
}
