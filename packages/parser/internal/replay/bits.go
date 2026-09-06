package replay

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

const maxOuterBytes = 256 << 20

type fail string

func (e fail) Error() string { return string(e) }

func die(format string, args ...any) {
	panic(fail(fmt.Sprintf(format, args...)))
}

// wire reads the outer demo byte stream (varints + framed payloads).
type wire struct {
	r    io.Reader
	buf  []byte
	size uint32
}

func newWire(r io.Reader) *wire {
	if _, ok := r.(io.ByteReader); !ok {
		r = bufio.NewReaderSize(r, 100<<10)
	}
	return &wire{r: r, buf: make([]byte, 100<<10), size: 100 << 10}
}

func (s *wire) bytes(n uint32) ([]byte, error) {
	if n > s.size {
		s.buf = make([]byte, n)
		s.size = n
	}
	if _, err := io.ReadFull(s.r, s.buf[:n]); err != nil {
		return nil, err
	}
	return s.buf[:n], nil
}

func (s *wire) var32() (uint32, error) {
	var x, shift uint32
	for {
		b, err := s.bytes(1)
		if err != nil {
			return 0, err
		}
		u := uint32(b[0])
		x |= (u & 0x7F) << shift
		shift += 7
		if u&0x80 == 0 || shift == 35 {
			return x, nil
		}
	}
}

// bits is a little-endian bit reader over a packed Source 2 buffer.
type bits struct {
	buf      []byte
	size     uint32
	pos      uint32
	bitVal   uint64
	bitCount uint32
}

func newBits(buf []byte) *bits {
	return &bits{buf: buf, size: uint32(len(buf))}
}

func (r *bits) reset(buf []byte) {
	r.buf = buf
	r.size = uint32(len(buf))
	r.pos = 0
	r.bitVal = 0
	r.bitCount = 0
}

func (r *bits) remain() uint32 {
	return r.size - r.pos
}

// remainBits is unread bits, including those already sitting in the
// accumulator. Inner demo packets are padded; a leftover byte is not
// another message.
func (r *bits) remainBits() uint32 {
	return (r.size-r.pos)*8 + r.bitCount
}

var bitMask = func() [65]uint64 {
	var m [65]uint64
	for i := 0; i < 64; i++ {
		m[i] = (uint64(1) << uint(i)) - 1
	}
	m[64] = ^uint64(0)
	return m
}()

func (r *bits) nextByte() byte {
	r.pos++
	if r.pos > r.size {
		die("bit reader past end (%d/%d)", r.pos, r.size)
	}
	return r.buf[r.pos-1]
}

func (r *bits) refill(need uint32) {
	for need > r.bitCount && r.pos+8 <= r.size {
		w := binary.LittleEndian.Uint64(r.buf[r.pos:])
		free := (64 - r.bitCount) >> 3
		n := free * 8
		r.bitVal |= (w & bitMask[n]) << r.bitCount
		r.pos += free
		r.bitCount += n
	}
	for need > r.bitCount {
		r.bitVal |= uint64(r.nextByte()) << r.bitCount
		r.bitCount += 8
	}
}

func (r *bits) u(n uint32) uint32 {
	r.refill(n)
	x := r.bitVal & bitMask[n]
	r.bitVal >>= n
	r.bitCount -= n
	return uint32(x)
}

func (r *bits) peek(n uint32) uint32 {
	for n > r.bitCount && r.pos+8 <= r.size {
		w := binary.LittleEndian.Uint64(r.buf[r.pos:])
		free := (64 - r.bitCount) >> 3
		bits := free * 8
		r.bitVal |= (w & bitMask[bits]) << r.bitCount
		r.pos += free
		r.bitCount += bits
	}
	for n > r.bitCount && r.pos < r.size {
		r.bitVal |= uint64(r.nextByte()) << r.bitCount
		r.bitCount += 8
	}
	return uint32(r.bitVal & bitMask[n])
}

func (r *bits) skip(n uint32) {
	if n > r.bitCount {
		die("skip past buffered bits")
	}
	r.bitVal >>= n
	r.bitCount -= n
}

func (r *bits) align() {
	r.pos -= r.bitCount >> 3
	r.bitVal = 0
	r.bitCount = 0
}

func (r *bits) byte() byte {
	if r.bitCount&7 == 0 {
		if r.bitCount != 0 {
			r.align()
		}
		return r.nextByte()
	}
	return byte(r.u(8))
}

