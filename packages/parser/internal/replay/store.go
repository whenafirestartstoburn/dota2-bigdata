package replay

// tree is the per-entity property bag. Nested layouts live as child trees.
type tree struct {
	vals []any
}

func newTree() *tree {
	return &tree{vals: make([]any, 8)}
}

func (t *tree) get(c *cursor) any {
	x := t
	for i := 0; i <= c.last; i++ {
		z := c.idx[i]
		if len(x.vals) < z+2 {
			return nil
		}
		if i == c.last {
			return x.vals[z]
		}
		sub, ok := x.vals[z].(*tree)
		if !ok {
			return nil
		}
		x = sub
	}
	return nil
}

func (t *tree) set(c *cursor, v any) {
	x := t
	for i := 0; i <= c.last; i++ {
		z := c.idx[i]
		if y := len(x.vals); y < z+2 {
			grown := make([]any, max(z+2, y*2))
			copy(grown, x.vals)
			x.vals = grown
		}
		if i == c.last {
			if _, ok := x.vals[z].(*tree); !ok {
				x.vals[z] = v
			}
			return
		}
		if _, ok := x.vals[z].(*tree); !ok {
			x.vals[z] = newTree()
		}
		x = x.vals[z].(*tree)
	}
}

func (t *tree) clone() *tree {
	c := &tree{vals: make([]any, len(t.vals))}
	copy(c.vals, t.vals)
	for i, v := range c.vals {
		switch x := v.(type) {
		case *tree:
			c.vals[i] = x.clone()
		case []float32:
			c.vals[i] = append([]float32(nil), x...)
		case []byte:
			c.vals[i] = append([]byte(nil), x...)
		}
	}
	return c
}

func (t *tree) emptyAt(c *cursor) bool {
	return t.get(c) == nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
