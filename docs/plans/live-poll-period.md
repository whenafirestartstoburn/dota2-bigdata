# Live poll period + concurrency cap

- [x] Spec: 1 s period from tick start; `live_max_concurrent` skip
- [x] Setting + migration (`live_max_concurrent` = 5)
- [x] Schedule next live tick at start; skip when the cap is full
- [x] Tests + live worker concurrency headroom
