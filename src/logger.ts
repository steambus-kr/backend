import { createPinoLogger, pino } from "@bogeychan/elysia-logger";
import { join, dirname, resolve } from "path";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "fs";
import pretty from "pino-pretty";
import { Glob } from "bun";
import { gzip } from "node-gzip";

const logRoot = resolve(process.env.LOG_ROOT ?? "logs");
console.log(logRoot);

// 로그 초기화 및 기존 로그 압축
if (existsSync(logRoot)) {
  // 이중 압축을 피하기 위해 .out으로 고정
  const g = new Glob("**/*.out");
  const t = new Date().getTime();
  for (const fileName of g.scanSync(logRoot)) {
    const file = join(logRoot, fileName);
    const compressed = await gzip(await Bun.file(file).arrayBuffer());
    await Bun.write(file + ".gz", compressed.buffer);
    rmSync(file);
  }
  renameSync(logRoot, join(dirname(logRoot), `archived-${t}`));
}
mkdirSync(logRoot);

export const logFilePath = join(logRoot, `log.stream.out`);
export const errorFilePath = join(logRoot, `error.stream.out`);
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
  const logDir = join(logRoot, "fgi.out.d");
  const errorLogDir = join(logRoot, "fgi.error.d");
  const logPath = join(logDir, nowDate + ".out");
  const errorLogPath = join(errorLogDir, nowDate + ".out");
  // yy. mm. dd -> yy-mm-dd.out
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  if (!existsSync(errorLogDir)) {
    mkdirSync(errorLogDir, { recursive: true });
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
    hour12: false,
    timeZone: "Asia/Seoul",
  })
    .format(now)
    .split(" ")[1]
    .replaceAll(":", "-");
  const logDir = join(logRoot, "pc", `${nowDate}.out.d`);
  const errorLogDir = join(logRoot, "pc", `${nowDate}.error.d`);
  const logPath = join(logDir, nowTime + ".out");
  const errorLogPath = join(errorLogDir, nowTime + ".out");
  // yy. mm. dd -> yy-mm-dd
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  if (!existsSync(errorLogDir)) {
    mkdirSync(errorLogDir, { recursive: true });
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
