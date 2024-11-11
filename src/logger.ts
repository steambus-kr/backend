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
  const logPath = join(logRoot, "fgi.out.d");
  const errorLogPath = join(logRoot, "fgi.error.d");
  // yy. mm. dd -> yy-mm-dd
  return createPinoLogger({
    level: "debug",
    stream: pino.multistream([
      {
        level: "debug",
        stream: createWriteStream(join(logPath, nowDate)),
      },
      {
        level: "warn",
        stream: createWriteStream(join(errorLogPath, nowDate)),
      },
      {
        level: "info",
        stream: pretty({ colorize: true }),
      },
    ]),
    name: "FetchGameInfoService",
  });
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
    dateStyle: "medium",
    timeZone: "Asia/Seoul",
  })
    .format(now)
    .split(" ")[1]
    .replaceAll(":", "-");
  const logPath = join(logRoot, "pc", `${nowDate}.out.d`);
  const errorLogPath = join(logRoot, "pc", `${nowDate}.error.d`);
  // yy. mm. dd -> yy-mm-dd
  return createPinoLogger({
    level: "debug",
    stream: pino.multistream([
      {
        level: "debug",
        stream: createWriteStream(join(logPath, nowTime)),
      },
      {
        level: "warn",
        stream: createWriteStream(join(errorLogPath, nowTime)),
      },
      {
        level: "info",
        stream: pretty({ colorize: true }),
      },
    ]),
    name: "PlayerCountService",
  });
}
