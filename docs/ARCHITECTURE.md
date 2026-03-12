# Architecture Diagram — Real-Time Streaming Platform

## Component Overview

```mermaid
graph TB
    subgraph CLIENT["🖥 Client Layer"]
        UI["demo.html\n(Browser UI)"]
        PROXY["kafka-proxy.js\n(Node.js :3001)"]
    end

    subgraph API["⚡ Quarkus API (:8080)"]
        REST["REST Endpoints\n/users, /login, /fraud-activity\n/simulate-fraud, /api/generate"]
        KS["Kafka Streams\nFraudDetectionTopology"]
        DG["DataGenerator\n(5M events, multithreaded)"]
    end

    subgraph KAFKA["📨 Apache Kafka (KRaft, :9092)"]
        T1["user-events\n(Avro)"]
        T2["login-events\n(Avro)"]
        T3["department-events\n(Avro)"]
        T4["country-risk-events\n(Avro)"]
        T5["fraud-alerts\n(String)"]
    end

    subgraph SCHEMA["📋 Schema Registry (:8081)"]
        SR["Confluent Schema Registry\n14 registered subjects\nCompatibility: FORWARD/BACKWARD"]
    end

    subgraph KSQL["🔍 ksqlDB (:8088)"]
        S1["USER_STREAM"]
        S2["LOGIN_STREAM"]
        S3["USER_DEPARTMENT_STREAM\n(Stream-Table JOIN)"]
        S4["USER_ACTIVITY_STREAM\n(3-way JOIN + Window)"]
        S5["FILTERED_USER_ACTIVITY\n(salary>100k & HIGH risk & FAILED)"]
        TB1["DEPARTMENT_TABLE\n(KTable)"]
        TB2["COUNTRY_RISK_TABLE\n(KTable)"]
    end

    subgraph DB["🐘 PostgreSQL (:5432)"]
        PG["streamingdb\nusers table\n(persistent state)"]
    end

    UI -->|"HTTP REST"| REST
    UI -->|"Schema / Topics"| PROXY
    PROXY -->|"Schema Registry REST"| SR
    PROXY -->|"kafka-avro-console-consumer"| KAFKA
    PROXY -->|"ksql CLI"| KSQL

    REST -->|"Panache ORM"| PG
    REST -->|"Emitter (Avro)"| T1
    REST -->|"Emitter (Avro)"| T2
    DG -->|"5M events"| T1
    DG -->|"5M events"| T2
    DG -->|"ref data"| T3
    DG -->|"ref data"| T4

    KS -->|"reads"| T2
    KS -->|"writes alerts"| T5
    KS -.->|"interactive query\nfraud-suspicious-users-store"| REST

    T1 --> S1
    T2 --> S2
    T3 --> TB1
    T4 --> TB2
    S1 --> S3
    TB1 --> S3
    S2 --> S4
    S1 --> S4
    TB2 --> S4
    S4 --> S5

    T1 & T2 & T3 & T4 --> SR
```

## Port Map

| Service | Port | Protocol |
|---|---|---|
| Kafka Broker | 9092 | PLAINTEXT |
| Schema Registry | 8081 | HTTP |
| ksqlDB Server | 8088 | HTTP |
| Quarkus REST API | 8080 | HTTP |
| PostgreSQL | 5432 | TCP |
| Kafka Proxy | 3001 | HTTP |
| Demo UI Server | 8000 | HTTP |

## Data Flows

### Write Path (User Created)
```
Browser → POST /users → Quarkus API
    → INSERT INTO PostgreSQL (users)
    → Emit UserEvent (Avro) → user-events topic
    → Schema Registry validates against user-events-value schema
```

### Fraud Detection Path
```
login-events topic
    → FraudDetectionTopology (Kafka Streams)
        → filter: LOGIN_STATUS == "FAILED"
        → WINDOW TUMBLING (10 min)
        → GROUP BY user_id
        → count >= 5 → emit to fraud-alerts topic (String)
    → Interactive Query: fraud-suspicious-users-store
    → GET /users/{id}/fraud-activity → returns current window count
```

### ksqlDB Enrichment Path
```
user-events → USER_STREAM
login-events → LOGIN_STREAM
department-events → DEPARTMENT_TABLE (KTable)
country-risk-events → COUNTRY_RISK_TABLE (KTable)

USER_STREAM + DEPARTMENT_TABLE → USER_DEPARTMENT_STREAM (salary, dept info)
LOGIN_STREAM + USER_STREAM + COUNTRY_RISK_TABLE → USER_ACTIVITY_STREAM
USER_ACTIVITY_STREAM → FILTERED_USER_ACTIVITY (salary>100k, HIGH risk, FAILED login)
```

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Quarkus | 3.x |
| Broker | Apache Kafka (KRaft) | 7.5.3 |
| Schema Registry | Confluent | 7.5.3 |
| Stream Processing | Kafka Streams + ksqlDB | 7.5.3 |
| Serialization | Apache Avro | — |
| Database | PostgreSQL | 15 |
| ORM | Panache (Hibernate Reactive) | — |
| Containerization | Docker Compose | 3.8 |
| UI Proxy | Node.js | — |
