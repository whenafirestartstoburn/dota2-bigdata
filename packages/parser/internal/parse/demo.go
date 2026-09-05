package parse

import (
	"bytes"
	"compress/bzip2"
	"fmt"
	"io"
	"os"

	"github.com/klauspost/compress/zstd"
)

var (
	magicDEM  = []byte("PBDEMS2")
	magicBZ2  = []byte("BZh")
	magicZstd = []byte{0x28, 0xb5, 0x2f, 0xfd}
)

// OpenDemo returns a decompressed demo stream. The caller must close closer.
func OpenDemo(path string) (io.Reader, io.Closer, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	r, err := wrapDemo(f)
	if err != nil {
		_ = f.Close()
		return nil, nil, err
	}
	return r, f, nil
}

func wrapDemo(r io.Reader) (io.Reader, error) {
	head := make([]byte, 8)
	n, err := io.ReadFull(r, head)
	if err != nil && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	head = head[:n]
	rest := io.MultiReader(bytes.NewReader(head), r)
	switch {
	case bytes.HasPrefix(head, magicDEM):
		return rest, nil
	case bytes.HasPrefix(head, magicBZ2):
		return bzip2.NewReader(rest), nil
	case bytes.HasPrefix(head, magicZstd):
		zr, err := zstd.NewReader(rest)
		if err != nil {
			return nil, err
		}
		return zr, nil
	default:
		return nil, fmt.Errorf("unrecognised demo magic %q", head)
	}
}

func wrapBytes(buf []byte) (io.Reader, error) {
	return wrapDemo(bytes.NewReader(buf))
}
