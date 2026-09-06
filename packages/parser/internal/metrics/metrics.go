package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	Up = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "dota_up",
		Help: "1 while this process can serve /metrics",
	})
	JobsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "dota_parser_jobs_total",
		Help: "Replay parse outcomes",
	}, []string{"result"})
	JobDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "dota_parser_job_duration_seconds",
		Help:    "S3 + decode + ClickHouse + publish wall time",
		Buckets: []float64{1, 5, 10, 30, 60, 120, 300, 600},
	})
	Inflight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "dota_parser_inflight",
		Help: "Parses currently running",
	})
	Queue = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "dota_parser_queue",
		Help: "match_replays rows waiting for or in parse",
	}, []string{"status"})
)

func init() {
	Up.Set(1)
}

func ObserveJob(result string, seconds float64) {
	JobsTotal.WithLabelValues(result).Inc()
	JobDuration.Observe(seconds)
}

func SetQueue(counts map[string]int64) {
	Queue.Reset()
	for status, n := range counts {
		Queue.WithLabelValues(status).Set(float64(n))
	}
}
