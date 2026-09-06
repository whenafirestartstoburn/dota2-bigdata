package s3store

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type gcsBackend struct {
	http   *http.Client
	mu     sync.Mutex
	token  string
	expiry time.Time
}

func newGCS() *gcsBackend {
	return &gcsBackend{http: &http.Client{Timeout: 10 * time.Minute}}
}

func (g *gcsBackend) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	token, err := g.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	u := fmt.Sprintf(
		"https://storage.googleapis.com/storage/v1/b/%s/o/%s?alt=media",
		url.PathEscape(bucket),
		url.PathEscape(key),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := g.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gcs get %s/%s: %w", bucket, key, err)
	}
	if res.StatusCode != http.StatusOK {
		defer res.Body.Close()
		return nil, fmt.Errorf("gcs get %s/%s: HTTP %d", bucket, key, res.StatusCode)
	}
	return res.Body, nil
}

func (g *gcsBackend) accessToken(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.token != "" && time.Now().Add(60*time.Second).Before(g.expiry) {
		return g.token, nil
	}
	urls := []string{
		"http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
		"http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
	}
	var last error
	for _, raw := range urls {
		token, expiry, err := fetchMetadataToken(ctx, g.http, raw)
		if err != nil {
			last = err
			continue
		}
		g.token = token
		g.expiry = expiry
		return token, nil
	}
	if last == nil {
		last = fmt.Errorf("no metadata URL")
	}
	return "", fmt.Errorf("gcs metadata token: %w", last)
}

func fetchMetadataToken(ctx context.Context, client *http.Client, raw string) (string, time.Time, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return "", time.Time{}, err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req = req.WithContext(ctx)
	res, err := client.Do(req)
	if err != nil {
		return "", time.Time{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", time.Time{}, fmt.Errorf("metadata token HTTP %d", res.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", time.Time{}, err
	}
	if body.AccessToken == "" {
		return "", time.Time{}, fmt.Errorf("metadata token missing access_token")
	}
	return body.AccessToken, time.Now().Add(time.Duration(body.ExpiresIn) * time.Second), nil
}
