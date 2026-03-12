#!/usr/bin/env node
// Kafka + Schema Registry Proxy — serves topic data and schema info to the browser
// Usage: node kafka-proxy.js
const http = require('http');
const { execSync } = require('child_process');

const PORT = 3001;
const SCHEMA_REGISTRY = 'http://localhost:8081';

// Topics that use plain String (not Avro)
const STRING_TOPICS = ['fraud-alerts', 'fraud_alerts'];

function getKafkaMessages(topic, count = 5) {
    try {
        const isAvro = !STRING_TOPICS.includes(topic);
        let cmd;
        if (isAvro) {
            cmd = `docker exec schema-registry kafka-avro-console-consumer \
                --bootstrap-server broker:29092 \
                --topic ${topic} \
                --from-beginning \
                --max-messages ${count} \
                --property schema.registry.url=http://schema-registry:8081 \
                --timeout-ms 3000 2>/dev/null | grep '^{'`;
            const output = execSync(cmd, { timeout: 8000 }).toString().trim();
            return output.split('\n').filter(l => l.startsWith('{')).map(line => {
                try { return JSON.parse(line); } catch (e) { return { raw: line }; }
            });
        } else {
            // Plain string consumer for non-Avro topics
            cmd = `docker exec broker kafka-console-consumer \
                --bootstrap-server localhost:9092 \
                --topic ${topic} \
                --from-beginning \
                --max-messages ${count} \
                --timeout-ms 3000 2>/dev/null`;
            const output = execSync(cmd, { timeout: 8000 }).toString().trim();
            return output.split('\n').filter(l => l.trim()).map((line, i) => ({
                offset: i,
                value: line.trim(),
                type: 'STRING'
            }));
        }
    } catch (e) {
        return [];
    }
}

function getKsqlMessages(customQuery) {
    try {
        const q = customQuery.trim();
        if (!q.toUpperCase().startsWith('SELECT')) {
            return { query: q, rows: [], error: 'Only SELECT queries are allowed.' };
        }
        const safeQ = q.includes('LIMIT') ? q : q.replace(/;$/, '') + ' LIMIT 5;';
        const cmd = `docker exec -i ksqldb-cli ksql http://ksqldb-server:8088 <<< "SET 'auto.offset.reset' = 'earliest'; ${safeQ}" 2>/dev/null`;
        const output = execSync(cmd, { timeout: 12000, shell: '/bin/bash' }).toString();
        const lines = output.split('\n').filter(l => l.includes('|') && !l.includes('-----'));
        let headers = [];
        const rows = [];
        lines.forEach((line, i) => {
            const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
            if (i === 0) {
                headers = cells.map(h => h.replace(/\s+/g, '').substring(0, 16));
            } else if (cells.length >= 2) {
                const obj = {};
                headers.forEach((h, idx) => { obj[h] = cells[idx] || ''; });
                rows.push(obj);
            }
        });
        return { query: safeQ, rows };
    } catch (e) {
        return { query: customQuery, rows: [], error: e.message };
    }
}

function getSchema(subject) {
    try {
        const url = `${SCHEMA_REGISTRY}/subjects/${encodeURIComponent(subject)}/versions/latest`;
        const out = execSync(`curl -s "${url}"`, { timeout: 5000 }).toString();
        const parsed = JSON.parse(out);
        if (parsed.schema) {
            parsed.schemaParsed = JSON.parse(parsed.schema);
        }
        return parsed;
    } catch (e) {
        return { error: e.message };
    }
}

function getCompatibility(subject) {
    try {
        const url = `${SCHEMA_REGISTRY}/config/${encodeURIComponent(subject)}`;
        const out = execSync(`curl -s "${url}"`, { timeout: 4000 }).toString();
        return JSON.parse(out);
    } catch (e) {
        // fallback to global
        try {
            const out = execSync(`curl -s "${SCHEMA_REGISTRY}/config"`, { timeout: 4000 }).toString();
            return { ...JSON.parse(out), source: 'global' };
        } catch (e2) { return { error: e2.message }; }
    }
}

function setCompatibility(subject, compatibility) {
    try {
        const url = `${SCHEMA_REGISTRY}/config/${encodeURIComponent(subject)}`;
        const body = JSON.stringify({ compatibility });
        const out = execSync(`curl -s -X PUT -H "Content-Type: application/vnd.schemaregistry.v1+json" -d '${body}' "${url}"`, { timeout: 6000 }).toString();
        return JSON.parse(out);
    } catch (e) {
        return { error: e.message };
    }
}

function getAllSubjects() {
    try {
        const out = execSync(`curl -s "${SCHEMA_REGISTRY}/subjects"`, { timeout: 4000 }).toString();
        const subjects = JSON.parse(out).filter(s => !s.startsWith('_'));
        return subjects.map(s => ({
            subject: s,
            topic: s.replace('-value', '').replace('-key', ''),
            type: s.endsWith('-value') ? 'value' : 'key'
        }));
    } catch (e) {
        return [];
    }
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (url.pathname === '/topic-messages') {
        const topic = url.searchParams.get('topic') || 'user-events';
        const count = parseInt(url.searchParams.get('count') || '5');
        const isAvro = !STRING_TOPICS.includes(topic);
        const messages = getKafkaMessages(topic, count);
        res.end(JSON.stringify({ topic, count: messages.length, isAvro, messages }));

    } else if (url.pathname === '/ksql-query') {
        const customQ = url.searchParams.get('q');
        const stream = url.searchParams.get('stream') || 'user_stream';
        const count = parseInt(url.searchParams.get('count') || '5');
        const query = customQ ? decodeURIComponent(customQ) : `SELECT * FROM ${stream} EMIT CHANGES LIMIT ${count};`;
        res.end(JSON.stringify(getKsqlMessages(query)));

    } else if (url.pathname === '/schema') {
        const subject = url.searchParams.get('subject') || 'user-events-value';
        const schema = getSchema(subject);
        const compat = getCompatibility(subject);
        res.end(JSON.stringify({ ...schema, compatibility: compat.compatibilityLevel || compat.compatibility || 'BACKWARD (global)' }));

    } else if (url.pathname === '/schema/subjects') {
        res.end(JSON.stringify({ subjects: getAllSubjects() }));

    } else if (url.pathname === '/schema/compatibility' && req.method === 'POST') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', () => {
            try {
                const { subject, compatibility } = JSON.parse(body);
                const result = setCompatibility(subject, compatibility);
                res.end(JSON.stringify(result));
            } catch (e) { res.end(JSON.stringify({ error: e.message })); }
        });
        return;

    } else if (url.pathname === '/topics') {
        try {
            const out = execSync(`docker exec broker kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null`).toString().trim();
            const topics = out.split('\n').filter(t => !t.startsWith('_') && t.trim());
            res.end(JSON.stringify({ topics }));
        } catch (e) {
            res.end(JSON.stringify({ topics: ['user-events', 'login-events', 'department-events', 'country-risk-events', 'fraud-alerts'] }));
        }
    } else {
        res.writeHead(404); res.end('{}');
    }
});

server.listen(PORT, () => {
    console.log(`Kafka+Schema Proxy on http://localhost:${PORT}`);
    console.log('  GET  /topic-messages?topic=X&count=5');
    console.log('  GET  /ksql-query?q=<encoded SQL>');
    console.log('  GET  /schema?subject=user-events-value');
    console.log('  GET  /schema/subjects');
    console.log('  POST /schema/compatibility  {subject, compatibility}');
});
