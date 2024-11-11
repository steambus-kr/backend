import { createPinoLogger, pino } from "@bogeychan/elysia-logger";
import { join } from "path";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import pretty from "pino-pretty";

const logRoot = process.env.LOG_ROOT ?? "logs";
if (!existsSync(logRoot)) {
  mkdirSync(logRoot);
}

export const logFilePath = join(logRoot, "log.stream.out");
export const errorFilePath = join(logRoot, "error.stream.out");
const logStream = createWriteStream(logFilePath);
const errorStream = createWriteStream(errorFilePath);

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

export function fgiLoggerBuilder() {
  const nowDate = new Intl.DateTimeFormat("ko", {
    dateStyle: "short",
    timeZone: "Asia/Seoul",
  })
    .format(new Date())
    .replaceAll(/\.\s?/g, "-")
    .slice(0, -1);
  const logPath = join(logRoot, "fgi.out.d", nowDate);
  const errorLogPath = join(logRoot, "fgi.error.d", nowDate);
  // yy. mm. dd -> yy-mm-dd
  if (!existsSync(logPath)) {
    mkdirSync(logPath, { recursive: true });
  }
  if (!existsSync(errorLogPath)) {
    mkdirSync(errorLogPath, { recursive: true });
  }
  return [
    createPinoLogger({
      level: "debug",
      stream: pino.multistream([
        {
          level: "debug",
          stream: createWriteStream(logPath),
        },
        {
          level: "warn",
          stream: createWriteStream(errorLogPath),
        },
        {
          level: "info",
          stream: pretty({ colorize: true }),
        },
      ]),
      name: "FetchGameInfoService",
    }),
    logPath,
    errorLogPath,
  ] as const;
}

export function pcLoggerBuilder() {
  const now = new Date();
  const nowDate = new Intl.DateTimeFormat("ko", {
    dateStyle: "short",
    timeZone: "Asia/Seoul",
  })
    .format(now)
    .replaceAll(/\.\s?/g, "-")
    .slice(0, -1);
  const nowTime = new Intl.DateTimeFormat("ko", {
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  })
    .format(now)
    .split(" ")[1]
    .replaceAll(":", "-");
  const logPath = join(logRoot, "pc", `${nowDate}.out.d`, nowTime);
  const errorLogPath = join(logRoot, "pc", `${nowDate}.error.d`, nowTime);
  // yy. mm. dd -> yy-mm-dd
  if (!existsSync(logPath)) {
    mkdirSync(logPath, { recursive: true });
  }
  if (!existsSync(errorLogPath)) {
    mkdirSync(errorLogPath, { recursive: true });
  }
  return [
    createPinoLogger({
      level: "debug",
      stream: pino.multistream([
        {
          level: "debug",
          stream: createWriteStream(logPath),
        },
        {
          level: "warn",
          stream: createWriteStream(errorLogPath),
        },
        {
          level: "info",
          stream: pretty({ colorize: true }),
        },
      ]),
      name: "PlayerCountService",
    }),
    logPath,
    errorLogPath,
  ] as const;
}
