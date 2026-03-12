CREATE STREAM user_stream (
    user_id STRING,
    name STRING,
    email STRING,
    country STRING,
    department_id STRING,
    salary DOUBLE,
    status STRING
) WITH (
    KAFKA_TOPIC='user-events',
    VALUE_FORMAT='AVRO'
);

CREATE STREAM login_stream (
    login_id STRING,
    user_id STRING,
    login_status STRING,
    device STRING,
    ip STRING,
    login_time BIGINT
) WITH (
    KAFKA_TOPIC='login-events',
    VALUE_FORMAT='AVRO'
);

CREATE TABLE department_table (
    department_id STRING PRIMARY KEY,
    department_name STRING,
    department_budget DOUBLE
) WITH (
    KAFKA_TOPIC='department-events',
    VALUE_FORMAT='AVRO'
);

CREATE TABLE country_risk_table (
    country STRING PRIMARY KEY,
    risk_level STRING
) WITH (
    KAFKA_TOPIC='country-risk-events',
    VALUE_FORMAT='AVRO'
);

CREATE STREAM user_department_stream AS
SELECT
    u.department_id,
    u.user_id,
    u.name,
    u.salary,
    d.department_name,
    d.department_budget
FROM user_stream u
LEFT JOIN department_table d
ON u.department_id = d.department_id
EMIT CHANGES;

-- Dummy user_activity_stream query merging user + login info (simplification for ksqlDB)
CREATE STREAM user_activity_stream AS
SELECT
    l.user_id,
    l.login_id,
    l.login_status,
    l.device,
    u.country,
    u.salary,
    c.risk_level
FROM login_stream l
INNER JOIN user_stream u WITHIN 1 HOURS ON l.user_id = u.user_id
INNER JOIN country_risk_table c ON u.country = c.country
EMIT CHANGES;

-- The complex filtering logic output
CREATE STREAM filtered_user_activity AS
SELECT *
FROM user_activity_stream
WHERE
    salary > 100000
    AND risk_level = 'HIGH'
    AND login_status = 'FAILED'
    AND device != 'CORPORATE_DEVICE'
EMIT CHANGES;

-- Note: Window based fraud detection is handled within the Kafka Streams App as requested.
