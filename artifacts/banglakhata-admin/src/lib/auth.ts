import { useEffect } from "react";
import { useLocation } from "wouter";

export function getAdminToken() {
  return localStorage.getItem("admin_token");
}

export function getAdminTokenExpires() {
  return localStorage.getItem("admin_token_expires");
}

export function setAdminAuth(token: string, expiresAt: string) {
  localStorage.setItem("admin_token", token);
  localStorage.setItem("admin_token_expires", expiresAt);
}

export function clearAdminAuth() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_token_expires");
}

export function useAuthGuard() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const token = getAdminToken();
    const expiresAt = getAdminTokenExpires();
    
    if (!token || !expiresAt) {
      if (location !== "/") setLocation("/");
      return;
    }

    try {
      const expiresDate = new Date(expiresAt);
      if (expiresDate <= new Date()) {
        clearAdminAuth();
        if (location !== "/") setLocation("/");
      }
    } catch {
      clearAdminAuth();
      if (location !== "/") setLocation("/");
    }
  }, [location, setLocation]);
}
