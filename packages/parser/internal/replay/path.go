package replay

import (
	"container/heap"
	"strings"
)

// Source 2 field-path Huffman weights. These are Valve protocol constants:
// each op's frequency in the engine's encoder. Zero-weight ops still occupy
// a leaf (weight forced to 1) so the code table stays aligned with the wire.
const pathDepth = 7

type cursor struct {
	idx  [pathDepth]int
	last int
	done bool
}

func newCursor() *cursor {
	c := &cursor{}
	c.idx[0] = -1
	return c
}

func (c *cursor) reset() {
	c.idx = [pathDepth]int{-1}
	c.last = 0
	c.done = false
}

func (c *cursor) copy() *cursor {
	x := *c
	return &x
}

func (c *cursor) pop(n int) {
	for i := 0; i < n; i++ {
		c.idx[c.last] = 0
		c.last--
	}
}

type pathOp struct {
	weight int
	run    func(*bits, *cursor)
}

// Order is the engine's op enum. Do not reorder.
var pathOps = []pathOp{
	{36271, func(_ *bits, c *cursor) { c.idx[c.last] += 1 }},
	{10334, func(_ *bits, c *cursor) { c.idx[c.last] += 2 }},
	{1375, func(_ *bits, c *cursor) { c.idx[c.last] += 3 }},
	{646, func(_ *bits, c *cursor) { c.idx[c.last] += 4 }},
	{4128, func(r *bits, c *cursor) { c.idx[c.last] += r.uBitPath() + 5 }},
	{35, func(_ *bits, c *cursor) { c.last++; c.idx[c.last] = 0 }},
	{3, func(r *bits, c *cursor) { c.last++; c.idx[c.last] = r.uBitPath() }},
	{521, func(_ *bits, c *cursor) { c.idx[c.last] += 1; c.last++; c.idx[c.last] = 0 }},
	{2942, func(r *bits, c *cursor) { c.idx[c.last] += 1; c.last++; c.idx[c.last] = r.uBitPath() }},
	{560, func(r *bits, c *cursor) { c.idx[c.last] += r.uBitPath(); c.last++; c.idx[c.last] = 0 }},
	{471, func(r *bits, c *cursor) {
		c.idx[c.last] += r.uBitPath() + 2
		c.last++
		c.idx[c.last] = r.uBitPath() + 1
	}},
	{10530, func(r *bits, c *cursor) {
		c.idx[c.last] += int(r.u(3)) + 2
		c.last++
		c.idx[c.last] = int(r.u(3)) + 1
	}},
	{251, func(r *bits, c *cursor) {
		c.idx[c.last] += int(r.u(4)) + 2
		c.last++
		c.idx[c.last] = int(r.u(4)) + 1
	}},
	{0, func(r *bits, c *cursor) {
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
	}},
	{0, func(r *bits, c *cursor) {
		c.last++
		c.idx[c.last] = int(r.u(5))
		c.last++
		c.idx[c.last] = int(r.u(5))
	}},
	{0, func(r *bits, c *cursor) {
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
	}},
	{0, func(r *bits, c *cursor) {
		c.last++
		c.idx[c.last] = int(r.u(5))
		c.last++
		c.idx[c.last] = int(r.u(5))
		c.last++
		c.idx[c.last] = int(r.u(5))
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += 1
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += 1
		c.last++
		c.idx[c.last] += int(r.u(5))
		c.last++
		c.idx[c.last] += int(r.u(5))
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += 1
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += 1
		c.last++
		c.idx[c.last] += int(r.u(5))
		c.last++
		c.idx[c.last] += int(r.u(5))
		c.last++
		c.idx[c.last] += int(r.u(5))
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += int(r.uBitVar()) + 2
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += int(r.uBitVar()) + 2
		c.last++
		c.idx[c.last] += int(r.u(5))
		c.last++
		c.idx[c.last] += int(r.u(5))
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += int(r.uBitVar()) + 2
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
		c.last++
		c.idx[c.last] += r.uBitPath()
	}},
	{0, func(r *bits, c *cursor) {
		c.idx[c.last] += int(r.uBitVar()) + 2
		c.last++
		c.idx[c.last] += int(r.u(5))
		c.last++
		c.idx[c.last] += int(r.u(5))
		c.last++
		c.idx[c.last] += int(r.u(5))
	}},
	{0, func(r *bits, c *cursor) {
		n := int(r.uBitVar())
		c.idx[c.last] += int(r.uBitVar())
		for i := 0; i < n; i++ {
			c.last++
			c.idx[c.last] += r.uBitPath()
		}
	}},
	{310, func(r *bits, c *cursor) {
		for i := 0; i <= c.last; i++ {
			if r.bit() {
				c.idx[i] += int(r.varS32()) + 1
			}
		}
		n := int(r.uBitVar())
		for i := 0; i < n; i++ {
			c.last++
			c.idx[c.last] = r.uBitPath()
		}
	}},
	{2, func(_ *bits, c *cursor) { c.pop(1); c.idx[c.last] += 1 }},
	{0, func(r *bits, c *cursor) { c.pop(1); c.idx[c.last] += r.uBitPath() + 1 }},
	{1837, func(_ *bits, c *cursor) { c.pop(c.last); c.idx[0] += 1 }},
	{149, func(r *bits, c *cursor) { c.pop(c.last); c.idx[0] += r.uBitPath() + 1 }},
	{300, func(r *bits, c *cursor) { c.pop(c.last); c.idx[0] += int(r.u(3)) + 1 }},
	{634, func(r *bits, c *cursor) { c.pop(c.last); c.idx[0] += int(r.u(6)) + 1 }},
	{0, func(r *bits, c *cursor) { c.pop(r.uBitPath()); c.idx[c.last] += 1 }},
	{0, func(r *bits, c *cursor) { c.pop(r.uBitPath()); c.idx[c.last] += int(r.varS32()) }},
	{1, func(r *bits, c *cursor) {
		c.pop(r.uBitPath())
		for i := 0; i <= c.last; i++ {
			if r.bit() {
				c.idx[i] += int(r.varS32())
			}
		}
	}},
	{76, func(r *bits, c *cursor) {
		for i := 0; i <= c.last; i++ {
			if r.bit() {
				c.idx[i] += int(r.varS32())
			}
		}
	}},
	{271, func(_ *bits, c *cursor) { c.idx[c.last-1] += 1 }},
	{99, func(r *bits, c *cursor) {
		for i := 0; i <= c.last; i++ {
			if r.bit() {
				c.idx[i] += int(r.u(4)) - 7
			}
		}
	}},
	{25474, func(_ *bits, c *cursor) { c.done = true }},
}

