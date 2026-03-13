# 🚀 Real-Time Event Streaming Platform

A production-grade, high-throughput event streaming platform built with **Apache Kafka**, **ksqlDB**, **Confluent Schema Registry**, **Kafka Streams**, **Quarkus**, and **PostgreSQL** — with an interactive browser-based demo UI.

> Generates and processes **5,000,000 Avro events** across Kafka topics, performs real-time fraud detection via Kafka Streams windowed aggregations, and enriches data through ksqlDB stream-table joins.

---

## 📸 Demo

The platform ships with a fully interactive `index.html` UI that includes:

- **Live Avro Feed** — real-time Kafka message ticker during generation
- **ksqlDB SQL Editor** — free-form SQL with preset complex queries
- **Schema Registry Panel** — view Avro schemas with Table/Raw JSON toggle and compatibility control
- **Kafka Topic Inspector** — editable consumer for any topic (Avro + plain String)
- **CRUD API Explorer** with live activity terminal
- **Fraud simulation** — burst-synthesize FAILED login events for a user

---

## 🏗 Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full Mermaid diagram.

```
Quarkus API ──► user-events / login-events (Avro)
                      │
                      ├──► Schema Registry (14 subjects, FORWARD compat)
                      │
                      ├──► ksqlDB
                      │      USER_STREAM + DEPARTMENT_TABLE → USER_DEPARTMENT_STREAM
                      │      LOGIN_STREAM + USER_STREAM + COUNTRY_RISK_TABLE → USER_ACTIVITY_STREAM
                      │      → FILTERED_USER_ACTIVITY (HIGH risk + salary>100k + FAILED)
                      │
                      └──► Kafka Streams (FraudDetectionTopology)
                             WINDOW TUMBLING(10m) → count >= 5 → fraud-alerts topic
                             Interactive Query: fraud-suspicious-users-store
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| **API** | Quarkus 3.x (JAX-RS, Panache, Reactive Messaging) |
| **Broker** | Apache Kafka 7.5.3 (KRaft — no ZooKeeper) |
| **Schema** | Confluent Schema Registry 7.5.3 |
| **Stream SQL** | ksqlDB 7.5.3 |
| **Stream Processing** | Kafka Streams (Windowed aggregation, interactive queries) |
| **Serialization** | Apache Avro |
| **Database** | PostgreSQL 15 |
| **ORM** | Hibernate Reactive (Panache) |
| **Containers** | Docker Compose 3.8 |
| **UI Proxy** | Node.js (kafka-proxy.js) |

---

## 📦 Project Structure

```
streaming-platform/
├── api/                          # Quarkus application
│   └── src/main/java/com/streaming/api/
│       ├── resource/
│       │   └── UserResource.java          # REST endpoints
│       ├── streams/
│       │   └── FraudDetectionTopology.java # Kafka Streams topology
│       ├── generator/
│       │   └── DataGenerator.java         # 5M event producer
│       └── model/                         # Avro + JPA entities
├── docs/
│   ├── ARCHITECTURE.md           # Component diagram (Mermaid)
│   └── FLOWCHART.md              # 5 end-to-end flow diagrams
├── index.html                     # Interactive browser UI (landing page)
├── kafka-proxy.js                 # Node.js proxy (Schema Registry + Kafka consumer)
├── ksql-init.sql                  # All ksqlDB stream/table definitions
├── docker-compose.yml             # Full stack orchestration
├── test_api.sh                    # Automated API test script
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js (for the UI proxy)
- Java 17+ (to build the API, or use the pre-built Docker image)

### 1. Start the Platform

```bash
cd streaming-platform

# Build and start all services
docker-compose up -d

# Or rebuild the API after changes
docker-compose build api && docker-compose up -d api
```

Services started:
| Container | Port |
|---|---|
| `broker` (Kafka KRaft) | 9092 |
| `schema-registry` | 8081 |
| `ksqldb-server` | 8088 |
| `ksqldb-cli` | — |
| `postgres` | 5432 |
| `quarkus-api` | 8080 |

### 2. Initialize ksqlDB Streams

