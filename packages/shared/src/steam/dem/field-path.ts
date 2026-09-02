import type { BitReader } from './bitstream'

const MAX_DEPTH = 7

export class FieldPath {
	path: number[] = [-1, 0, 0, 0, 0, 0, 0]
	last = 0
	done = false

	reset(): void {
		this.path = [-1, 0, 0, 0, 0, 0, 0]
		this.last = 0
		this.done = false
	}

	pop(n: number): void {
		for (let i = 0; i < n; i++) {
			this.path[this.last] = 0
			this.last -= 1
		}
	}

	clone(): FieldPath {
		const next = new FieldPath()
		next.path = this.path.slice()
		next.last = this.last
		next.done = this.done
		return next
	}
}

type PathOp = {
	weight: number
	fn: (r: BitReader, fp: FieldPath) => void
}

function ubit(r: BitReader): number {
	return r.readUBitVarFP()
}

const OPS: PathOp[] = [
	{
		weight: 36271,
		fn: (_r, fp) => {
			fp.path[fp.last]! += 1
		},
	},
	{
		weight: 10334,
		fn: (_r, fp) => {
			fp.path[fp.last]! += 2
		},
	},
	{
		weight: 1375,
		fn: (_r, fp) => {
			fp.path[fp.last]! += 3
		},
	},
	{
		weight: 646,
		fn: (_r, fp) => {
			fp.path[fp.last]! += 4
		},
	},
	{
		weight: 4128,
		fn: (r, fp) => {
			fp.path[fp.last]! += ubit(r) + 5
		},
	},
	{
		weight: 35,
		fn: (_r, fp) => {
			fp.last += 1
			fp.path[fp.last] = 0
		},
	},
	{
		weight: 3,
		fn: (r, fp) => {
			fp.last += 1
			fp.path[fp.last] = ubit(r)
		},
	},
	{
		weight: 521,
		fn: (_r, fp) => {
			fp.path[fp.last]! += 1
			fp.last += 1
			fp.path[fp.last] = 0
		},
	},
	{
		weight: 2942,
		fn: (r, fp) => {
			fp.path[fp.last]! += 1
			fp.last += 1
			fp.path[fp.last] = ubit(r)
		},
	},
	{
		weight: 560,
		fn: (r, fp) => {
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last] = 0
		},
	},
	{
		weight: 471,
		fn: (r, fp) => {
			fp.path[fp.last]! += ubit(r) + 2
			fp.last += 1
			fp.path[fp.last] = ubit(r) + 1
		},
	},
	{
		weight: 10530,
		fn: (r, fp) => {
			fp.path[fp.last]! += r.readBits(3) + 2
			fp.last += 1
			fp.path[fp.last] = r.readBits(3) + 1
		},
	},
	{
		weight: 251,
		fn: (r, fp) => {
			fp.path[fp.last]! += r.readBits(4) + 2
			fp.last += 1
			fp.path[fp.last] = r.readBits(4) + 1
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.last += 1
			fp.path[fp.last] = r.readBits(5)
			fp.last += 1
			fp.path[fp.last] = r.readBits(5)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.last += 1
			fp.path[fp.last] = r.readBits(5)
			fp.last += 1
			fp.path[fp.last] = r.readBits(5)
			fp.last += 1
			fp.path[fp.last] = r.readBits(5)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += 1
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += 1
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += 1
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += 1
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += r.readUBitVar() + 2
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += r.readUBitVar() + 2
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += r.readUBitVar() + 2
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
			fp.last += 1
			fp.path[fp.last]! += ubit(r)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.path[fp.last]! += r.readUBitVar() + 2
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
			fp.last += 1
			fp.path[fp.last]! += r.readBits(5)
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			const n = r.readUBitVar()
			fp.path[fp.last]! += r.readUBitVar()
			for (let i = 0; i < n; i++) {
				fp.last += 1
				fp.path[fp.last]! += ubit(r)
			}
		},
	},
	{
		weight: 310,
		fn: (r, fp) => {
			for (let i = 0; i <= fp.last; i++) {
				if (r.readBoolean()) fp.path[i]! += r.readVarInt32() + 1
			}
			const count = r.readUBitVar()
			for (let i = 0; i < count; i++) {
				fp.last += 1
				fp.path[fp.last] = ubit(r)
			}
		},
	},
	{
		weight: 2,
		fn: (_r, fp) => {
			fp.pop(1)
			fp.path[fp.last]! += 1
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.pop(1)
			fp.path[fp.last]! += ubit(r) + 1
		},
	},
	{
		weight: 1837,
		fn: (_r, fp) => {
			fp.pop(fp.last)
			fp.path[0]! += 1
		},
	},
	{
		weight: 149,
		fn: (r, fp) => {
			fp.pop(fp.last)
			fp.path[0]! += ubit(r) + 1
		},
	},
	{
		weight: 300,
		fn: (r, fp) => {
			fp.pop(fp.last)
			fp.path[0]! += r.readBits(3) + 1
		},
	},
	{
		weight: 634,
		fn: (r, fp) => {
			fp.pop(fp.last)
			fp.path[0]! += r.readBits(6) + 1
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.pop(ubit(r))
			fp.path[fp.last]! += 1
		},
	},
	{
		weight: 0,
		fn: (r, fp) => {
			fp.pop(ubit(r))
			fp.path[fp.last]! += r.readVarInt32()
		},
	},
	{
		weight: 1,
		fn: (r, fp) => {
			fp.pop(ubit(r))
			for (let i = 0; i <= fp.last; i++) {
				if (r.readBoolean()) fp.path[i]! += r.readVarInt32()
			}
		},
	},
	{
		weight: 76,
		fn: (r, fp) => {
			for (let i = 0; i <= fp.last; i++) {
				if (r.readBoolean()) fp.path[i]! += r.readVarInt32()
			}
		},
	},
	{
		weight: 271,
		fn: (_r, fp) => {
			fp.path[fp.last - 1]! += 1
		},
	},
	{
		weight: 99,
		fn: (r, fp) => {
			for (let i = 0; i <= fp.last; i++) {
				if (r.readBoolean()) fp.path[i]! += r.readBits(4) - 7
			}
		},
	},
	{
		weight: 25474,
		fn: (_r, fp) => {
			fp.done = true
		},
	},
]

