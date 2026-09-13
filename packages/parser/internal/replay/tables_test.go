package replay

import "testing"

func TestBindFieldModelsResolvesForwardSerializer(t *testing.T) {
	t.Parallel()
	cell := &prop{name: "m_cellX", typ: "uint16", kind: parseKind("uint16")}
	body := &layout{name: "CBodyComponentBaseAnimGraph", fields: []*prop{cell}}
	comp := &prop{
		name:    "CBodyComponent",
		typ:     "CBodyComponent",
		serName: "CBodyComponentBaseAnimGraph",
		kind:    parseKind("CBodyComponent"),
	}
	fields := map[int32]*prop{0: comp, 1: cell}
	layouts := map[string]*layout{"CBodyComponentBaseAnimGraph": body}
	bindFieldModels(fields, layouts)
	if comp.layout != body {
		t.Fatal("CBodyComponent must bind the nested serializer after all tables exist")
	}
	if comp.model != modelFixedTab {
		t.Fatalf("CBodyComponent model=%d, want fixed table", comp.model)
	}
	if cell.model != modelLeaf {
		t.Fatalf("m_cellX model=%d, want leaf", cell.model)
	}
}

func TestBindFieldModelsResolvesVersionedSerializer(t *testing.T) {
	t.Parallel()
	cell := &prop{name: "m_cellY", typ: "uint16", kind: parseKind("uint16")}
	body := &layout{
		name:   "CBodyComponentBaseAnimGraph",
		ver:    3,
		fields: []*prop{cell},
	}
	comp := &prop{
		name:    "m_CBodyComponent",
		typ:     "CBodyComponent",
		serName: "CBodyComponentBaseAnimGraph",
		serVer:  3,
		kind:    parseKind("CBodyComponent"),
	}
	bindFieldModels(
		map[int32]*prop{0: comp, 1: cell},
		map[string]*layout{
			"CBodyComponentBaseAnimGraph:3": body,
		},
	)
	if comp.layout != body {
		t.Fatal("versioned serializer lookup failed")
	}
}
