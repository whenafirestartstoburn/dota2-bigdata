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

type Client struct {
	api    *s3.Client
	bucket string
}

func Open(ctx context.Context, endpoint, region, bucket, access, secret string, pathStyle bool) (*Client, error) {
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
		api:    s3.NewFromConfig(cfg, s3opts...),
		bucket: bucket,
	}, nil
}

func (c *Client) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	if bucket == "" {
		bucket = c.bucket
	}
	out, err := c.api.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("s3 get %s/%s: %w", bucket, key, err)
	}
	return out.Body, nil
}
