import { createPinoLogger, pino } from "@bogeychan/elysia-logger";
import { join } from "path";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import pretty from "pino-pretty";

const logRoot = process.env.LOG_ROOT ?? "logs";
if (!existsSync(logRoot)) {
  mkdirSync(logRoot);
}

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
  pretty({ colorize: true }),
]);

export const logger = createPinoLogger({
  level: "debug",
  stream,
});
