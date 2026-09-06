package replay

import "math"

// Valve quantized-float flags from the sendtable encoder.
const (
	qRoundDown = 1 << 0
	qRoundUp   = 1 << 1
	qZero      = 1 << 2
	qInts      = 1 << 3
)

type qfloat struct {
	low, high, mul, dec, off float32
	bits                     uint32
	flags                    uint32
}

func (q *qfloat) tuneFlags() {
	if q.flags == 0 {
		return
	}
	if (q.low == 0 && q.flags&qRoundDown != 0) || (q.high == 0 && q.flags&qRoundUp != 0) {
		q.flags &^= qZero
	}
	if q.low == 0 && q.flags&qZero != 0 {
		q.flags |= qRoundDown
		q.flags &^= qZero
	}
	if q.high == 0 && q.flags&qZero != 0 {
		q.flags |= qRoundUp
		q.flags &^= qZero
	}
	if q.low > 0 || q.high < 0 {
		q.flags &^= qZero
	}
	if q.flags&qInts != 0 {
		q.flags &^= qRoundUp | qRoundDown | qZero
	}
	if q.flags&(qRoundDown|qRoundUp) == qRoundDown|qRoundUp {
		die("round-up and round-down cannot both be set")
	}
}

func (q *qfloat) multipliers(steps uint32) {
	span := q.high - q.low
	high := uint32((1 << q.bits) - 1)
	if q.bits == 32 {
		high = 0xFFFFFFFE
	}
	hm := float32(high)
	if math.Abs(float64(span)) > 0 {
		hm = float32(high) / span
	}
	if hm*span > float32(high) || float64(hm*span) > float64(high) {
		for _, f := range []float32{0.9999, 0.99, 0.9, 0.8, 0.7} {
			hm = float32(high) / span * f
			if !(hm*span > float32(high) || float64(hm*span) > float64(high)) {
				break
			}
		}
	}
	q.mul = hm
	q.dec = 1 / float32(steps-1)
	if q.mul == 0 {
		die("quantized float multiplier is 0")
	}
}

func (q *qfloat) snap(v float32) float32 {
	if v < q.low {
		return q.low
	}
	if v > q.high {
		return q.high
	}
	i := uint32((v - q.low) * q.mul)
	return q.low + (q.high-q.low)*(float32(i)*q.dec)
}

func (q *qfloat) read(r *bits) float32 {
	if q.flags&qRoundDown != 0 && r.bit() {
		return q.low
	}
	if q.flags&qRoundUp != 0 && r.bit() {
		return q.high
	}
	if q.flags&qZero != 0 && r.bit() {
		return 0
	}
	return q.low + (q.high-q.low)*float32(r.u(q.bits))*q.dec
}

func newQfloat(bitCount, flags *int32, low, high *float32) *qfloat {
	q := &qfloat{}
	if bitCount == nil || *bitCount == 0 || *bitCount >= 32 {
		q.bits = 32
		return q
	}
	q.bits = uint32(*bitCount)
	if low != nil {
		q.low = *low
	}
	if high != nil {
		q.high = *high
	} else {
		q.high = 1
	}
	if flags != nil {
		q.flags = uint32(*flags)
	}
	q.tuneFlags()
	steps := 1 << q.bits
	if q.flags&qRoundDown != 0 {
		span := q.high - q.low
		q.off = span / float32(steps)
		q.high -= q.off
	} else if q.flags&qRoundUp != 0 {
		span := q.high - q.low
		q.off = span / float32(steps)
		q.low += q.off
	}
	if q.flags&qInts != 0 {
		delta := q.high - q.low
		if delta < 1 {
			delta = 1
		}
		need := uint32(math.Ceil(math.Log2(float64(delta))))
		range2 := 1 << need
		bc := q.bits
		for 1<<bc <= uint32(range2) {
			bc++
		}
		if bc > q.bits {
			q.bits = bc
			steps = 1 << q.bits
		}
		q.off = float32(range2) / float32(steps)
		q.high = q.low + float32(range2) - q.off
	}
	if q.bits > 32 {
		die("quantized float wider than 32 bits")
	}
	q.multipliers(uint32(steps))
	if q.flags&qRoundDown != 0 && q.snap(q.low) == q.low {
		q.flags &^= qRoundDown
	}
	if q.flags&qRoundUp != 0 && q.snap(q.high) == q.high {
		q.flags &^= qRoundUp
	}
	if q.flags&qZero != 0 && q.snap(0) == 0 {
		q.flags &^= qZero
	}
	return q
}
