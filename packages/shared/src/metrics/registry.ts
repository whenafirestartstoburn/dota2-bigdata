export type Labels = Record<string, string>

const DEFAULT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120]

function labelKey(labels: Labels): string {
	return Object.keys(labels)
		.sort()
		.map((key) => `${key}=${labels[key] ?? ''}`)
		.join('\0')
}

export function escapeLabelValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

export function formatLabels(labels: Labels): string {
	const keys = Object.keys(labels).sort()
	if (keys.length === 0) return ''
	return `{${keys
		.map((key) => `${key}="${escapeLabelValue(labels[key] ?? '')}"`)
		.join(',')}}`
}

function assertLabelNames(expected: string[], labels: Labels): void {
	for (const name of expected) {
		if (labels[name] === undefined) {
			throw new Error(`metric label ${name} is required`)
		}
	}
}

type Renderable = { render(): string; reset(): void }

const collectors: Renderable[] = []

export class Counter {
	private readonly values = new Map<string, { labels: Labels; value: number }>()

	constructor(
		readonly name: string,
		readonly help: string,
		readonly labelNames: string[] = [],
	) {
		collectors.push(this)
	}

	inc(labels: Labels = {}, n = 1): void {
		assertLabelNames(this.labelNames, labels)
		const key = labelKey(labels)
		const cur = this.values.get(key)
		if (cur !== undefined) {
			cur.value += n
			return
		}
		this.values.set(key, { labels: { ...labels }, value: n })
	}

	get(labels: Labels = {}): number {
		return this.values.get(labelKey(labels))?.value ?? 0
	}

	reset(): void {
		this.values.clear()
	}

	render(): string {
		const lines = [
			`# HELP ${this.name} ${this.help}`,
			`# TYPE ${this.name} counter`,
		]
		for (const row of this.values.values()) {
			lines.push(`${this.name}${formatLabels(row.labels)} ${row.value}`)
		}
		return lines.join('\n')
	}
}

export class Gauge {
	private readonly values = new Map<string, { labels: Labels; value: number }>()

	constructor(
		readonly name: string,
		readonly help: string,
		readonly labelNames: string[] = [],
	) {
		collectors.push(this)
	}

	set(labels: Labels, value: number): void {
		assertLabelNames(this.labelNames, labels)
		this.values.set(labelKey(labels), { labels: { ...labels }, value })
	}

	setValue(value: number): void {
		this.set({}, value)
	}

	inc(labels: Labels = {}, n = 1): void {
		this.set(labels, this.get(labels) + n)
	}

	dec(labels: Labels = {}, n = 1): void {
		this.inc(labels, -n)
	}

	get(labels: Labels = {}): number {
		return this.values.get(labelKey(labels))?.value ?? 0
	}

	reset(): void {
		this.values.clear()
	}

	render(): string {
		const lines = [
			`# HELP ${this.name} ${this.help}`,
			`# TYPE ${this.name} gauge`,
		]
		for (const row of this.values.values()) {
			lines.push(`${this.name}${formatLabels(row.labels)} ${row.value}`)
		}
		return lines.join('\n')
	}
}

type HistogramRow = {
	labels: Labels
	count: number
	sum: number
	buckets: number[]
}

export class Histogram {
	private readonly values = new Map<string, HistogramRow>()
	private readonly buckets: number[]

	constructor(
		readonly name: string,
		readonly help: string,
		readonly labelNames: string[] = [],
		buckets: number[] = DEFAULT_BUCKETS,
	) {
		this.buckets = [...buckets]
		collectors.push(this)
	}

	ensure(labels: Labels = {}): void {
		assertLabelNames(this.labelNames, labels)
		const key = labelKey(labels)
		if (this.values.has(key)) return
		this.values.set(key, {
			labels: { ...labels },
			count: 0,
			sum: 0,
			buckets: this.buckets.map(() => 0),
		})
	}

	observe(labels: Labels, seconds: number): void {
		this.ensure(labels)
		const row = this.values.get(labelKey(labels))
		if (row === undefined) return
		row.count += 1
		row.sum += seconds
		for (let i = 0; i < this.buckets.length; i++) {
			const le = this.buckets[i]
			if (le === undefined || seconds > le) continue
			row.buckets[i] = (row.buckets[i] ?? 0) + 1
		}
	}

	reset(): void {
		this.values.clear()
	}

	render(): string {
		const lines = [
			`# HELP ${this.name} ${this.help}`,
			`# TYPE ${this.name} histogram`,
		]
		for (const row of this.values.values()) {
			for (let i = 0; i < this.buckets.length; i++) {
				const le = this.buckets[i]
				lines.push(
					`${this.name}_bucket${formatLabels({
						...row.labels,
						le: String(le),
					})} ${row.buckets[i] ?? 0}`,
				)
			}
			lines.push(
				`${this.name}_bucket${formatLabels({
					...row.labels,
					le: '+Inf',
				})} ${row.count}`,
			)
			lines.push(`${this.name}_sum${formatLabels(row.labels)} ${row.sum}`)
			lines.push(`${this.name}_count${formatLabels(row.labels)} ${row.count}`)
		}
		return lines.join('\n')
	}
}

export function renderMetrics(): string {
	return `${collectors.map((item) => item.render()).join('\n\n')}\n`
}

let afterReset: (() => void) | null = null

export function onMetricsReset(fn: () => void): void {
	afterReset = fn
}

export function resetMetrics(): void {
	for (const item of collectors) item.reset()
	up.setValue(1)
	afterReset?.()
}

export const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export const up = new Gauge(
	'dota_up',
	'1 while this process can serve /metrics',
)
up.setValue(1)
