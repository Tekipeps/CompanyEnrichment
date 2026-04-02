import type { Request, Response, NextFunction } from "express";

/**
 * HTTP Basic Auth middleware for internal/cron endpoints.
 * Reads REFRESH_SECRET from the environment.
 * Expected header: Authorization: Basic <base64("admin:<REFRESH_SECRET>")>
 */
export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.REFRESH_SECRET;

  if (!secret) {
    res.status(500).json({
      error: true,
      code: "MISCONFIGURED",
      message: "REFRESH_SECRET env var is not set",
    });
    return;
  }

  const authHeader = req.headers["authorization"] ?? "";
  const [scheme, encoded] = authHeader.split(" ");

  if (scheme?.toLowerCase() !== "basic" || !encoded) {
    res.setHeader("WWW-Authenticate", 'Basic realm="refresh"');
    res.status(401).json({ error: true, code: "UNAUTHORIZED", message: "Basic auth required" });
    return;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const password = decoded.split(":").slice(1).join(":"); // everything after first colon

  if (password !== secret) {
    res.setHeader("WWW-Authenticate", 'Basic realm="refresh"');
    res.status(401).json({ error: true, code: "UNAUTHORIZED", message: "Invalid credentials" });
    return;
  }

  next();
}