```bash
docker exec -i ksqldb-cli ksql http://ksqldb-server:8088 < ksql-init.sql
```

### 3. Start the UI Proxy

```bash
node kafka-proxy.js &
```

This starts the proxy on **http://localhost:3001** exposing:
- `GET /topic-messages?topic=X&count=N` — Avro or String consumer
- `GET /ksql-query?q=<encoded SQL>` — Execute any ksqlDB SELECT
- `GET /schema?subject=X` — Fetch Avro schema + compatibility
- `GET /schema/subjects` — List all Schema Registry subjects
- `POST /schema/compatibility` — Change compatibility policy

### 4. Open the Demo UI

```bash
python3 -m http.server 8000
# Open http://localhost:8000/index.html (or just http://localhost:8000)
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/users` | Create a new user (emits Avro event) |
| `GET` | `/users/{id}` | Retrieve a user by UUID |
| `PUT` | `/users/{id}` | Update a user |
| `DELETE` | `/users/{id}` | Delete a user |
| `GET` | `/users/{id}/fraud-activity` | Kafka Streams interactive query — current FAILED login count |
| `POST` | `/users/{id}/simulate-fraud` | Synthesize 6 FAILED login events to trigger fraud detection |
| `POST` | `/api/generate` | Launch 5M event multi-threaded data generation |

---

## 🔍 ksqlDB Streams & Tables

### Streams (5)

| Stream | Source Topic | Description |
|---|---|---|
| `USER_STREAM` | `user-events` | All user creation/update events |
| `LOGIN_STREAM` | `login-events` | All login attempt events |
| `USER_DEPARTMENT_STREAM` | Derived | `USER_STREAM ⋈ DEPARTMENT_TABLE` |
| `USER_ACTIVITY_STREAM` | Derived | 3-way JOIN: login + user + country risk |
| `FILTERED_USER_ACTIVITY` | Derived | High-risk alerts: salary>100k, HIGH risk, FAILED login |

### Tables (2)

| Table | Source Topic | Key |
|---|---|---|
| `DEPARTMENT_TABLE` | `department-events` | `department_id` |
| `COUNTRY_RISK_TABLE` | `country-risk-events` | `country` |

### Example Complex Queries

```sql
-- Stream-Table JOIN: Enrich users with department info
SELECT u.NAME, u.SALARY, d.DEPARTMENT_NAME, d.DEPARTMENT_BUDGET
FROM USER_STREAM u
JOIN DEPARTMENT_TABLE d ON u.DEPARTMENT_ID = d.ROWKEY
EMIT CHANGES LIMIT 8;

-- Windowed Fraud Detection: FAILED logins per user in 10-min tumbling window
SELECT USER_ID, COUNT(*) AS failed_count
FROM LOGIN_STREAM
WINDOW TUMBLING (SIZE 10 MINUTES)
WHERE LOGIN_STATUS = 'FAILED'
GROUP BY USER_ID
EMIT CHANGES LIMIT 10;

-- Hopping Window: Login stats (success/fail split)
SELECT USER_ID,
  SUM(CASE WHEN LOGIN_STATUS='FAILED' THEN 1 ELSE 0 END) AS fail_count,
  SUM(CASE WHEN LOGIN_STATUS='SUCCESS' THEN 1 ELSE 0 END) AS success_count
FROM LOGIN_STREAM
WINDOW HOPPING (SIZE 30 MINUTES, ADVANCE BY 5 MINUTES)
GROUP BY USER_ID
EMIT CHANGES LIMIT 8;

-- Risk enrichment: Users with HIGH country risk
SELECT u.NAME, u.COUNTRY, u.SALARY, r.RISK_LEVEL
FROM USER_STREAM u
JOIN COUNTRY_RISK_TABLE r ON u.COUNTRY = r.COUNTRY
EMIT CHANGES LIMIT 5;
```

---

## 🔒 Fraud Detection

The `FraudDetectionTopology` (Kafka Streams) runs inside the Quarkus API:

```
LOGIN_STREAM → filter(FAILED) → WINDOW TUMBLING(10min) → GROUP BY user_id
  → count >= 5 → produce to fraud-alerts topic
              → update fraud-suspicious-users-store (queryable state store)
```