type HuffNode = {
	weight: number
	value: number
	leaf: boolean
	left: HuffNode | null
	right: HuffNode | null
}

function less(a: HuffNode, b: HuffNode): boolean {
	if (a.weight === b.weight) return a.value >= b.value
	return a.weight < b.weight
}

/** Min-heap matching Go `container/heap` + manta's equal-weight rule. */
class HuffHeap {
	items: HuffNode[] = []

	init(nodes: HuffNode[]): void {
		this.items = nodes
		for (let i = (this.items.length >> 1) - 1; i >= 0; i--) this.down(i)
	}

	push(node: HuffNode): void {
		this.items.push(node)
		this.up(this.items.length - 1)
	}

	pop(): HuffNode {
		const n = this.items.length - 1
		this.swap(0, n)
		const node = this.items.pop()
		if (node == null) throw new Error('empty huffman heap')
		if (this.items.length > 0) this.down(0)
		return node
	}

	private swap(i: number, j: number): void {
		const a = this.items[i]
		const b = this.items[j]
		if (a == null || b == null) return
		this.items[i] = b
		this.items[j] = a
	}

	private up(j: number): void {
		for (;;) {
			const i = (j - 1) >> 1
			if (j === 0) return
			const parent = this.items[i]
			const child = this.items[j]
			if (parent == null || child == null || !less(child, parent)) return
			this.swap(i, j)
			j = i
		}
	}

	private down(i0: number): void {
		let i = i0
		const n = this.items.length
		for (;;) {
			const left = 2 * i + 1
			if (left >= n) return
			let j = left
			const right = left + 1
			const lnode = this.items[left]
			const rnode = this.items[right]
			if (right < n && lnode != null && rnode != null && less(rnode, lnode)) {
				j = right
			}
			const parent = this.items[i]
			const child = this.items[j]
			if (parent == null || child == null || !less(child, parent)) return
			this.swap(i, j)
			i = j
		}
	}
}

function buildHuffmanTree(): HuffNode {
	const heap = new HuffHeap()
	const leaves: HuffNode[] = []
	for (let v = 0; v < OPS.length; v++) {
		const w = OPS[v]!.weight === 0 ? 1 : OPS[v]!.weight
		leaves.push({
			weight: w,
			value: v,
			leaf: true,
			left: null,
			right: null,
		})
	}
	heap.init(leaves)
	let n = 40
	while (heap.items.length > 1) {
		const a = heap.pop()
		const b = heap.pop()
		heap.push({
			weight: a.weight + b.weight,
			value: n,
			leaf: false,
			left: a,
			right: b,
		})
		n += 1
	}
	return heap.pop()
}

const huffLeft: number[] = []
const huffRight: number[] = []

function flatten(node: HuffNode): number {
	const idx = huffLeft.length
	huffLeft.push(0)
	huffRight.push(0)
	huffLeft[idx] = node.left?.leaf
		? -(node.left.value + 1)
		: node.left
			? flatten(node.left)
			: 0
	huffRight[idx] = node.right?.leaf
		? -(node.right.value + 1)
		: node.right
			? flatten(node.right)
			: 0
	return idx
}

const huffRoot = flatten(buildHuffmanTree())

export function readFieldPaths(r: BitReader): FieldPath[] {
	const fp = new FieldPath()
	fp.reset()
	const paths: FieldPath[] = []
	let node = huffRoot
	while (!fp.done) {
		const child = r.readBits(1) === 1 ? huffRight[node]! : huffLeft[node]!
		if (child < 0) {
			const op = -child - 1
			const step = OPS[op]
			if (step == null) throw new Error(`unknown field-path op ${op}`)
			step.fn(r, fp)
			if (!fp.done) {
				if (fp.last >= MAX_DEPTH) {
					throw new Error('field path deeper than 7')
				}
				paths.push(fp.clone())
			}
			node = huffRoot
		} else {
			node = child
		}
	}
	return paths
}