func (r *bits) bytes(n uint32) []byte {
	if r.bitCount&7 == 0 {
		if r.bitCount != 0 {
			r.align()
		}
		r.pos += n
		if r.pos > r.size {
			die("byte read past end")
		}
		return r.buf[r.pos-n : r.pos]
	}
	out := make([]byte, n)
	for i := uint32(0); i < n; i++ {
		out[i] = byte(r.u(8))
	}
	return out
}

func (r *bits) le32() uint32 { return binary.LittleEndian.Uint32(r.bytes(4)) }
func (r *bits) le64() uint64 { return binary.LittleEndian.Uint64(r.bytes(8)) }

func (r *bits) var32() uint32 {
	var x, s uint32
	for {
		b := uint32(r.byte())
		x |= (b & 0x7F) << s
		s += 7
		if b&0x80 == 0 || s == 35 {
			return x
		}
	}
}

func (r *bits) varS32() int32 {
	ux := r.var32()
	x := int32(ux >> 1)
	if ux&1 != 0 {
		x = ^x
	}
	return x
}

func (r *bits) var64() uint64 {
	var x, s uint64
	for i := 0; ; i++ {
		b := r.byte()
		if b < 0x80 {
			if i > 9 || (i == 9 && b > 1) {
				die("varint overflows uint64")
			}
			return x | uint64(b)<<s
		}
		x |= uint64(b&0x7f) << s
		s += 7
	}
}

func (r *bits) varS64() int64 {
	ux := r.var64()
	x := int64(ux >> 1)
	if ux&1 != 0 {
		x = ^x
	}
	return x
}

func (r *bits) bit() bool { return r.u(1) == 1 }

func (r *bits) f32() float32 { return math.Float32frombits(r.le32()) }

// uBitVar is Valve's 6-bit-prefixed unsigned integer used in entity deltas
// and inner packet type tags.
func (r *bits) uBitVar() uint32 {
	v := r.u(6)
	switch v & 0x30 {
	case 16:
		return (v & 15) | (r.u(4) << 4)
	case 32:
		return (v & 15) | (r.u(8) << 4)
	case 48:
		return (v & 15) | (r.u(28) << 4)
	}
	return v
}

func (r *bits) uBitPath() int {
	if r.bit() {
		return int(r.u(2))
	}
	if r.bit() {
		return int(r.u(4))
	}
	if r.bit() {
		return int(r.u(10))
	}
	if r.bit() {
		return int(r.u(17))
	}
	return int(r.u(31))
}

func (r *bits) cstrN(n uint32) string { return string(r.bytes(n)) }

func (r *bits) cstr() string {
	var b []byte
	for {
		c := r.byte()
		if c == 0 {
			return string(b)
		}
		b = append(b, c)
	}
}

func (r *bits) coord() float32 {
	hasInt := r.u(1)
	hasFrac := r.u(1)
	if hasInt == 0 && hasFrac == 0 {
		return 0
	}
	neg := r.bit()
	var i, f uint32
	if hasInt != 0 {
		i = r.u(14) + 1
	}
	if hasFrac != 0 {
		f = r.u(5)
	}
	v := float32(i) + float32(f)*(1.0/32)
	if neg {
		return -v
	}
	return v
}

func (r *bits) angle(n uint32) float32 {
	return float32(r.u(n)) * 360 / float32(int(1<<n))
}

func (r *bits) normal() float32 {
	neg := r.bit()
	v := float32(r.u(11)) * (1.0 / (float32(1<<11) - 1))
	if neg {
		return -v
	}
	return v
}

func (r *bits) normal3() []float32 {
	out := []float32{0, 0, 0}
	if r.bit() {
		out[0] = r.normal()
	}
	if r.bit() {
		out[1] = r.normal()
	}
	negZ := r.bit()
	sum := out[0]*out[0] + out[1]*out[1]
	if sum < 1 {
		out[2] = float32(math.Sqrt(float64(1 - sum)))
	}
	if negZ {
		out[2] = -out[2]
	}
	return out
}

func (r *bits) bitBytes(n uint32) []byte {
	var out []byte
	for n >= 8 {
		out = append(out, r.byte())
		n -= 8
	}
	if n > 0 {
		out = append(out, byte(r.u(n)))
	}
	return out
}
