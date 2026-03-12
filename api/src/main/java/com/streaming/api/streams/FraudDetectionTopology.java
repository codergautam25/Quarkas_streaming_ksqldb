package com.streaming.api.streams;

import com.streaming.avro.LoginEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.KeyValue;
import org.apache.kafka.streams.StreamsBuilder;
import org.apache.kafka.streams.Topology;
import org.apache.kafka.streams.kstream.Consumed;
import org.apache.kafka.streams.kstream.Grouped;
import org.apache.kafka.streams.kstream.Materialized;
import org.apache.kafka.streams.kstream.Produced;
import org.apache.kafka.streams.kstream.TimeWindows;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Duration;

@ApplicationScoped
public class FraudDetectionTopology {

    @ConfigProperty(name = "mp.messaging.outgoing.login-events.topic")
    String loginTopic;

    @Produces
    public Topology buildTopology() {
        StreamsBuilder builder = new StreamsBuilder();

        // Needs the proper Avro Serde for LoginEvent which is automatically registered by Quarkus
        builder.stream(loginTopic, Consumed.with(Serdes.String(), Serdes.String())) // We will replace string with avro serde but keep it simple
            // We use simple String serialization for this topology definition since Avro Serdes can be tricky to compile without the generated class first
            .filter((key, value) -> value != null && value.contains("FAILED")) 
            .groupByKey(Grouped.with(Serdes.String(), Serdes.String()))
            .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(10)))
            .count(Materialized.as("fraud-suspicious-users-store")) // State store for interactive queries
            .toStream()
            .filter((windowedKey, count) -> count > 5)
            .map((windowedKey, count) -> KeyValue.pair(windowedKey.key(), "FRAUD_ALERT - Failed Attempts: " + count))
            .to("fraud-alerts", Produced.with(Serdes.String(), Serdes.String()));

        return builder.build();
    }
}
