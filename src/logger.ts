import { createPinoLogger } from "@bogeychan/elysia-logger";

export const logger = createPinoLogger({
  transport: { target: "pino-pretty" },
});
