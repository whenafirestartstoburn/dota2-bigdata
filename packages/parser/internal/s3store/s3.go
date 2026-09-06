package s3store

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type getter interface {
	Get(ctx context.Context, bucket, key string) (io.ReadCloser, error)
}

type Client struct {
	backend getter
	bucket  string
}

func NormalizeBucket(raw string) (kind, bucket string) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "gs://") {
		rest := strings.Trim(strings.TrimPrefix(raw, "gs://"), "/")
		if i := strings.IndexByte(rest, '/'); i >= 0 {
			rest = rest[:i]
		}
		return "gcs", rest
	}
	return "s3", strings.TrimRight(raw, "/")
}

func Open(ctx context.Context, endpoint, region, bucket, access, secret string, pathStyle bool) (*Client, error) {
	kind, name := NormalizeBucket(bucket)
	if name == "" {
		return nil, fmt.Errorf("S3_BUCKET must be a bucket name or gs://bucket/")
	}
	if kind == "gcs" {
		return &Client{backend: newGCS(), bucket: name}, nil
	}
	if access == "" || secret == "" {
		return nil, fmt.Errorf("S3_ACCESS_KEY and S3_SECRET_KEY are required unless S3_BUCKET is gs://…")
	}
	opts := []func(*config.LoadOptions) error{
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(access, secret, "")),
	}
	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, err
	}
	s3opts := []func(*s3.Options){
		func(o *s3.Options) {
			o.UsePathStyle = pathStyle
			if endpoint != "" {
				o.BaseEndpoint = aws.String(strings.TrimRight(endpoint, "/"))
			}
		},
	}
	return &Client{
		backend: &s3Backend{api: s3.NewFromConfig(cfg, s3opts...)},
		bucket:  name,
	}, nil
}

func (c *Client) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	if bucket == "" {
		bucket = c.bucket
	} else {
		_, bucket = NormalizeBucket(bucket)
	}
	return c.backend.Get(ctx, bucket, key)
}

type s3Backend struct {
	api *s3.Client
}

func (s *s3Backend) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	out, err := s.api.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("s3 get %s/%s: %w", bucket, key, err)
	}
	return out.Body, nil
}
