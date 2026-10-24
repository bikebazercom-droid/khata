import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { ipPolicy, trustedProxySetting } from "./ipBlock";

const original = {
  nodeEnv: process.env.NODE_ENV,
  serveFrontends: process.env.SERVE_FRONTENDS,
  trustedCidrs: process.env.TRUSTED_PROXY_CIDRS,
  proxyHops: process.env.TRUST_PROXY_HOPS,
  clientIpMode: process.env.CLIENT_IP_MODE,
};

function restoreEnv() {
  for (const [key, value] of Object.entries({
    NODE_ENV: original.nodeEnv,
    SERVE_FRONTENDS: original.serveFrontends,
    TRUSTED_PROXY_CIDRS: original.trustedCidrs,
    TRUST_PROXY_HOPS: original.proxyHops,
    CLIENT_IP_MODE: original.clientIpMode,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);

describe("trusted proxy settings", () => {
  it("trusts only the nearest ingress hop for the combined production app", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SERVE_FRONTENDS;
    delete process.env.TRUSTED_PROXY_CIDRS;
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.CLIENT_IP_MODE;

    expect(trustedProxySetting()).toBe(1);
    expect(ipPolicy()).toEqual({ configured: true, mode: "trusted_proxy" });
  });

  it("lets express-rate-limit use the forwarded client IP behind the production ingress", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SERVE_FRONTENDS;
    delete process.env.TRUSTED_PROXY_CIDRS;
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.CLIENT_IP_MODE;

    const app = express();
    app.set("trust proxy", trustedProxySetting());
    app.use(rateLimit({ windowMs: 60_000, limit: 5 }));
    app.get("/", (req, res) => res.json({ ip: req.ip }));

    const response = await request(app).get("/").set("X-Forwarded-For", "203.0.113.25");
    expect(response.status).toBe(200);
    expect(response.body.ip).toBe("203.0.113.25");
  });

  it("prefers explicitly configured proxy CIDRs", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
    delete process.env.TRUST_PROXY_HOPS;

    expect(trustedProxySetting()).toEqual(["127.0.0.1/32"]);
  });

  it("validates explicitly configured hop counts", () => {
    process.env.NODE_ENV = "development";
    process.env.TRUST_PROXY_HOPS = "0";

    expect(() => trustedProxySetting()).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("keeps explicitly selected direct mode untrusted", () => {
    process.env.NODE_ENV = "production";
    process.env.CLIENT_IP_MODE = "direct";
    delete process.env.TRUSTED_PROXY_CIDRS;
    delete process.env.TRUST_PROXY_HOPS;

    expect(trustedProxySetting()).toBe(false);
    expect(ipPolicy()).toEqual({ configured: true, mode: "direct" });
  });
});
