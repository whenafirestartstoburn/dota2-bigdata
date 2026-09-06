package s3store

import "testing"

func TestNormalizeBucket(t *testing.T) {
	kind, bucket := NormalizeBucket("gs://dl-dota2-demos/")
	if kind != "gcs" || bucket != "dl-dota2-demos" {
		t.Fatalf("gcs: got %s %s", kind, bucket)
	}
	kind, bucket = NormalizeBucket("datalouna-dota-replays")
	if kind != "s3" || bucket != "datalouna-dota-replays" {
		t.Fatalf("s3: got %s %s", kind, bucket)
	}
}
