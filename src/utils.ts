export function formatMs(ms: number): string {
  const str = [];
  const second = 1000;
  const minute = second * 60;
  const hour = minute * 60;
  const day = hour * 24;
  const asDay = ms / day;
  const asHour = (ms % day) / hour;
  const asMinute = (ms % hour) / minute;
  const asSecond = (ms % minute) / second;
  if (asDay >= 1) {
    str.push(`${Math.floor(asDay)}d`);
  }
  if (asHour >= 1) {
    str.push(`${Math.floor(asHour)}h`);
  }
  if (asMinute >= 1) {
    str.push(`${Math.floor(asMinute)}m`);
  }
  str.push(`${asSecond}s`);
  return str.join(" ");
}

export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
