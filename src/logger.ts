import { createPinoLogger, pino } from "@bogeychan/elysia-logger";
import { join } from "path";
import { createWriteStream } from "fs";

const logRoot = process.env.LOG_ROOT ?? "logs";
const debugStream = createWriteStream(join(logRoot, "debug.stream.out"));
const logStream = createWriteStream(join(logRoot, "log.stream.out"));
const errorStream = createWriteStream(join(logRoot, "error.stream.out"));

const stream = pino.multistream([
  {
    level: "debug",
    stream: debugStream,
  },
  {
    stream: logStream,
  },
  {
    level: "error",
    stream: errorStream,
  },
  {
    level: "fatal",
    stream: errorStream,
  },
]);

export const logger = createPinoLogger({
  transport: { target: "pino-pretty" },
  stream,
});
