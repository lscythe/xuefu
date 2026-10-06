# Contract tests

One suite per remote adapter (issue tracker, repository host, CI server, Telegram).
Each verifies request shape, response decoding, pagination, error statuses
(401/403/404/429/5xx), timeouts and missing/unexpected fields against recorded
fixtures served by a local fake server. Never call real services from here.
