#!/usr/bin/env node
// Kafka + Schema Registry Proxy — serves topic data and schema info to the browser
// Usage: node kafka-proxy.js
const http = require('http');
const { execSync, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const PORT = 3001;
const SCHEMA_REGISTRY = 'http://localhost:8081';

// Topics that use plain String (not Avro)
const STRING_TOPICS = ['fraud-alerts', 'fraud_alerts'];

async function getKafkaMessages(topic, count = 5) {
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
                --timeout-ms 5000 2>/dev/null | grep '^{'`;
            const { stdout } = await execAsync(cmd, { timeout: 15000 });
            return stdout.toString().trim().split('\n').filter(l => l.startsWith('{')).map(line => {
                try { return JSON.parse(line); } catch (e) { return { raw: line }; }
            });
        } else {
            // Plain string consumer for non-Avro topics
            cmd = `docker exec broker kafka-console-consumer \
                --bootstrap-server localhost:9092 \
                --topic ${topic} \
                --from-beginning \
                --max-messages ${count} \
                --timeout-ms 5000 2>/dev/null`;
            const { stdout } = await execAsync(cmd, { timeout: 15000 });
            return stdout.toString().trim().split('\n').filter(l => l.trim()).map((line, i) => ({
                offset: i,
                value: line.trim(),
                type: 'STRING'
            }));
        }
    } catch (e) {
        return [];
    }
}

async function getKsqlMessages(customQuery) {
    try {
        const q = customQuery.trim();
        if (!q.toUpperCase().startsWith('SELECT')) {
            return { query: q, rows: [], error: 'Only SELECT queries are allowed.' };
        }
        let safeQ = q.includes('LIMIT') ? q : q.replace(/;$/, '') + ' LIMIT 5;';
        safeQ = safeQ.replace(/[\r\n]+/g, ' ');
        const cmd = `docker exec -i ksqldb-cli ksql http://ksqldb-server:8088 -e "SET 'auto.offset.reset' = 'earliest'; ${safeQ}"`;
        const { stdout } = await execAsync(cmd, { timeout: 25000, shell: '/bin/bash' });
        const lines = stdout.toString().split('\n').filter(l => l.includes('|') && !l.includes('-----'));
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
        let errMessage = e.message;
        if (e.stdout && e.stdout.trim().length > 0) {
            errMessage = e.stdout.trim().replace(/\u001b\[\d+m/g, '');
        }
        return { query: customQuery, rows: [], error: errMessage };
    }
}

async function getSchema(subject) {
    try {
        const url = `${SCHEMA_REGISTRY}/subjects/${encodeURIComponent(subject)}/versions/latest`;
        const { stdout } = await execAsync(`curl -s "${url}"`, { timeout: 5000 });
        const parsed = JSON.parse(stdout.toString());
        if (parsed.schema) {
            parsed.schemaParsed = JSON.parse(parsed.schema);
        }
        return parsed;
    } catch (e) {
        return { error: e.message };
    }
}

async function getCompatibility(subject) {
    try {
        const url = `${SCHEMA_REGISTRY}/config/${encodeURIComponent(subject)}`;
        const { stdout } = await execAsync(`curl -s "${url}"`, { timeout: 4000 });
        return JSON.parse(stdout.toString());
    } catch (e) {
        // fallback to global
        try {
            const { stdout } = await execAsync(`curl -s "${SCHEMA_REGISTRY}/config"`, { timeout: 4000 });
            return { ...JSON.parse(stdout.toString()), source: 'global' };
        } catch (e2) { return { error: e2.message }; }
    }
}

async function setCompatibility(subject, compatibility) {
    try {
        const url = `${SCHEMA_REGISTRY}/config/${encodeURIComponent(subject)}`;
        const body = JSON.stringify({ compatibility });
        const { stdout } = await execAsync(`curl -s -X PUT -H "Content-Type: application/vnd.schemaregistry.v1+json" -d '${body}' "${url}"`, { timeout: 6000 });
        return JSON.parse(stdout.toString());
    } catch (e) {
        return { error: e.message };
    }
}

async function getAllSubjects() {
    try {
        const { stdout } = await execAsync(`curl -s "${SCHEMA_REGISTRY}/subjects"`, { timeout: 4000 });
        const subjects = JSON.parse(stdout.toString()).filter(s => !s.startsWith('_'));
        return subjects.map(s => ({
            subject: s,
            topic: s.replace('-value', '').replace('-key', ''),
            type: s.endsWith('-value') ? 'value' : 'key'
        }));
    } catch (e) {
        return [];
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, bypass-tunnel-reminder');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (url.pathname === '/topic-messages') {
        const topic = url.searchParams.get('topic') || 'user-events';
        const count = parseInt(url.searchParams.get('count') || '5');
        const isAvro = !STRING_TOPICS.includes(topic);
        const messages = await getKafkaMessages(topic, count);
        res.end(JSON.stringify({ topic, count: messages.length, isAvro, messages }));

    } else if (url.pathname === '/ksql-query') {
        const customQ = url.searchParams.get('q');
        const stream = url.searchParams.get('stream') || 'user_stream';
        const count = parseInt(url.searchParams.get('count') || '5');
        const query = customQ ? decodeURIComponent(customQ) : `SELECT * FROM ${stream} EMIT CHANGES LIMIT ${count};`;
        getKsqlMessages(query)
            .then(data => res.end(JSON.stringify(data)))
            .catch(err => res.end(JSON.stringify({ query, rows: [], error: err.message })));

    } else if (url.pathname === '/schema') {
        const subject = url.searchParams.get('subject') || 'user-events-value';
        const schema = await getSchema(subject);
        const compat = await getCompatibility(subject);
        res.end(JSON.stringify({ ...schema, compatibility: compat.compatibilityLevel || compat.compatibility || 'BACKWARD (global)' }));

    } else if (url.pathname === '/schema/subjects') {
        const subjects = await getAllSubjects();
        res.end(JSON.stringify({ subjects }));

    } else if (url.pathname === '/schema/compatibility' && req.method === 'POST') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', async () => {
            try {
                const { subject, compatibility } = JSON.parse(body);
                const result = await setCompatibility(subject, compatibility);
                res.end(JSON.stringify(result));
            } catch (e) { res.end(JSON.stringify({ error: e.message })); }
        });
        return;

    } else if (url.pathname === '/topics') {
        try {
            const { stdout } = await execAsync(`docker exec broker kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null`);
            const topics = stdout.toString().trim().split('\n').filter(t => !t.startsWith('_') && t.trim());
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
