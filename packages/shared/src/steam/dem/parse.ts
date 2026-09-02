import { DemoParser } from './demo'
import { ReplayProcessors } from './processors'

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const

function isMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
	if (bytes.length < magic.length) return false
	for (let i = 0; i < magic.length; i++) {
		if (bytes[i] !== magic[i]) return false
	}
	return true
}

function isPbdems2(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 8 &&
		bytes[0] === 80 &&
		bytes[1] === 66 &&
		bytes[2] === 68 &&
		bytes[3] === 69 &&
		bytes[4] === 77 &&
		bytes[5] === 83 &&
		bytes[6] === 50 &&
		bytes[7] === 0
	)
}

async function bunzip(bytes: Uint8Array): Promise<Uint8Array> {
	const proc = Bun.spawn(['bzip2', '-dc'], {
		stdin: bytes,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [out, err, code] = await Promise.all([
		proc.stdout.bytes(),
		proc.stderr.text(),
		proc.exited,
	])
	if (code !== 0) {
		throw new Error(`bzip2 failed (${code}): ${err.slice(0, 400)}`)
	}
	return out
}

/** Valve still uses a `.dem.bz2` URL; the body may be zstd, bzip2, or raw PBDEMS2. */
export async function decompressReplayFile(
	bytes: Uint8Array,
): Promise<Uint8Array> {
	if (isMagic(bytes, ZSTD_MAGIC)) {
		const out = await Bun.zstdDecompress(bytes)
		const copy = new Uint8Array(out.byteLength)
		copy.set(out)
		return copy
	}
	if (bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) {
		return bunzip(bytes)
	}
	if (isPbdems2(bytes)) return bytes
	throw new Error('unknown replay compression')
}

/** Parse a Source 2 `.dem` into the NDJSON event catalog `ingestReplayNdjson` maps. */
export function parseDemToNdjson(dem: Uint8Array): string {
	let processors: ReplayProcessors | undefined
	const demo = new DemoParser({
		onTick() {
			processors?.onTick()
		},
		onEntity(entity, op) {
			processors?.onEntity(entity, op.entered || op.created, op.left)
		},
		onUserMessage(type, data) {
			processors?.onUserMessage(type, data)
		},
		onFileInfo(fields) {
			processors?.onFileInfo(fields)
		},
	})
	processors = new ReplayProcessors(demo)
	demo.parse(dem)
	processors.finalize()
	return processors.events.map((entry) => JSON.stringify(entry)).join('\n')
}