**Trigger manually:**
```bash
curl -X POST http://localhost:8080/users/{userId}/simulate-fraud
# Synthesizes 6 FAILED login events → triggers the topology
```

**Query the state:**
```bash
curl http://localhost:8080/users/{userId}/fraud-activity
# {"userId": "...", "totalCurrentFailedLogins": 6}
```

---

## 📋 Avro Schema Registry

- **14 subjects** registered (value schemas for all topics + ksqlDB derived streams)
- Per-subject compatibility policy configurable via the demo UI or REST API

### Schema Compatibility Modes

| Mode | Can Readers of **old** schema read **new** messages? | Can Readers of **new** schema read **old** messages? | Use When |
|---|---|---|---|
| `BACKWARD` _(default)_ | ✅ No | ✅ Yes | Evolving consumers before producers |
| `FORWARD` | ✅ Yes | ❌ No | Evolving producers before consumers |
| `FULL` | ✅ Yes | ✅ Yes | Maximum flexibility, both directions |
| `BACKWARD_TRANSITIVE` | ✅ All versions | ❌ No | Strict historical read compat |
| `FORWARD_TRANSITIVE` | ❌ No | ✅ All versions | Strict forward compat across all history |
| `FULL_TRANSITIVE` ⚠️ **STRICTEST** | ✅ All versions | ✅ All versions | Production — zero breaking changes ever |
| `NONE` | ❌ | ❌ | Development only — no enforcement |

### Rules Enforced (STRICT / FULL_TRANSITIVE)

A schema change is **allowed** if:
- ✅ Adding a field **with a default value**
- ✅ Removing a field that **had a default value**

A schema change is **rejected** if:
- ❌ Removing a field with **no default** (breaks backward readers)
- ❌ Adding a field with **no default** (breaks forward readers)
- ❌ Changing a field's **type** (e.g. `string` → `long`)
- ❌ Renaming a field without an **alias**

### Setting Policy Per-Subject

```bash
# View current schema
curl http://localhost:8081/subjects/user-events-value/versions/latest | jq .

# Set FULL_TRANSITIVE (strictest — recommended for production)
curl -X PUT http://localhost:8081/config/user-events-value \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"compatibility": "FULL_TRANSITIVE"}'

# Set FORWARD (producers evolve first)
curl -X PUT http://localhost:8081/config/login-events-value \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"compatibility": "FORWARD"}'

# Check global default
curl http://localhost:8081/config | jq .
```

> 💡 The **Schema Registry panel** in `index.html` lets you change any subject's compatibility mode live — select a subject, pick a mode from the dropdown, and click **Set Policy**.

---

## 🌐 Public Sharing (Cloudflare Tunnels)

For a clean, direct public demo (no splash screens or warnings), we use **Cloudflare Tunnels**.

1.  **Install**: `brew install cloudflared`
2.  **Launch Tunnels**:
    ```bash
    # Open 3 terminal tabs and run:
    cloudflared tunnel --url http://localhost:8000
    cloudflared tunnel --url http://localhost:8080
    cloudflared tunnel --url http://localhost:3001
    ```
3.  **UI Configuration**:
    - Open the public URL for port 8000.
    - Copy/Paste the public URLs for port 8080 (API) and port 3001 (Proxy) into the top settings bar.
    - Click **Apply & Reload**.

---

## 🧪 Testing

```bash
# Run automated API test (create → get → update → fraud → delete)
./test_api.sh

# Verify data in PostgreSQL
docker exec postgres psql -U user -d streamingdb -c "SELECT COUNT(*) FROM users;"

# Check fraud alerts topic
docker exec broker kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic fraud-alerts \
  --from-beginning \
  --max-messages 5
```

---

## 📖 Additional Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Full component diagram + data flow descriptions
- [`docs/FLOWCHART.md`](docs/FLOWCHART.md) — 5 end-to-end Mermaid flowcharts:
  1. User Lifecycle
  2. Fraud Detection
  3. 5M Event Generation
  4. Avro Schema Registry
  5. ksqlDB Query Execution
