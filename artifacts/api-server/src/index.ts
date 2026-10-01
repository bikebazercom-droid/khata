import app from "./app";
import { logger } from "./lib/logger";
import { getSmsGatewayStatus } from "./services/sms";

if (!process.env.SESSION_SECRET?.trim()) {
  throw new Error(
    "SESSION_SECRET environment variable is required for phone sessions, OTP hashing, and rate limits.",
  );
}

const smsGateway = getSmsGatewayStatus();
if (smsGateway.configurationErrorCode) {
  logger.warn({
    code: smsGateway.configurationErrorCode,
    apiKeyConfigured: smsGateway.apiKeyConfigured,
    gatewayConfigured: smsGateway.gatewayConfigured,
  }, "SMS OTP delivery is unavailable; the API will continue running");
} else {
  logger.info({
    provider: smsGateway.provider,
    gatewayUrl: smsGateway.gatewayUrl,
  }, "SMS OTP gateway configuration is ready");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
