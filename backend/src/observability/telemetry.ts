// Structured logs and Prometheus metrics, both in-process and dependency-free.
// A log line is one JSON object so a collector needs no parser configuration.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  private readonly threshold: number;
  private readonly sink: (line: string) => void;

  constructor(input: { readonly level: LogLevel; readonly sink?: (line: string) => void }) {
    this.threshold = LEVELS[input.level];
    this.sink = input.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  }

  child(fields: Record<string, unknown>): Logger {
    const parent = this;
    return new Logger({
      level: "debug",
      sink: (line: string) => {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        parent.sink(JSON.stringify({ ...fields, ...parsed }));
      },
    });
  }

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    this.sink(JSON.stringify({ level, time: new Date().toISOString(), message, ...fields }));
  }
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histogram = new Map<string, number[]>();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observe(name: string, milliseconds: number): void {
    const samples = this.histogram.get(name) ?? [];
    samples.push(milliseconds);
    if (samples.length > 512) samples.shift();
    this.histogram.set(name, samples);
  }

  /** Prometheus text exposition format: counters, gauges and summary quantiles. */
  render(): string {
    const lines: string[] = [];

    for (const [name, value] of [...this.counters].sort()) {
      lines.push(`# TYPE lemo_${name} counter`);
      lines.push(`lemo_${name} ${value}`);
    }

    for (const [name, value] of [...this.gauges].sort()) {
      lines.push(`# TYPE lemo_${name} gauge`);
      lines.push(`lemo_${name} ${value}`);
    }

    for (const [name, samples] of [...this.histogram].sort()) {
      if (samples.length === 0) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      const quantile = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      lines.push(`# TYPE lemo_${name} summary`);
      lines.push(`lemo_${name}{quantile="0.5"} ${quantile(0.5).toFixed(3)}`);
      lines.push(`lemo_${name}{quantile="0.95"} ${quantile(0.95).toFixed(3)}`);
      lines.push(`lemo_${name}_count ${sorted.length}`);
    }

    return `${lines.join("\n")}\n`;
  }
}
