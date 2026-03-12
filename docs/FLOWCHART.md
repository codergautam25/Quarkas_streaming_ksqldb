# Flowcharts — Real-Time Streaming Platform

## 1. User Lifecycle Flow

```mermaid
flowchart TD
    A([👤 Browser]) -->|POST /users| B[Quarkus REST API]
    B --> C{Validate Input}
    C -->|Invalid| D[400 Bad Request]
    C -->|Valid| E[Persist to PostgreSQL]
    E --> F[Emit UserEvent via Reactive Emitter]
    F --> G[Serialize with Avro\nSchema Registry validates]
    G --> H[(user-events\nKafka Topic)]
    H --> I[ksqlDB: USER_STREAM]
    I --> J[USER_DEPARTMENT_STREAM\nJOIN DEPARTMENT_TABLE]
    J --> K[USER_ACTIVITY_STREAM\n3-way JOIN + Window]
    K --> L{Salary > 100k\nRisk = HIGH\nLogin = FAILED?}
    L -->|Yes| M[(FILTERED_USER_ACTIVITY)]
    L -->|No| N[Dropped]
    E --> O[201 Created + UUID]
    O -->|Auto-fill| A
```

---

## 2. Fraud Detection Flow

```mermaid
flowchart TD
    A([🔑 Login Event]) -->|Emit LoginEvent Avro| B[(login-events\nKafka Topic)]
    B --> C[FraudDetectionTopology\nKafka Streams App]
    C --> D{LOGIN_STATUS\n== FAILED?}
    D -->|No| E[Ignore]
    D -->|Yes| F[Route by user_id key]
    F --> G[WINDOW TUMBLING\n10 minutes]
    G --> H[COUNT failed logins]
    H --> I{Count >= 5?}
    I -->|No| J[Update state store\nfraud-suspicious-users-store]
    I -->|Yes| K[Emit FRAUD_ALERT\n to fraud-alerts topic]
    K --> L[(fraud-alerts topic\nString serde)]
    L --> M[Browser: Kafka Consumer\nshows FRAUD_ALERT message]
    J --> N[REST: GET /users/id/fraud-activity\nInteractive Query → current count]
```

---

## 3. 5M Event Generation Flow

```mermaid
flowchart TD
    A([🖥 Browser:\nINITIATE 5M EVENT STREAM]) -->|POST /api/generate| B[Quarkus DataGenerator]
    B --> C[Pre-seed reference data]
    C --> D[Emit 20 × DepartmentEvent\nto department-events]
    C --> E[Emit 50 × CountryRiskEvent\nto country-risk-events]
    B --> F[Start 3 Executor Threads]
    F --> G[Thread 1: User Events\n~2.5M events]
    F --> H[Thread 2: Login Events\n~2.5M events]
    G --> I[(user-events\nKafka Topic)]
    H --> J[(login-events\nKafka Topic)]
    I --> K[Schema Registry\nAvro Schema Validation]
    J --> K
    K --> L[ksqlDB Streams\nReal-time Materialization]
    L --> M[Browser Live Feed\nPolls every 2.5s via kafka-proxy]
    M --> N([🖥 Messages visible\nin Live Avro Feed panel])
```

---

## 4. Avro Schema Registry Flow

```mermaid
flowchart TD
    A([📤 Produce Avro Message]) --> B{Schema cached\nin producer?}
    B -->|Yes| C[Serialize with cached schema ID]
    B -->|No| D[POST /subjects/topic-value/versions]
    D --> E{Schema compatible\nwith existing?}
    E -->|FORWARD compatible| F[Register schema\nGet new schema ID]
    E -->|Incompatible| G[SchemaRegistryException\n409 Conflict]
    F --> C
    C --> H[Prefix message with\nMagic byte + Schema ID]
    H --> I[(Kafka Topic)]
    I --> J[Consumer reads\nSchema ID from prefix]
    J --> K[Fetch schema from Registry]
    K --> L[Deserialize Avro bytes]
    L --> M([Typed Java/JSON object])

    subgraph CompatPolicy["Compatibility Policy"]
        direction LR
        P1["BACKWARD — new schema\nreads old data"] 
        P2["FORWARD — old schema\nreads new data"]
        P3["FULL — both directions"]
    end
```

---

## 5. ksqlDB Query Execution Flow

```mermaid
flowchart TD
    A([🔍 User types SQL\nin ksqlDB Editor]) --> B{Query type?}
    B -->|SELECT ... EMIT CHANGES| C[Push Query\nStreaming results]
    B -->|SELECT ... LIMIT N| D[Pull Query\nBounded results]
    C --> E[ksqlDB parses SQL\nBuilds physical plan]
    D --> E
    E --> F{Uses WINDOW?}
    F -->|TUMBLING / HOPPING| G[Apply time-based\naggregation windows]
    F -->|No| H[Process stream/table directly]
    G --> I{Uses JOIN?}
    H --> I
    I -->|Stream-Table JOIN| J[Co-partition by key\nLookup in KTable]
    I -->|Stream-Stream JOIN| K[Buffer within\nWITHIN window]
    I -->|No JOIN| L[Apply WHERE / GROUP BY\nHAVING filters]
    J --> L
    K --> L
    L --> M[Emit result rows\nto output stream/table]
    M --> N[kafka-proxy reads\nvia ksql CLI]
    N --> O[JSON rows returned\nto browser]
    O --> P([📊 Table rendered\nin UI results panel])
```
