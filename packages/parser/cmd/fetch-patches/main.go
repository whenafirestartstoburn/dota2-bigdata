// Fetch one professional replay per major patch listed in Postgres `patches`.
// Valve's CDN expires files after a few weeks; OpenDota is tried first.
//
//	go run ./cmd/fetch-patches
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

var patches = []struct {
	Name  string
	After int64
	Until int64
}{
	{"7.00", 1481500800, 1482278400},
	{"7.07", 1509408000, 1512086400},
	{"7.10", 1519862400, 1522540800},
	{"7.20", 1542585600, 1545264000},
	{"7.23", 1574726400, 1577750400},
	{"7.27", 1593302400, 1596240000},
	{"7.29", 1617926400, 1621209600},
	{"7.30", 1629244800, 1632441600},
	{"7.32", 1661299200, 1664496000},
	{"7.33", 1681948800, 1685577600},
	{"7.35", 1702512000, 1705881600},
	{"7.36", 1716336000, 1719792000},
	{"7.37", 1723593600, 1727740800},
	{"7.38", 1739923200, 1743379200},
	{"7.39", 1747958400, 1751328000},
}

type odotaMatch struct {
	MatchID    uint64 `json:"match_id"`
	Cluster    int    `json:"cluster"`
	ReplaySalt int    `json:"replay_salt"`
	StartTime  int64  `json:"start_time"`
}

func main() {
	root := "testdata/patches"
	if err := os.MkdirAll(root, 0o755); err != nil {
		fatal(err)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	// Newest first — Valve only keeps a few weeks of files.
	for i, j := 0, len(patches)-1; i < j; i, j = i+1, j-1 {
		patches[i], patches[j] = patches[j], patches[i]
	}
	for _, p := range patches {
		dir := filepath.Join(root, p.Name)
		_ = os.MkdirAll(dir, 0o755)
		existing, _ := filepath.Glob(filepath.Join(dir, "*.dem*"))
		if len(existing) > 0 {
			fmt.Println(p.Name, "already has", existing[0])
			continue
		}
		url := fmt.Sprintf(
			"https://api.opendota.com/api/explorer?sql=%s",
			queryEscape(fmt.Sprintf(
				`SELECT match_id, cluster, replay_salt, start_time
				 FROM matches
				 WHERE start_time >= %d AND start_time < %d
				   AND leagueid > 0 AND radiant_win IS NOT NULL
				   AND cluster IS NOT NULL AND replay_salt IS NOT NULL
				 ORDER BY start_time ASC LIMIT 5`, p.After, p.Until)),
		)
		matches, err := fetchMatches(client, url)
		if err != nil {
			fmt.Println(p.Name, "lookup failed:", err)
			time.Sleep(time.Second)
			continue
		}
		ok := false
		for _, m := range matches {
			replay := fmt.Sprintf("http://replay%d.valve.net/%d_%d.dem.bz2", m.Cluster, m.MatchID, m.ReplaySalt)
			dest := filepath.Join(dir, fmt.Sprintf("%d_%d.dem.bz2", m.MatchID, m.ReplaySalt))
			fmt.Println(p.Name, "trying", replay)
			if err := download(client, replay, dest); err != nil {
				fmt.Println(" ", err)
				_ = os.Remove(dest)
				continue
			}
			fmt.Println(" saved", dest)
			ok = true
			break
		}
		if !ok {
			fmt.Println(p.Name, "no replay available (Valve CDN expired)")
		}
		time.Sleep(1500 * time.Millisecond)
	}
}

func fetchMatches(client *http.Client, url string) ([]odotaMatch, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("opendota %d %s", resp.StatusCode, body)
	}
	var envelope struct {
		Rows []odotaMatch `json:"rows"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, err
	}
	return envelope.Rows, nil
}

func download(client *http.Client, url, dest string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(f, resp.Body)
	if err != nil {
		return err
	}
	if n < 100_000 {
		return fmt.Errorf("file too small (%d bytes)", n)
	}
	return nil
}

func queryEscape(s string) string {
	return urlQueryEscape(s)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

// tiny escape to avoid pulling net/url just for this helper in comments.
func urlQueryEscape(s string) string {
	hex := "0123456789ABCDEF"
	var b []byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~' {
			b = append(b, c)
			continue
		}
		b = append(b, '%', hex[c>>4], hex[c&15])
	}
	return string(b)
}
