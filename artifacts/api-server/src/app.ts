import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Raised from the default 100kb so a scanned bill/receipt image (stored as a
// base64 data URL) can be submitted with a ledger entry.
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
