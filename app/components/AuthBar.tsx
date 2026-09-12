"use client";

import { useEffect, useState } from "react";

type User = { email: string; displayName: string; role: string };

export default function AuthBar({ extra }: { extra?: { href: string; label: string }[] }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/me").then(async (response) => {
      if (!response.ok) { setUser(null); return; }
      const body = await response.json() as { user: User };
      setUser(body.user);
    }).catch(() => setUser(null));
  }, []);
  const links = extra || [];
  if (user === undefined) return <nav>{links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}</nav>;
  if (!user) {
    return (
      <nav>
        {links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
        <a href="/signin">Sign in</a>
        <a href="/signin?return_to=/signup">Create account</a>
      </nav>
    );
  }
  return (
    <nav>
      {links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
      <a href="/marketplace">Matches</a>
      <a href="/dashboard">{user.displayName}</a>
      {user.role === "admin" ? <a href="/admin">Admin</a> : null}
      <a href="/signout">Sign out</a>
    </nav>
  );
}