type huff interface {
	weight() int
	leaf() bool
	value() int
	left() huff
	right() huff
}

type hLeaf struct {
	w, v int
}

func (n *hLeaf) weight() int { return n.w }
func (n *hLeaf) leaf() bool  { return true }
func (n *hLeaf) value() int  { return n.v }
func (n *hLeaf) left() huff  { die("leaf has no left"); return nil }
func (n *hLeaf) right() huff { die("leaf has no right"); return nil }

type hNode struct {
	w, v int
	l, r huff
}

func (n *hNode) weight() int { return n.w }
func (n *hNode) leaf() bool  { return false }
func (n *hNode) value() int  { return n.v }
func (n *hNode) left() huff  { return n.l }
func (n *hNode) right() huff { return n.r }

type hHeap []huff

func (h hHeap) Len() int { return len(h) }
func (h hHeap) Less(i, j int) bool {
	if h[i].weight() == h[j].weight() {
		return h[i].value() >= h[j].value()
	}
	return h[i].weight() < h[j].weight()
}
func (h hHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *hHeap) Push(x any)   { *h = append(*h, x.(huff)) }
func (h *hHeap) Pop() any     { n := len(*h); x := (*h)[n-1]; *h = (*h)[:n-1]; return x }

func buildHuff(freq []int) huff {
	var trees hHeap
	for v, w := range freq {
		if w == 0 {
			w = 1
		}
		trees = append(trees, &hLeaf{w, v})
	}
	seq := 40
	heap.Init(&trees)
	for trees.Len() > 1 {
		a := heap.Pop(&trees).(huff)
		b := heap.Pop(&trees).(huff)
		heap.Push(&trees, &hNode{a.weight() + b.weight(), seq, a, b})
		seq++
	}
	return heap.Pop(&trees).(huff)
}

const huffWin = 8

var (
	huffL    []int32
	huffR    []int32
	huffRoot int32
	huffLook [1 << huffWin]uint16
)

func flatten(t huff) int32 {
	i := int32(len(huffL))
	huffL = append(huffL, 0)
	huffR = append(huffR, 0)
	if t.left().leaf() {
		huffL[i] = -(int32(t.left().value()) + 1)
	} else {
		huffL[i] = flatten(t.left())
	}
	if t.right().leaf() {
		huffR[i] = -(int32(t.right().value()) + 1)
	} else {
		huffR[i] = flatten(t.right())
	}
	return i
}

func init() {
	freq := make([]int, len(pathOps))
	for i, op := range pathOps {
		freq[i] = op.weight
	}
	huffRoot = flatten(buildHuff(freq))
	for v := 0; v < len(huffLook); v++ {
		node := huffRoot
		ok := false
		for bit := uint32(0); bit < huffWin; bit++ {
			var child int32
			if (v>>bit)&1 == 1 {
				child = huffR[node]
			} else {
				child = huffL[node]
			}
			if child < 0 {
				huffLook[v] = uint16(bit+1) | uint16(-child-1)<<8
				ok = true
				break
			}
			node = child
		}
		if !ok {
			huffLook[v] = uint16(node) << 8
		}
	}
}

func readPaths(r *bits, dst []cursor) []cursor {
	c := newCursor()
	for {
		entry := huffLook[r.peek(huffWin)]
		var op int32
		if n := entry & 0xFF; n != 0 {
			r.skip(uint32(n))
			op = int32(entry >> 8)
		} else {
			r.skip(huffWin)
			node := int32(entry >> 8)
			for {
				var child int32
				if r.u(1) == 1 {
					child = huffR[node]
				} else {
					child = huffL[node]
				}
				if child < 0 {
					op = -child - 1
					break
				}
				node = child
			}
		}
		pathOps[op].run(r, c)
		if c.done {
			return dst
		}
		dst = append(dst, *c)
	}
}

func applyPaths(r *bits, l *layout, t *tree, buf []cursor) []cursor {
	buf = readPaths(r, buf[:0])
	for i := range buf {
		c := &buf[i]
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					field := "?"
					if c.idx[0] >= 0 && c.idx[0] < len(l.fields) {
						field = strings.Join(l.nameAt(c, 0), ".")
					}
					die("%v (%s.%s)", rec, l.name, field)
				}
			}()
			t.set(c, l.decoderAt(c, 0)(r))
		}()
	}
	return buf
}
