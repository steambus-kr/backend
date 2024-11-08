import { createPinoLogger, pino } from "@bogeychan/elysia-logger";
import { join } from "path";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import pretty from "pino-pretty";

const logRoot = process.env.LOG_ROOT ?? "logs";
if (!existsSync(logRoot)) {
  mkdirSync(logRoot);
}

const logStream = createWriteStream(join(logRoot, "log.stream.out"));
const errorStream = createWriteStream(join(logRoot, "error.stream.out"));
const fgiStream = createWriteStream(join(logRoot, "fgi.stream.out"));
const fgiErrorStream = createWriteStream(join(logRoot, "fgi.error.stream.out"));
const pcStream = createWriteStream(join(logRoot, "pc.stream.out"));
const pcErrorStream = createWriteStream(join(logRoot, "pc.error.stream.out"));

const stream = pino.multistream([
  {
    level: "debug",
    stream: logStream,
  },
  {
    level: "warn",
    stream: errorStream,
  },
  {
    level: "info",
    stream: pretty({ colorize: true }),
  },
]);

export const logger = createPinoLogger({
  level: "debug",
  stream,
});

export const fgiLogger = createPinoLogger({
  level: "debug",
  stream: pino.multistream([
    {
      level: "debug",
      stream: fgiStream,
    },
    {
      level: "warn",
      stream: fgiErrorStream,
    },
    {
      level: "info",
      stream: pretty({ colorize: true }),
    },
  ]),
  name: "FetchGameInfoService",
});

export const pcLogger = createPinoLogger({
  level: "debug",
  stream: pino.multistream([
    {
      level: "debug",
      stream: pcStream,
    },
    {
      level: "warn",
      stream: pcErrorStream,
    },
    {
      level: "info",
      stream: pretty({ colorize: true }),
    },
  ]),
  name: "PlayerCountService",
});
